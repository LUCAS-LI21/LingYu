# LingYu · 以小区和银行为基线的智慧数据洞察与服务平台

[![CI](https://github.com/LUCAS-LI21/LingYu/actions/workflows/ci.yml/badge.svg)](https://github.com/LUCAS-LI21/LingYu/actions/workflows/ci.yml)
[![Pages](https://github.com/LUCAS-LI21/LingYu/actions/workflows/pages.yml/badge.svg)](https://github.com/LUCAS-LI21/LingYu/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 项目简介

LingYu 面向银行网点与住宅小区的数据整合场景，提供从多源采集、清洗治理、地图与列表查询、关联分析到用户反馈审核的完整数据链路。系统由 Web 前端、Spring Boot 后端与微信小程序三端组成，共用同一套 API 与数据模型。

数据来源包括 OpenStreetMap、深圳市政府开放数据平台及 11 家银行官网；所有入库字段均可追溯来源，实时查询数据遵循"仅展示、不落库"原则。

## 功能特性

- **数据采集**：银行官网适配器、OSM 增量抓取、政府开放数据导入；支持定时任务与手动触发。
- **数据治理**：字段清洗归一、名称质量校验、球面距离去重、字段级来源记录、版本管理（`poi_version`）。
- **多维查询**：地图（缩放/平移/框选/图层切换）、列表（区域、类型、价格、年份筛选与排序、分页）。
- **关联分析**：小区周边 1km 银行与 ATM、银行周边小区、小区周边配套（学校/医院/地铁/商场）。
- **数据洞察**：区域分布、品牌分布、价格分布、热门搜索。
- **业务闭环**：用户纠错 → 审核队列 → 采纳写库并记录版本；新增点位触发定向抓取；查询热点驱动采集优先级。
- **运营后台**：反馈审核、待定位管理、抓取任务、数据质量巡检、Agent 建议。
- **小程序端**：与 Web 共用后端的微信小程序，覆盖地图、列表、详情、反馈与后台。

## 技术架构

| 层级   | 技术选型                                                                   |
| ------ | -------------------------------------------------------------------------- |
| 前端   | Vue 3.5、TypeScript 5.9、Vite 8、Leaflet 1.9、Tailwind CSS 4               |
| 后端   | Java 17、Spring Boot 3.2、MyBatis-Plus、HikariCP                           |
| 数据库 | MySQL 8.0，迁移脚本 `backend/src/main/resources/db/migration`              |
| 实时层 | 高德 Web 服务 API（L2，仅展示不落库，带配额闸门）                          |
| 部署   | Docker Compose、Nginx、GitHub Actions、GitHub Pages、Codespaces            |
| 质量   | Vitest（前端单元）、JUnit（后端）、Playwright（端到端）、ESLint + Prettier |

## 目录结构

```text
src/           Web 前端
backend/       Spring Boot 后端
miniprogram/   微信小程序
scripts/       采集、导入、校验、演示录制脚本
docs/          需求、设计、接口、部署文档
data/          官方数据与解析产物
tests/ e2e/    单元测试与端到端测试
```

详细说明见 [STRUCTURE.md](STRUCTURE.md)。

## 快速开始

### Docker Compose

```bash
cp .env.deploy.example .env
# 填写 MYSQL_ROOT_PASSWORD、DB_PASSWORD、AUTH_SECRET、OPERATOR_PASSWORD
docker compose --env-file .env up -d --build
```

- Web：http://127.0.0.1:8081
- API：http://127.0.0.1:18080/api/v1/health
- 运营后台：http://127.0.0.1:8081/admin

### 本地开发

```bash
# 数据库（首次）
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS poi_intel DEFAULT CHARSET utf8mb4;"

# 后端（启动时自动执行迁移）
cd backend && mvn -DskipTests package && java -jar target/poi-intel.jar

# 前端
pnpm install && pnpm dev
```

### Codespaces

仓库页面选择 **Code → Codespaces → Create codespace on main**，`.devcontainer` 会自动生成配置并启动 MySQL、后端与前端。

## 配置项

| 变量                                      | 说明                                                    |
| ----------------------------------------- | ------------------------------------------------------- |
| `DB_HOST` / `DB_PORT` / `DB_NAME`         | 数据库连接                                              |
| `DB_USER` / `DB_PASSWORD`                 | 数据库账号（生产环境禁止使用 root）                     |
| `AUTH_SECRET`                             | Token 签名密钥，必填                                    |
| `OPERATOR_USERNAME` / `OPERATOR_PASSWORD` | 运营账号，口令必填且不得使用默认值                      |
| `AMAP_KEY`                                | 高德 Web 服务 Key，用于 L2 实时查询；留空则相关入口降级 |
| `DEEPSEEK_API_KEY`                        | Agent 字段补全与复核；留空则不启用                      |

完整清单见 [.env.deploy.example](.env.deploy.example)。

## 部署

| 方式              | 说明                                   | 文档                                         |
| ----------------- | -------------------------------------- | -------------------------------------------- |
| GitHub Pages      | 前端静态站（只读，使用导出的数据快照） | [部署文档](docs/deploy/github-deployment.md) |
| Codespaces        | 完整前后端与数据库                     | 同上                                         |
| 自建服务器 / PaaS | 对外提供 HTTPS API，小程序上线必需     | 同上                                         |

## 质量保障

- 前端单元测试 75 项、后端单元测试 32 项、端到端 20 项（另 4 项按环境跳过）
- GitHub Actions 执行 Lint、格式、类型、单测、E2E 与镜像构建
- 数据质量巡检：楼栋编号、纯数字名称自动拦截

## 文档

| 文档                                                                         | 内容                            |
| ---------------------------------------------------------------------------- | ------------------------------- |
| [STRUCTURE.md](STRUCTURE.md)                                                 | 目录职责与构建产物              |
| [docs/requirements](docs/requirements)                                       | 需求规格、数据字典、合规说明    |
| [docs/design](docs/design)                                                   | ER 设计、数据源矩阵、Agent 设计 |
| [docs/api/openapi.yaml](docs/api/openapi.yaml)                               | 接口契约                        |
| [docs/tech/technical-documentation.md](docs/tech/technical-documentation.md) | 技术实现说明                    |
| [docs/deploy/github-deployment.md](docs/deploy/github-deployment.md)         | 部署与运维                      |
| [docs/demo/demo-walkthrough.md](docs/demo/demo-walkthrough.md)               | 功能演示流程                    |

## 数据许可

- OpenStreetMap 数据 © OpenStreetMap contributors，ODbL 1.0
- 政府开放数据遵循各数据集发布条款
- Esri 底图 © Esri, HERE, Garmin，仅用于演示

## License

[MIT](LICENSE)
