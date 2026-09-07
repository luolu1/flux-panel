# flux-panel 定制版（基于 2.0.7-beta）

本仓库是 [bqlpfy/flux-panel](https://github.com/bqlpfy/flux-panel) 的定制分支，基线为官方 **Release 2.0.7-beta**，在其之上增加了四项能力，并可从官方 2.0.7-beta 平滑升级。

> 上游全部特性、免责声明与赞助信息见 [官方 README](https://github.com/bqlpfy/flux-panel/blob/main/README.md)。本文只描述定制内容。

---

## 定制内容

### 1. 转发管理支持批量删除

多选模式下可跨隧道勾选转发，一次提交批量删除。

- 逐条按单条删除的完整语义执行：权限校验、向各入口节点下发服务删除、释放端口记录
- 返回每条的处理结果，部分失败时弹窗列出失败原因，并把失败项保持选中方便重试
- 失败项可选择「强制删除」，跳过节点侧验证只清理面板数据（节点上可能残留服务）
- 单次上限 200 条：每条转发都要向节点下发指令，单节点最坏 10 秒，避免请求超时

### 2. 换机后一键推送配置

节点机器损坏后，用**同一条安装命令**（同一 secret）在新机器上安装 agent，新机器的 `gost.json` 是空的，面板里该节点的配置不会自动生效。现在节点页每张卡片有「推送配置」，页头有「批量推送配置」。

推送语义是**只补齐缺失、不重建已有**——gost 的 `UpdateService` 会关闭并重启服务、断开所有存活连接，因此已存在的配置一律跳过。

下发顺序：协议屏蔽 → 限速器 → 转发链 → 链服务 → 转发服务。限速器必须先于引用它的服务，转发链必须先于引用它的转发服务（否则服务会解析到空链并静默丢包）。

除手动推送外，节点上线和配置上报时也会自动补齐。

同时修复了三个会导致配置无法恢复的上游缺陷：

| 缺陷 | 影响 | 修复 |
|---|---|---|
| `metadata.paused` 在 agent 启动时不生效 | 已暂停的转发在 agent 重启后自行恢复运行，变成开放的、不计费的端口 | 推送时对面板中标记暂停的转发重新下发 `PauseService` |
| `AddService` 整批校验 + `GostUtil` 把 `exists` 规整成 `OK` | `tcp`/`udp` 只创建了一半时，缺失的那一半永远补不回来，且面板认为成功 | 依据节点上报检测半残留，先删除残留再整对重建 |
| 握手时用 agent 上报的 `0/0/0` 覆盖面板的协议屏蔽设置 | 换机后面板设置被抹掉且无法恢复 | 面板为权威源，仅在面板未设置时采纳节点上报值；推送时用 `SetProtocol` 恢复 |

### 3. 转发管理界面重构

**按隧道分类**：隧道为一级分组，点击标题展开/收起该隧道下的转发，各隧道互不影响，默认全部展开。

```
▼ test                    2 个转发    2/2
    test1   入口：199.30.88.147:1001   目标：80.225.185.7:42312   [开关] 编辑 诊断 删除
    test2   入口：199.30.88.147:1002   目标：80.225.185.8:42313   [开关] 编辑 诊断 删除
▶ prod                    3 个转发    3/3
```

**单行列表布局**：原来的卡片网格改为占满全宽的单行列表，从左到右依次是拖拽柄、名称+隧道、入口、目标、策略/流量、状态、暂停/开启开关、编辑/诊断/删除。窄屏自动折行为「名称 / 入口+目标 / 操作」三行，操作按钮保持可点击尺寸。

**批量暂停/开启**：多选工具栏为 全选 / 批量开启 / 批量暂停 / 批量删除。批量状态变更复用单条语义（流量配额、隧道权限、节点下发），逐条返回结果。

**入口/目标点击复制**：点文本即复制，右侧另有独立的复制图标。复制的是完整地址而非界面上省略后的文本——多地址的行显示 `1.1.1.1:53 (+1)`，复制出来是完整的两行。多地址的行额外有列表图标，点开才是地址弹窗。

### 4. 修复复制功能失效

`navigator.clipboard` 只在安全上下文（HTTPS 或 localhost）下存在。通过 `http://IP:端口` 访问面板时该 API 为 `undefined`，调用直接抛异常，**所有页面的复制都会失败**——这是上游的既有问题，不限于转发页。

新增 [`src/utils/clipboard.ts`](vite-frontend/src/utils/clipboard.ts)：优先使用 `navigator.clipboard`，不可用时回退到 `document.execCommand('copy')`（非安全上下文下仍有效）。转发管理、仪表板、节点监控的所有复制点（含节点安装命令）均已切换。

---

## 全新安装

与官方一样一键装，只是脚本地址换成这个仓库。1 核 1G 即可，不在本机编译，直接拉预构建镜像。

```bash
curl -L https://raw.githubusercontent.com/luolu1/flux-panel/main/panel_install.sh -o panel_install.sh && chmod +x panel_install.sh && ./panel_install.sh
```

脚本会下载本仓库的 `docker-compose.yml`（镜像默认 `ghcr.io/luolu1/*:2.0.7-beta-custom.1`），询问前端/后端端口后启动。默认管理员账号 `admin_user` / `admin_user`，首次登录后请立即修改。

节点端安装命令仍在面板「节点监控」卡片上点「安装」复制即可，agent 二进制未改动，与官方节点完全兼容。

---

## 从官方 2.0.7-beta 升级

**无任何数据库结构变更**（`schema.sql` 未改动），升级就是替换镜像，`sqlite_data` 数据卷原样保留，转发、节点、用户数据全部不变。节点端 agent 二进制未改动，**无需重装节点**。

默认使用预构建的多架构镜像，**不在本机编译**，1 核 1G 的小机器可直接升级。

在面板部署目录（执行过 `panel_install.sh`、含 `docker-compose.yml` 与 `.env` 的目录）执行：

```bash
# 不需要 clone 整个仓库，只下载升级脚本
curl -L https://raw.githubusercontent.com/luolu1/flux-panel/main/panel_upgrade.sh -o panel_upgrade.sh
chmod +x panel_upgrade.sh
./panel_upgrade.sh
```

也可以 clone 仓库后执行：

```bash
git clone https://github.com/luolu1/flux-panel.git /opt/flux-panel-src
cd /你的面板部署目录
/opt/flux-panel-src/panel_upgrade.sh
```

脚本会依次：备份数据库与配置（含 WAL checkpoint）→ 改写 compose 的 image 引用 → 拉取镜像 → 优雅重启 → 等待健康检查。失败时提示回滚方式。

实测 1 核 1G 场景下升级全程额外内存占用约 450MB（主要是 Docker 解压镜像），面板运行时占用与升级前一致。

可用环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `IMAGE_TAG` | `2.0.7-beta-custom.1` | 镜像 tag |
| `LOCAL_BUILD` | 未设置 | 设为 `1` 时在本机编译（需 2GB 内存），默认拉取预构建镜像 |
| `IMAGE_PREFIX` | `ghcr.io/luolu1` | 镜像仓库前缀（`LOCAL_BUILD=1` 时默认 `flux-panel`） |

官方的 `docker-compose-v4.yml` / `docker-compose-v6.yml` 硬编码了镜像地址，本仓库改为 `${BACKEND_IMAGE:-...}` / `${FRONTEND_IMAGE:-...}`，可直接在 `.env` 里覆盖：

```env
BACKEND_IMAGE=ghcr.io/luolu1/springboot-backend:2.0.7-beta-custom.1
FRONTEND_IMAGE=ghcr.io/luolu1/vite-frontend:2.0.7-beta-custom.1
```

### CPU 架构

**无需关心架构。** 预构建镜像同时提供 `linux/amd64` 与 `linux/arm64`，`docker pull` 自动选取匹配本机的那一份。项目本身没有平台相关依赖：`sqlite-jdbc` 的 fat jar 同时内置 `Linux/x86_64` 与 `Linux/aarch64` 原生库，基础镜像（`maven`、`eclipse-temurin`、`node`、`nginx`）也都提供 amd64 与 arm64。若选择本机编译，产出的镜像天然与本机架构一致。

镜像发布在 GHCR：

```
ghcr.io/luolu1/springboot-backend:2.0.7-beta-custom.1
ghcr.io/luolu1/vite-frontend:2.0.7-beta-custom.1
```

推送到 `main` 时由 [`docker-build-custom.yml`](.github/workflows/docker-build-custom.yml) 自动构建 `linux/amd64` 与 `linux/arm64`。首次使用需在仓库 Packages 设置里把镜像可见性改为 public，否则拉取需要先 `docker login ghcr.io`。

### 在另一台机器构建后导入（离线 / 内存不足）

生产机内存不足或不能访问外网时，可在另一台**架构相同**的机器上构建，再把镜像打包传过去。

构建机：

```bash
git clone https://github.com/luolu1/flux-panel.git && cd flux-panel
./panel_export_images.sh            # 本地构建后导出
./panel_export_images.sh --pull     # 或从 GHCR 拉取后导出（不构建）
```

生成 `flux-panel-images-<tag>.tar.gz`（约 207MB）。传到生产机：

```bash
scp flux-panel-images-*.tar.gz root@生产机:/root/
```

生产机：

```bash
./panel_export_images.sh --load flux-panel-images-<tag>.tar.gz
cd /面板部署目录
SKIP_BUILD=1 /path/to/panel_upgrade.sh
```

导入时会比对镜像与本机架构，不一致直接报错退出，不会留下跑不起来的容器。

### 本机编译（可选，需 2GB 内存）

只有想自行改代码时才需要。前端构建至少需要 **2GB 可用内存**：`vite.config.ts` 关闭了 `minify` 与 `treeshake`（沿用上游配置），产物约 7.5MB，rollup 生成阶段峰值内存较高，不足时会报 `Reached heap limit Allocation failed` 或被 OOM killer 杀掉（退出码 137）。脚本会在构建前检查内存并给出提示。

```bash
LOCAL_BUILD=1 /opt/flux-panel-src/panel_upgrade.sh
```

1G 机器若坚持本机编译，可临时加 swap：

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
LOCAL_BUILD=1 /opt/flux-panel-src/panel_upgrade.sh
swapoff /swapfile && rm -f /swapfile
```

开启压缩可把构建内存降到 1GB 以内、产物缩小到约 1.95MB（实测功能正常），但这偏离了上游配置，因此未作为默认。需要的话改 `vite-frontend/vite.config.ts`：

```ts
build: {
  minify: 'esbuild',
  rollupOptions: { treeshake: true },
}
```

### 手动构建

```bash
docker build -t flux-panel/springboot-backend:2.0.7-beta-custom.1 ./springboot-backend
docker build -t flux-panel/vite-frontend:2.0.7-beta-custom.1 ./vite-frontend
```

跨架构构建（需要 buildx 与 QEMU）：

```bash
docker buildx build --platform linux/amd64 -t flux-panel/springboot-backend:2.0.7-beta-custom.1 --load ./springboot-backend
```

---

## 新增接口

均为 `POST`，路径前缀 `/api/v1`。

| 接口 | 参数 | 权限 | 说明 |
|---|---|---|---|
| `/forward/batch-delete` | `{ids: number[], force?: boolean}` | 登录用户（仅限本人转发） | 批量删除，`force` 跳过节点侧验证 |
| `/forward/batch-status` | `{ids: number[], resume: boolean}` | 登录用户（仅限本人转发） | 批量暂停/开启 |
| `/node/sync` | `{id: number}` | 管理员 | 向单个节点补齐配置 |
| `/node/sync-all` | 无 | 管理员 | 向所有在线节点补齐配置 |

批量接口统一返回：

```json
{
  "code": 0,
  "data": {
    "total": 2,
    "successCount": 1,
    "failCount": 1,
    "results": [
      { "id": 1, "name": "test1", "success": true,  "msg": "删除成功" },
      { "id": 2, "name": "test2", "success": false, "msg": "节点不在线" }
    ]
  }
}
```

配置推送返回每一项的处理动作，`ADDED`（已下发）/ `ENSURED`（已确保存在）/ `REPAIRED`（重建了半残留服务）/ `SKIPPED`（已存在或无需处理）/ `FAILED`。没有新鲜的节点上报时无从判断节点已有什么，此时统一记为 `ENSURED`，避免出现虚假的新增数。

### 已知限制

`/node/sync-all` 目前同步返回，节点较多时可能超过前端 30 秒超时。单节点推送不受影响；服务端会继续执行完成。

---

## 主要改动文件

**后端**

```
common/task/NodeConfigSyncAsync.java   节点配置同步编排（冷却、并发去重、下发顺序）
common/task/NodeConfigPusher.java      单个配置项下发与结果记录
common/task/NodeSyncContext.java       对账依据（节点已有哪些配置、上报新鲜度）
common/task/ChainTarget.java           转发链下发目标
common/dto/NodeSyncResult.java         推送结果
config/NodeSyncExecutorConfig.java     节点同步专用线程池
service/impl/ForwardServiceImpl.java   批量删除 / 批量状态变更
service/impl/NodeServiceImpl.java      pushNodeConfig / pushAllNodeConfigs
common/utils/WebSocketServer.java      协议屏蔽以面板为权威源
```

节点配置下发单次最坏阻塞 10 秒，若与其它 `@Async` 任务共用默认线程池，批量推送会占满线程并拖垮流量上报，因此单独建池。注意一旦容器中出现自定义 `Executor`，Spring Boot 就不再自动配置 `applicationTaskExecutor`，故 `taskExecutor` / `taskScheduler` 也一并显式声明。

**前端**

```
src/pages/forward.tsx      隧道分组、单行布局、批量操作、地址复制
src/pages/node.tsx         推送配置按钮与结果弹窗
src/utils/clipboard.ts     剪贴板兜底
src/api/index.ts           新接口封装与类型
```

---

## 免责声明

沿用上游条款：本项目仅供个人学习与研究使用，使用带来的任何风险由使用者自行承担，必须确保使用行为符合所在国家或地区的法律法规。完整条款见[官方 README](https://github.com/bqlpfy/flux-panel/blob/main/README.md#免责声明)。
