#!/bin/bash
# 在一台机器上构建/拉取镜像，导出为 tar，再导入到目标机器（离线或内存不足时使用）。
#
# 典型场景：生产机内存不足无法构建前端，或生产机不能访问外网。
#
# 用法：
#   在构建机（架构必须与目标机一致）：
#     ./panel_export_images.sh              # 本地构建后导出
#     ./panel_export_images.sh --pull       # 从 GHCR 拉取后导出（不构建）
#
#   把生成的 flux-panel-images-<tag>.tar.gz 传到目标机，然后：
#     ./panel_export_images.sh --load flux-panel-images-<tag>.tar.gz
set -e

export LANG=en_US.UTF-8
export LC_ALL=C

IMAGE_TAG="${IMAGE_TAG:-2.0.7-beta-custom.1}"
LOCAL_PREFIX="${LOCAL_PREFIX:-flux-panel}"
GHCR_PREFIX="${GHCR_PREFIX:-ghcr.io/luolu1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BACKEND_IMAGE="${LOCAL_PREFIX}/springboot-backend:${IMAGE_TAG}"
FRONTEND_IMAGE="${LOCAL_PREFIX}/vite-frontend:${IMAGE_TAG}"
ARCHIVE="flux-panel-images-${IMAGE_TAG}.tar.gz"

host_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) echo "$(uname -m)" ;;
  esac
}

check_docker() {
  command -v docker &> /dev/null || { echo "❌ 未检测到 docker"; exit 1; }
}

build_images() {
  echo "🔨 本地构建（架构：$(host_arch)）..."
  echo "   前端构建需要约 2GB 可用内存，不足会因 OOM 失败"
  docker build -t "$BACKEND_IMAGE" "$SCRIPT_DIR/springboot-backend"
  docker build -t "$FRONTEND_IMAGE" "$SCRIPT_DIR/vite-frontend"
}

pull_images() {
  local arch
  arch="$(host_arch)"
  echo "⬇️  从 GHCR 拉取 linux/${arch} 镜像..."
  docker pull --platform "linux/${arch}" "${GHCR_PREFIX}/springboot-backend:${IMAGE_TAG}"
  docker pull --platform "linux/${arch}" "${GHCR_PREFIX}/vite-frontend:${IMAGE_TAG}"
  # 重打成本地名，导入端与 panel_upgrade.sh 的默认前缀保持一致
  docker tag "${GHCR_PREFIX}/springboot-backend:${IMAGE_TAG}" "$BACKEND_IMAGE"
  docker tag "${GHCR_PREFIX}/vite-frontend:${IMAGE_TAG}" "$FRONTEND_IMAGE"
}

export_images() {
  local arch
  arch="$(docker image inspect "$BACKEND_IMAGE" --format '{{.Architecture}}')"
  echo "📦 导出镜像（架构：${arch}）..."
  docker save "$BACKEND_IMAGE" "$FRONTEND_IMAGE" | gzip -1 > "$ARCHIVE"

  echo ""
  echo "✅ 导出完成：$ARCHIVE（$(du -h "$ARCHIVE" | cut -f1)）"
  echo "   镜像架构：${arch} —— 目标机架构必须一致，否则无法启动"
  echo ""
  echo "下一步："
  echo "   1. 传到目标机：scp $ARCHIVE root@目标机:/root/"
  echo "   2. 在目标机导入：./panel_export_images.sh --load $ARCHIVE"
  echo "   3. 在面板部署目录升级：SKIP_BUILD=1 ./panel_upgrade.sh"
}

load_images() {
  local archive="$1"
  [[ -f "$archive" ]] || { echo "❌ 找不到文件：$archive"; exit 1; }

  echo "📥 导入镜像 $archive ..."
  gunzip -c "$archive" | docker load

  local img_arch host
  img_arch="$(docker image inspect "$BACKEND_IMAGE" --format '{{.Architecture}}' 2>/dev/null || echo unknown)"
  host="$(host_arch)"
  echo ""
  echo "   镜像架构：${img_arch}    本机架构：${host}"
  if [[ "$img_arch" != "$host" ]]; then
    echo ""
    echo "❌ 架构不匹配！这些镜像无法在本机运行。"
    echo "   请在与本机架构相同（${host}）的机器上重新构建，或改用 USE_REGISTRY=1 直接拉取。"
    exit 1
  fi

  echo "✅ 架构匹配，导入完成"
  echo ""
  echo "下一步：进入面板部署目录（含 docker-compose.yml 与 .env），执行"
  echo "   SKIP_BUILD=1 $SCRIPT_DIR/panel_upgrade.sh"
}

check_docker
case "${1:-}" in
  --load)
    [[ -n "${2:-}" ]] || { echo "用法：$0 --load <archive.tar.gz>"; exit 1; }
    load_images "$2"
    ;;
  --pull)
    pull_images
    export_images
    ;;
  "")
    build_images
    export_images
    ;;
  *)
    echo "用法：$0 [--pull | --load <archive.tar.gz>]"
    exit 1
    ;;
esac
