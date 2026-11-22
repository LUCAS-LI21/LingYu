# 一键部署（Docker Compose）

> 目标：在一台装了 Docker 的机器上，**三条命令**跑起完整系统（MySQL + 后端 + 前端）。
> 当前状态：文件与脚本已就绪，**尚未在 Docker 中实际部署**（本机 Docker 守护进程未启动）。

## 1. 包含哪些文件

| 文件                  | 作用                                                      |
| --------------------- | --------------------------------------------------------- |
| `docker-compose.yml`  | 编排 mysql / backend / web 三个服务，含健康检查与启动顺序 |
| `Dockerfile`          | 前端多阶段构建：Node 编译 → Nginx 托管                    |
| `backend/Dockerfile`  | 后端多阶段构建：Maven 打包 → JRE 运行                     |
| `docker/nginx.conf`   | SPA 回退、`/api` 反代、静态资源缓存、安全头               |
| `.env.deploy.example` | 配置模板（口令、密钥、端口、抓取代理）                    |
| `scripts/deploy.ps1`  | Windows 一键脚本（生成 .env、构建、等待健康、打印地址）   |
| `scripts/deploy.sh`   | Linux / macOS 同上                                        |

## 2. 前置条件

| 项     | 要求                                                   |
| ------ | ------------------------------------------------------ |
| Docker | Desktop 4.x 或 Docker Engine 24+，**守护进程需运行**   |
| 内存   | 建议 ≥ 8 GB（Maven 构建阶段较吃内存）                  |
| 磁盘   | 镜像约 1.5 GB，数据卷另计                              |
| 端口   | 8081（前端）、18080（接口）、3307（MySQL）**未被占用** |
| 网络   | 首次构建需拉取基础镜像与 Maven/npm 依赖                |

检查 Docker 是否就绪：

```bash
docker info
```

## 3. 快速开始

```bash
# 1) 生成配置（首次）
cp .env.deploy.example .env
#    然后修改 MYSQL_ROOT_PASSWORD、OPERATOR_PASSWORD，填好 INGEST_PROXY

# 2) 构建并启动
docker compose --env-file .env up -d --build

# 3) 查看状态
docker compose --env-file .env ps
```

或者用脚本（会自动生成 `.env` 与随机 `AUTH_SECRET`，并等到健康检查通过）：

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
```

```bash
# Linux / macOS
chmod +x scripts/deploy.sh && ./scripts/deploy.sh
```

部署成功后：

| 入口     | 地址                                 |
| -------- | ------------------------------------ |
| 前端     | http://127.0.0.1:8081                |
| 运营后台 | http://127.0.0.1:8081/admin          |
| 接口健康 | http://127.0.0.1:18080/api/v1/health |
| 数据库   | `127.0.0.1:3307/poi_intel`（仅本机） |

## 4. 配置项（`.env`）

| 变量                  | 默认                               | 说明                                                           |
| --------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `MYSQL_ROOT_PASSWORD` | `change-me-please`                 | **必须修改**；后端用它连库                                     |
| `DB_NAME`             | `poi_intel`                        | 库名，容器启动时自动创建                                       |
| `AUTH_SECRET`         | 空                                 | token 签名密钥；**留空则每次启动随机生成**，重启后所有登录失效 |
| `OPERATOR_USERNAME`   | `operator`                         | 首次启动写入的运营账号                                         |
| `OPERATOR_PASSWORD`   | `<你的运营口令>`                   | **必须修改**                                                   |
| `INGEST_PROXY`        | `http://host.docker.internal:7892` | 抓取代理；容器内不能用 `127.0.0.1`                             |
| `WEB_PORT`            | `8081`                             | 前端对外端口                                                   |
| `API_PORT`            | `18080`                            | 后端对外端口（仅绑定 127.0.0.1）                               |
| `MYSQL_PORT`          | `3307`                             | MySQL 对外端口（仅绑定 127.0.0.1）                             |

> 不写 `.env` 也能起（全部走默认值），但 `AUTH_SECRET` 会每次随机，导致重启后需重新登录。

## 5. 首次启动会发生什么

1. `mysql` 容器初始化空库 `poi_intel`，健康检查通过（约 20–40 秒）
2. `backend` 启动 → 执行 `db/migration` V1–V3（16 张基表 + `schema_version` + `v_poi` 视图）
3. 若 POI 表为空 → 从 `classpath:seed/pois.json` 导入种子（约 1 700 条）
4. 启动清理：把上次残留的 `pending/running` 抓取任务标记为失败
5. `web` 在 backend 健康后启动，Nginx 反代 `/api`

首次全流程约 **1–3 分钟**（含镜像构建）。

## 6. 验证清单

```bash
# 1. 三个容器都 healthy
docker compose --env-file .env ps

# 2. 接口与数据库连通
curl http://127.0.0.1:18080/api/v1/health
# {"code":0,"message":"ok","data":{"status":"ok","db":"up"}}

# 3. 有真实数据
curl "http://127.0.0.1:18080/api/v1/stats"
# total ≈ 1700，bank ≈ 340，community ≈ 1360

# 4. 前端可访问
curl -I http://127.0.0.1:8081/
```

