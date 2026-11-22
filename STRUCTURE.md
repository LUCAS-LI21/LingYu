# 项目结构说明（提交用）

> 仓库：<https://github.com/LUCAS-LI21/LingYu>
> 一份仓库 = 一个网页前端 + 一个共用后端 + 一个小程序。

## 顶层

```
LingYu/
├─ src/                  网页前端（Vue 3 + Vite + TypeScript + Leaflet + Tailwind）
├─ backend/              Spring Boot 3 后端（所有端共用）
├─ miniprogram/          微信小程序（调用同一个后端 API）
├─ docker/               nginx 反向代理配置
├─ .devcontainer/        GitHub Codespaces 一键环境
├─ .github/workflows/    CI（测试/镜像） + Pages（前端静态发布）
├─ scripts/              数据采集、导入、校验、演示录制脚本
├─ data/                 官方数据与解析产物（来源可溯）
├─ docs/                 文档（需求/设计/接口/部署/演示）
├─ tests/                前端单元测试（Vitest）
├─ e2e/                  Playwright 端到端
└─ public/               静态资源（logo、种子数据）
```

## 前端 `src/`

| 目录          | 职责                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `api/`        | HTTP 封装：`pois.ts`（查询/筛选/排序）、`server.ts`（服务端映射）、`live.ts`（L2 实时）、`agent.ts`、`auth.ts` |
| `components/` | 地图画布、筛选面板、点位卡片、详情面板、移动端 Sheet、后台各面板                                               |
| `views/`      | 地图页、列表页、洞察页、用户后台、管理后台                                                                     |
| `types/`      | `Poi` / `BankPoi` / `CommunityPoi` / `Filters` 等领域类型                                                      |
| `router/`     | 路由表；history base 跟随构建变量 `VITE_BASE`                                                                  |
| `lib/`        | 坐标转换、导航链接、toast、viewport 等工具                                                                     |

## 后端 `backend/src/main/java/com/poiintel/`

| 包          | 职责                                                 |
| ----------- | ---------------------------------------------------- |
| `poi/`      | 查询、详情、统计、热点、周边关联（银行↔小区）        |
| `admin/`    | 运营后台：反馈审核、待定位、导入、抓取任务、采集服务 |
| `feedback/` | 用户纠错/补充与受理编号查询                          |
| `auth/`     | 登录、HMAC token、角色校验、默认口令 fail-fast       |
| `live/`     | L2 实时层（地址/周边/配套），不落库                  |
| `agent/`    | 数据接入 Agent：抽取/复核/采纳、质量巡检、域名白名单 |
| `common/`   | 迁移器、坐标、名称质量、字段归一、异常与限流         |

资源目录：

- `db/migration/V1–V6`：建表、价格分列、闭环字段、名称清理、演示值清理、服务类型
- `mapper/PoiMapper.xml`：查询/计数/统计 SQL（含完整度打分与品牌轮转）
- `seed/pois.json`：离线种子（后端不可用时的演示兜底）

## 小程序 `miniprogram/`

```
pages/      地图/列表/洞察/我的/详情/纠错/历史/待定位/土地/热点/管理
components/ 开屏、通用卡片
utils/      请求封装、坐标转换、格式化
assets/     logo 与 tab 图标
config.js   后端地址（上线需改成 HTTPS 域名）
```

## 不提交的文件

`.env`、`node_modules/`、`dist/`、`backend/target/`、`test-results/`、`playwright-report/`、`*.log`。
完整规则见 `.gitignore`。

## 构建产物从哪来

| 产物       | 命令                                                  |
| ---------- | ----------------------------------------------------- |
| 前端静态站 | `pnpm build`（Pages 构建时注入 `VITE_BASE=/LingYu/`） |
| 后端 jar   | `cd backend && mvn -DskipTests package`               |
| 容器镜像   | `docker compose --env-file .env build`                |
| 演示视频   | `node scripts/record-demo.mjs`                        |
