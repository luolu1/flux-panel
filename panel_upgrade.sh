#!/bin/bash
# 从官方 flux-panel 2.0.7-beta 平滑升级到本定制版本。
#
# 定制版没有任何数据库结构变更（schema.sql 未改动），因此升级只需替换镜像：
# SQLite 数据卷 sqlite_data 原样保留，转发、节点、用户数据全部不变。
#
# 用法（在面板部署目录，即含 docker-compose.yml 与 .env 的目录中执行）：
#   ./panel_upgrade.sh                       # 本地构建（架构自动匹配当前机器）
#   USE_REGISTRY=1 ./panel_upgrade.sh        # 改用 GHCR 上的多架构镜像，不本地构建
#   IMAGE_TAG=my-tag ./panel_upgrade.sh      # 指定镜像 tag
#   IMAGE_PREFIX=registry.example.com/x ./panel_upgrade.sh   # 指定镜像仓库前缀
set -e

export LANG=en_US.UTF-8
export LC_ALL=C

IMAGE_TAG="${IMAGE_TAG:-2.0.7-beta-custom.1}"
GHCR_PREFIX="${GHCR_PREFIX:-ghcr.io/luolu1}"

# USE_REGISTRY=1 时使用 GHCR 的多架构镜像（docker 会自动拉取匹配本机架构的那一份），
# 否则在本机构建 —— 本机构建天然产出本机架构的镜像，不存在架构不匹配问题。
if [[ -n "$USE_REGISTRY" ]]; then
  IMAGE_PREFIX="${IMAGE_PREFIX:-$GHCR_PREFIX}"
  SKIP_BUILD=1
else
  IMAGE_PREFIX="${IMAGE_PREFIX:-flux-panel}"
fi
BACKEND_IMAGE="${IMAGE_PREFIX}/springboot-backend:${IMAGE_TAG}"
FRONTEND_IMAGE="${IMAGE_PREFIX}/vite-frontend:${IMAGE_TAG}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="docker-compose.yml"
BACKUP_DIR="./flux-panel-backup"

check_docker() {
  if command -v docker-compose &> /dev/null; then
    DOCKER_CMD="docker-compose"
  elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    DOCKER_CMD="docker compose"
  else
    echo "❌ 未检测到 docker compose，请先安装 Docker。"
    exit 1
  fi
  echo "✅ Docker 命令：$DOCKER_CMD"
}

check_deployment() {
  if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "❌ 当前目录没有 $COMPOSE_FILE。"
    echo "   请在面板部署目录（执行过 panel_install.sh 的目录）中运行本脚本。"
    exit 1
  fi
  if [[ ! -f ".env" ]]; then
    echo "❌ 当前目录没有 .env（其中包含 JWT_SECRET 与端口配置）。"
    echo "   缺少该文件会导致所有用户 token 失效，已终止。"
    exit 1
  fi
  echo "✅ 找到现有部署"
  grep -E "^\s+image:" "$COMPOSE_FILE" | sed 's/^/   当前镜像：/'
}

backup_database() {
  mkdir -p "$BACKUP_DIR"
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"

  echo "💾 备份数据库与配置到 $BACKUP_DIR ..."
  cp "$COMPOSE_FILE" "$BACKUP_DIR/docker-compose.yml.$stamp"
  cp ".env" "$BACKUP_DIR/.env.$stamp"

  # 后端仍在运行时先做一次 WAL checkpoint，确保导出的 db 文件是完整的
  if docker ps --format '{{.Names}}' | grep -q '^springboot-backend$'; then
    docker exec springboot-backend sh -c \
      'sqlite3 "${DB_PATH:-/app/data/gost.db}" "PRAGMA wal_checkpoint(TRUNCATE);"' >/dev/null 2>&1 \
      || echo "⚠️  WAL checkpoint 跳过（容器内无 sqlite3 或数据库不可用）"
    docker cp "springboot-backend:/app/data/gost.db" "$BACKUP_DIR/gost.db.$stamp" 2>/dev/null \
      && echo "✅ 数据库已备份：$BACKUP_DIR/gost.db.$stamp" \
      || echo "⚠️  数据库文件备份失败，数据卷 sqlite_data 本身不会被本脚本删除"
  else
    echo "⚠️  后端容器未运行，跳过数据库导出（数据卷 sqlite_data 保持不变）"
  fi
}

