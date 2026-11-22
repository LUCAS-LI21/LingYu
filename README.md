# 邻域 POI 情报系统 · 以小区和银行为基线的智慧数据洞察与服务平台

[![CI](https://github.com/LUCAS-LI21/LingYu/actions/workflows/ci.yml/badge.svg)](https://github.com/LUCAS-LI21/LingYu/actions/workflows/ci.yml)
[![Pages](https://github.com/LUCAS-LI21/LingYu/actions/workflows/pages.yml/badge.svg)](https://github.com/LUCAS-LI21/LingYu/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

银行网点与小区信息的**采集 → 清洗 → 多维查询 → 用户反馈 → 审核生效 → 热点驱动重采**闭环。

前端 Vue 3 + Vite + Leaflet，后端 Spring Boot 3 + MySQL 8，数据来自 OpenStreetMap（ODbL）。

> 完整技术说明见 **[docs/tech/技术文档.md](docs/tech/技术文档.md)**：技术栈、功能清单、账号体系、使用说明。
> 部署方式见 **[docs/deploy/GitHub部署.md](docs/deploy/GitHub部署.md)**（Pages / Codespaces / 公网后端）。

## 🌐 在线体验

| 入口                       | 地址                                 | 能力                                           |
| -------------------------- | ------------------------------------ | ---------------------------------------------- |
| **网页（静态演示）**       | https://lucas-li21.github.io/LingYu/ | 地图 / 列表 / 洞察可浏览（种子数据），无需登录 |
| **完整系统（Codespaces）** | 仓库 Code → Codespaces               | 前端 + 后端 + MySQL，含后台与反馈闭环          |
| 小程序                     | `miniprogram/`                       | 需指向公网 HTTPS 后端（见部署文档第五节）      |

> Pages 只能托管静态文件，后端跑不了；要完整体验请用 Codespaces 或自建服务器。

## 🚀 评委怎么打开

**方式一：GitHub Codespaces（推荐，无需本地环境）**

1. 本仓库页面点 **Code → Codespaces → Create codespace on main**（或点下面的徽章）
2. 首次启动会自动构建并拉起 MySQL + 后端 + 前端，约 5–10 分钟
3. 状态栏端口 **8081** 点开即为系统首页；后端 18080（排障）、HTTPS 8443 也会转发
4. 运营后台：首页顶部「管理后台」，账号 `operator`，**口令见 Codespaces 里的 `.env` 文件**（每次创建随机生成，不会硬编码在仓库里）

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/LUCAS-LI21/LingYu)

**方式二：本地 Docker 一键跑**

```bash
cp .env.deploy.example .env      # 填写 MYSQL_ROOT_PASSWORD / DB_PASSWORD / AUTH_SECRET / OPERATOR_PASSWORD
docker compose --env-file .env up -d --build
# 打开 http://127.0.0.1:8081
```

**数据说明**：仓库内含 1,853 家银行（含 368 台自助设备 ATM）、3,576 个小区的真实采集结果（价格/租金/建成年份/建设单位均标注来源）；
不依赖任何外部 API Key 即可浏览全部功能。

## 快速开始（本地开发）

```bash
# 1. 数据库（只需一次）：建库即可，表结构由后端启动时按 db/migration 自动迁移
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS poi_intel DEFAULT CHARSET utf8mb4;"

# 2. 后端（自动迁移 + 导入种子数据）
cd backend && mvn -DskipTests package && java -jar target/poi-intel.jar

# 3. 前端
pnpm install && pnpm dev
```

- 前端：http://127.0.0.1:5173
- 后端：http://127.0.0.1:8080/api/v1/health
- 运营后台：http://127.0.0.1:5173/admin（口令由 `OPERATOR_PASSWORD` 环境变量提供；未设置或为空时后端拒绝启动，开发环境可用 `APP_AUTH_ALLOW_DEFAULT_PASSWORD=true` 放行）

## 功能

| 页面          | 能力                                              |
| ------------- | ------------------------------------------------- |
| `/` 地图      | 视口渲染、图层切换、框选、点击弹窗、周边 1km 银行 |
| `/list` 列表  | 区域/类型/价格/年份筛选、排序分页、纠错入口       |
| `/stats` 洞察 | 品牌 Top8、均价分布、2km 网格密度                 |
| `/admin` 运营 | 反馈审核、抓取任务、热点重算（需登录）            |

**三条闭环**：纠错（反馈→审核→版本→即时生效）、补采（新增点位→定向抓取）、热点（查询日志→聚合→调度）。

## 技术栈

| 层   | 选型                                                             |
| ---- | ---------------------------------------------------------------- |
| 前端 | Vue 3.5 · Vite 8 · TypeScript 5.9 · Tailwind v4 · Leaflet 1.9    |
| 测试 | Vitest 5（76 单测）· Playwright 1.64（12 E2E，桌面 16 / 移动 4） |
| 后端 | Spring Boot 3.2.5 · Java 17 · MyBatis-Plus 3.5.5                 |
| 数据 | MySQL 8.0（视图统一查询、`ST_Distance_Sphere`）                  |
| 鉴权 | PBKDF2 口令 + HMAC-SHA256 token（自研，无 Spring Security）      |

## 文档索引

| 文档                                               | 内容                                           |
| -------------------------------------------------- | ---------------------------------------------- |
| [技术文档](docs/tech/技术文档.md)                  | 技术栈 / 功能 / 账号体系 / 使用说明            |
| [一键部署](docs/deploy/一键部署.md)                | Docker Compose 编排、配置项、备份与排查        |
| [需求规格 SRS](docs/requirements/01-SRS.md)        | 用例、55 条功能需求、12 条非功能需求、三条闭环 |
| [数据字典](docs/requirements/02-数据字典.md)       | 11 张表与字段说明                              |
| [合规说明](docs/requirements/03-合规与数据来源.md) | 三级授权模型、实测 robots 结果、法律边界       |
| [ER 设计](docs/design/ER.md)                       | 表关系、索引、设计决策与已知限制               |
| [OpenAPI](docs/api/openapi.yaml)                   | 14 个接口契约                                  |
| [ADR-0001](docs/adr/0001-实时层与本地库分离.md)    | 实时层与本地库分离                             |

文档站：`pnpm docs:dev`（VitePress）。

## 目录结构

```text
LingYu/
├─ src/                     前端（Vue 3 + TS）
│  ├─ api/                  HTTP 封装（pois / server / live / agent / auth）
│  ├─ components/           UI 组件（地图、筛选、详情、后台面板）
│  ├─ views/                页面（地图 / 列表 / 洞察 / 用户后台 / 管理后台）
│  ├─ types/                领域类型
│  └─ router/               路由（history base 跟随 VITE_BASE）
├─ backend/                 Spring Boot 3 服务
│  ├─ src/main/java/        poi / admin / feedback / auth / live / agent / common
│  ├─ src/main/resources/
│  │  ├─ db/migration/      数据库迁移 V1–V6（启动自动执行）
│  │  ├─ mapper/            MyBatis XML
│  │  └─ seed/              离线种子数据
│  └─ Dockerfile
├─ miniprogram/             微信小程序（与 Web 共用同一后端）
├─ docker/                  nginx 配置
├─ docker-compose.yml       本地/服务器一键编排（web + backend + mysql）
├─ .devcontainer/           Codespaces 一键环境（自动生成 .env 并启动）
├─ .github/workflows/       CI（测试 + 镜像）与 Pages（前端静态站）
├─ scripts/                 采集适配器、导入脚本、演示录制
├─ docs/                    需求 / 设计 / 接口 / 部署 / 演示材料
├─ data/                    官方数据与解析结果（ODbL/政府开放数据）
├─ tests/ e2e/              前端单测与 Playwright 端到端
└─ STRUCTURE.md             本结构说明与文件职责
```

> 不提交的内容：`.env`、`node_modules/`、`dist/`、`backend/target/`、`test-results/`、`*.log`（见 `.gitignore`）。

## 常用命令

| 命令                                    | 说明                      |
| --------------------------------------- | ------------------------- |
| `pnpm dev` / `pnpm build`               | 开发 / 生产构建           |
| `pnpm check`                            | Lint + 格式 + 类型 + 单测 |
| `pnpm e2e`                              | Playwright 端到端         |
| `pnpm docs:dev`                         | 文档站                    |
| `cd backend && mvn -DskipTests package` | 后端打包                  |

## 环境变量

| 变量                      | 说明                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| `DB_USER` / `DB_PASSWORD` | 数据库账号（默认 root/root）                                      |
| `AUTH_SECRET`             | token 签名密钥；**留空则每次启动生成随机值**（重启后 token 失效） |
| `OPERATOR_PASSWORD`       | 运营默认口令                                                      |
| `HTTP_PROXY`              | Overpass 抓取代理（Java 直连常被 502）                            |
| `AMAP_KEY`                | 高德 Key，仅用于 L2 实时地址查询（不落库）；留空则该入口降级      |

## 演示材料（2026-11-21）

- **演示流程方案**：[docs/demo/演示流程.md](docs/demo/演示流程.md)（约 3 分钟，含话术与评委追问答案）
- **自动录制视频**：[docs/demo/player.html](docs/demo/player.html)（浏览器打开，视频 + 中文字幕）
  - 视频文件 `docs/demo/demo.webm`（1.8 MB，VP9），字幕 `docs/demo/demo.srt`
  - 重新录制：`node scripts/record-demo.mjs`（需 Playwright；会自动生成 SRT 与播放页）
