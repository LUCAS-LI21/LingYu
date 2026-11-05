# 邻域 POI 情报系统

银行网点与小区信息的**采集 → 清洗 → 多维查询 → 用户反馈 → 审核生效 → 热点驱动重采**闭环。

前端 Vue 3 + Vite + Leaflet，后端 Spring Boot 3 + MySQL 8，数据来自 OpenStreetMap（ODbL）。

> 完整技术说明见 **[docs/tech/技术文档.md](docs/tech/技术文档.md)**：技术栈、功能清单、账号体系、使用说明。
> 代码改动后请同步更新该文档与 `docs/api/openapi.yaml`。

## 快速开始

```bash
# 1. 数据库（只需一次）
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS poi_intel DEFAULT CHARSET utf8mb4;"

# 2. 后端（自动建表 + 导入种子数据）
cd backend && mvn -DskipTests package && java -jar target/poi-intel.jar

# 3. 前端
pnpm install && pnpm dev
```

- 前端：http://127.0.0.1:5173
- 后端：http://127.0.0.1:8080/api/v1/health
- 运营后台：http://127.0.0.1:5173/admin（默认 `operator / operator123`，可用环境变量覆盖）

## 功能

| 页面               | 能力                                              |
| ------------------ | ------------------------------------------------- |
| `/` 地图           | 视口渲染、图层切换、框选、点击弹窗、周边 1km 银行 |
| `/list` 列表       | 区域/类型/价格/年份筛选、排序分页、纠错入口       |
| `/stats` 洞察      | 品牌 Top8、均价分布、2km 网格密度                 |
| `/compliance` 合规 | 三级授权模型、来源清单、免责声明                  |
| `/admin` 运营      | 反馈审核、抓取任务、热点重算（需登录）            |

**三条闭环**：纠错（反馈→审核→版本→即时生效）、补采（新增点位→定向抓取）、热点（查询日志→聚合→调度）。

## 技术栈

| 层   | 选型                                                          |
| ---- | ------------------------------------------------------------- |
| 前端 | Vue 3.5 · Vite 8 · TypeScript 5.9 · Tailwind v4 · Leaflet 1.9 |
| 测试 | Vitest 5（17 单测）· Playwright 1.64（10 E2E）                |
| 后端 | Spring Boot 3.2.5 · Java 17 · MyBatis-Plus 3.5.5              |
| 数据 | MySQL 8.0（视图统一查询、`ST_Distance_Sphere`）               |
| 鉴权 | PBKDF2 口令 + HMAC-SHA256 token（自研，无 Spring Security）   |

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

## 目录

```text
src/            前端（api / components / views / types）
backend/        Spring Boot 服务（poi / admin / feedback / auth / seed）
docs/           技术文档、需求、设计、接口
scripts/        OSM 拉取、截图、联调验证脚本
skills/         六阶段工程作业规程
```

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