build_images() {
  if [[ -n "$SKIP_BUILD" ]]; then
    echo "⏭️  使用远程镜像，跳过本地构建"
    return
  fi

  echo "🖥️  本机架构：$(uname -m)（本地构建的镜像与本机架构一致）"
  if [[ ! -d "$SCRIPT_DIR/springboot-backend" || ! -d "$SCRIPT_DIR/vite-frontend" ]]; then
    echo "❌ 未在 $SCRIPT_DIR 找到源码目录，无法本地构建。"
    echo "   请在源码仓库内执行本脚本，或设置 SKIP_BUILD=1 直接使用已推送的镜像。"
    exit 1
  fi

  echo "🔨 构建后端镜像 $BACKEND_IMAGE ..."
  docker build -t "$BACKEND_IMAGE" "$SCRIPT_DIR/springboot-backend"
  echo "🔨 构建前端镜像 $FRONTEND_IMAGE ..."
  docker build -t "$FRONTEND_IMAGE" "$SCRIPT_DIR/vite-frontend"
  echo "✅ 镜像构建完成"
}

rewrite_compose() {
  echo "📝 更新 $COMPOSE_FILE 镜像引用 ..."
  # 官方 compose 里镜像是硬编码的，这里直接改写为定制镜像；本仓库的 compose 使用
  # ${BACKEND_IMAGE:-...} 变量形式，改写后同样生效。
  python3 - "$COMPOSE_FILE" "$BACKEND_IMAGE" "$FRONTEND_IMAGE" <<'PY'
import re
import sys

path, backend, frontend = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, encoding='utf-8') as fh:
    content = fh.read()

patterns = [
    (re.compile(r'^(\s*image:\s*).*springboot-backend.*$', re.MULTILINE), backend),
    (re.compile(r'^(\s*image:\s*).*vite-frontend.*$', re.MULTILINE), frontend),
]
for pattern, image in patterns:
    content, count = pattern.subn(lambda m: m.group(1) + image, content)
    if count == 0:
        sys.exit(f'未在 {path} 中找到 {image} 对应的 image 行，已终止')

with open(path, 'w', encoding='utf-8') as fh:
    fh.write(content)
PY
  grep -E "^\s+image:" "$COMPOSE_FILE" | sed 's/^/   新镜像：/'
}

restart_stack() {
  echo "🛑 优雅停止服务 ..."
  docker stop -t 30 springboot-backend 2>/dev/null || true
  docker stop -t 10 vite-frontend 2>/dev/null || true
  echo "⏳ 等待 WAL 数据同步 ..."
  sleep 5

  # 不带 --volumes，sqlite_data 数据卷保留
  $DOCKER_CMD down

  if [[ -n "$SKIP_BUILD" ]]; then
    echo "⬇️ 拉取镜像 ..."
    $DOCKER_CMD pull
  fi

  echo "🚀 启动服务 ..."
  $DOCKER_CMD up -d
}

wait_healthy() {
  echo "🔍 检查后端健康状态 ..."
  for i in $(seq 1 90); do
    if docker ps --format '{{.Names}}' | grep -q '^springboot-backend$'; then
      local health
      health=$(docker inspect -f '{{.State.Health.Status}}' springboot-backend 2>/dev/null || echo unknown)
      if [[ "$health" == "healthy" ]]; then
        echo "✅ 后端健康检查通过"
        return 0
      fi
      if [[ $((i % 15)) -eq 1 ]]; then
        echo "⏳ 等待后端启动 ... ($i/90) 状态：$health"
      fi
    fi
    sleep 1
  done

  echo "❌ 后端 90 秒内未通过健康检查"
  echo "   查看日志：docker logs --tail 100 springboot-backend"
  echo "   回滚：把 $BACKUP_DIR 中的 docker-compose.yml 还原后执行 $DOCKER_CMD up -d"
  return 1
}

main() {
  echo "==============================================="
  echo "  flux-panel 定制版升级（$IMAGE_TAG）"
  echo "==============================================="
  check_docker
  check_deployment
  backup_database
  build_images
  rewrite_compose
  restart_stack
  wait_healthy

  echo ""
  echo "🎉 升级完成"
  echo "   数据库未做任何结构变更，原有转发 / 节点 / 用户数据全部保留。"
  echo "   备份目录：$BACKUP_DIR"
  echo "   新增功能：转发管理批量删除、转发单行列表布局、节点配置一键推送。"
  echo "   节点端无需重装：本次改动不涉及 agent 二进制。"
}

main "$@"
