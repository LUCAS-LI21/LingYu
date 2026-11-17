# 部署验收记录（2026-11-18）

首次**真实跑通** Docker 独立部署（此前只做过 `docker compose config` 静态校验）。

## 环境

| 项     | 值                                                         |
| ------ | ---------------------------------------------------------- |
| Docker | v29.5.2（Desktop，Windows）                                |
| 编排   | `docker-compose.yml`（mysql + backend + web）              |
| 端口   | web `8081` / api `18080`（仅本机）/ mysql `3307`（仅本机） |
| 镜像源 | 官方源 + 国内镜像（daocloud / 1ms），见下方「踩坑」        |

## 启动命令

```bash
cp .env.deploy.example .env     # 已存在则跳过
docker compose --env-file .env up -d --build
```

## 验收结果

| #   | 检查项           | 命令/方式                            | 结果                                |
| --- | ---------------- | ------------------------------------ | ----------------------------------- |
| 1   | 三个容器健康     | `docker ps`                          | ✅ mysql / backend / web 均 healthy |
| 2   | 后端健康检查     | `curl 127.0.0.1:18080/api/v1/health` | ✅ 200                              |
| 3   | 前端可访问       | `curl 127.0.0.1:8081/`               | ✅ 200                              |
| 4   | nginx 反代接口   | `curl 127.0.0.1:8081/api/v1/health`  | ✅ 200                              |
| 5   | 地图加载真实数据 | 浏览器                               | ✅ 命中 1528 个银行点位             |
| 6   | 详情页真实价格   | 搜索「龙都花园」                     | ✅ 成交参考价 66,000 元/㎡          |
| 7   | 后台登录         | `POST /api/v1/auth/login`            | ✅ 200（`.env` 口令生效）           |
| 8   | 待定位网点页     | 后台 Tab                             | ✅ 50 行可标注                      |
| 9   | 浏览器控制台     | Playwright                           | ✅ 无错误                           |

## 首次跑通暴露并修复的 3 个真问题

### 1. 后台登录 403（CORS）

- **现象**：部署后 `POST /api/v1/auth/login` 返回 403，前端登录失败
- **原因**：浏览器带 `Origin: http://127.0.0.1:8081`，后端 CORS 白名单只有开发环境 `5173`
- **修复**：
  - `docker/nginx.conf`：反代时剥离 `Origin`/`Referer`（同源语义，与 vite dev 代理一致）
  - `WebConfig`：白名单改为可配置 `app.cors.origins`（默认 5173），独立域名部署可用 `CORS_ORIGINS` 覆盖

### 2. 导入真实数据后 `.env` 口令失效

- **现象**：`OPERATOR_PASSWORD=change-me-too`，但只有旧口令 `operator123` 能登录
- **原因**：用 `mysqldump` 把开发库导入容器，`sys_user` 表被整体覆盖；`AdminAccountSeeder` 只在表为空时创建账号
- **修复**：`AdminAccountSeeder` 改为「账号不存在则创建；存在且显式配置了非默认口令但与配置不符则更新」；`AuthService` 抽出静态 `matches()` 复用
- **验证**：`change-me-too` → 200，`operator123` → 400

### 3. 基础镜像拉取失败（国内网络）

- **现象**：`docker.io` TLS 握手超时；镜像站 CDN 签名过期（403）或传输中断（EOF）
- **处理**：官方源与国内镜像交替重试；`api` 镜像最终从官方源拉到，`mysql` 从 daocloud 拉到后 `docker tag` 回标准名
- **结果**：五个基础镜像全部就位（mysql:8.0、maven、eclipse-temurin、nginx、node:24-alpine）

## 数据导入（可选但推荐）

容器初始库只有种子数据（1287 个小区）。导入开发库的增强数据：

```bash
# 宿主机导出
mysqldump -u root -proot --databases poi_intel --no-tablespaces --single-transaction \
  --default-character-set=utf8mb4 --result-file=data/poi_intel_dump.sql

# 导入容器（注意：PowerShell 里别用 $pwd 变量名，会覆盖当前目录自动变量）
docker exec -e MYSQL_PWD=change-me-please poi-mysql mysql -uroot \
  -e "DROP DATABASE IF EXISTS poi_intel; CREATE DATABASE poi_intel CHARACTER SET utf8mb4;"
cmd /c "docker exec -i -e MYSQL_PWD=change-me-please poi-mysql mysql -uroot poi_intel < data\poi_intel_dump.sql"

# 重启后端（触发口令校准与视图重建）
docker restart poi-backend
```

导入后：小区 3,576 / 银行 1,528 / 待定位小区 4,941。

## 已知限制

- 容器内 `HTTP_PROXY` 指向 `host.docker.internal:7892`，抓取任务能否成功取决于宿主机代理是否在跑
- 前端构建在容器内走 npmmirror，首次构建约 3–5 分钟
- `data/poi_intel_dump.sql` 属部署产物，不入库（已在 `.gitignore`）