浏览器打开 http://127.0.0.1:8081/ → 地图应显示福田区银行点位；`/admin` 用 `.env` 里的账号登录。

## 7. 常用运维

```bash
docker compose --env-file .env ps                    # 状态
docker compose --env-file .env logs -f backend       # 后端日志
docker compose --env-file .env restart backend       # 重启后端
docker compose --env-file .env up -d --build web     # 只重建前端
docker compose --env-file .env down                  # 停止（数据保留）
docker compose --env-file .env down -v               # 停止并删除数据卷（重置）
```

脚本等价：`scripts\deploy.ps1 -Logs` / `-Down` / `-SkipBuild`。

## 8. 备份与恢复

```bash
# 备份
docker compose exec -T mysql sh -c \
  'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" poi_intel' > backup-$(date +%F).sql

# 恢复
docker compose exec -T mysql sh -c \
  'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" poi_intel' < backup-2026-11-05.sql
```

数据卷 `mysql-data` 保存全部数据；`down -v` 会删除它。

## 9. 抓取代理

Java 直连 Overpass 常被 502（实测），容器内访问宿主代理必须用 `host.docker.internal`：

```env
INGEST_PROXY=http://host.docker.internal:7892
```

- 无代理：留空，抓取任务可能因超时失败（不影响查询与审核功能）
- Linux 已通过 `extra_hosts: host.docker.internal:host-gateway` 支持该域名

## 10. 常见问题

| 现象                        | 原因                             | 处理                                                                 |
| --------------------------- | -------------------------------- | -------------------------------------------------------------------- |
| `docker info` 报错          | Docker Desktop 未启动            | 启动后重试                                                           |
| `port is already allocated` | 8081/18080/3307 被占             | 改 `.env` 里的 `WEB_PORT` / `API_PORT` / `MYSQL_PORT`                |
| backend 反复重启            | 连不上 MySQL 或口令不一致        | `docker compose logs backend`；确认 `MYSQL_ROOT_PASSWORD` 未改过一半 |
| 登录后重启又掉线            | `AUTH_SECRET` 为空，每次启动随机 | 在 `.env` 里显式写死 `AUTH_SECRET`                                   |
| 首次构建卡在 Maven 下载     | 网络/镜像源慢                    | 重试；或在 `backend/Dockerfile` 里配 Maven 镜像源                    |
| 抓取任务超时                | 无代理或 Overpass 限流           | 配置 `INGEST_PROXY`；任务失败不影响查询                              |
| 页面 502                    | backend 未 healthy               | `docker compose ps` 看状态，先修后端                                 |

## 11. 与本地开发的区别

| 维度   | 本地开发                 | 容器部署                    |
| ------ | ------------------------ | --------------------------- |
| 前端   | Vite dev（5173，热更新） | Nginx 静态（8081）          |
| 后端   | `java -jar`（8080）      | 容器内 8080，映射 18080     |
| 数据库 | 本机 MySQL（3306）       | 容器 MySQL（映射 3307）     |
| 数据   | 复用本地库               | 新卷，首次导入种子          |
| 代理   | `127.0.0.1:7892`         | `host.docker.internal:7892` |

## 12. 上生产前还要做

- [ ] 改掉所有默认口令，`AUTH_SECRET` 用 `openssl rand -base64 32` 固定
- [ ] 前面加 HTTPS（Nginx 443 + 证书，或云负载均衡）
- [ ] 数据库不要映射到宿主机（删掉 `ports`），改用独立备份
- [ ] 给容器加 `deploy.resources.limits` 限制内存
- [ ] 把 `restart: unless-stopped` 换成编排平台的健康探针与滚动更新
- [ ] 镜像推到私有仓库，不在服务器上构建

## L2 实时层（高德）配置

实时地址/实时周边/实时 ATM 走高德「Web服务」接口，**只展示不落库**（高德协议 §3.5）。

1. 在高德开放平台创建 Key，**服务平台选「Web服务」**（不是 JS API）；
2. 写入 `.env`：
   ```ini
   AMAP_KEY=你的32位key
   LIVE_DAILY_BUDGET=300          # 总预算/日
   LIVE_DAILY_BUDGET_AROUND=100   # 周边搜索单独上限/日
   ```
3. 重启后端：`docker compose --env-file .env up -d --force-recreate backend`
4. 验证：
   ```bash
   curl -s "http://127.0.0.1:18080/api/v1/live/pois?lng=114.0579&lat=22.5431&radius=1000&keywords=ATM"
   ```
   返回 `enabled:true, stored:false` 即生效。

未配置 Key 时接口返回 `enabled:false` 并说明原因，前台提示「实时周边暂不可用」，本地库功能完全不受影响。
