---
name: lingyu-engineering
description: LingYu（小区/银行 POI 平台）工程约定与历史踩坑清单：数据真实性、命名与注释规范、Pages/Codespaces/PaaS 部署、GitHub Actions 与 Playwright 常见故障、验收门禁。
whenToUse: 在本仓库继续开发、重构、部署或编写交付文档时加载，避免重复踩坑与违反数据合规约定。
---

# LingYu 工程约定

## 不可违反的约定

1. **不造数据**：字段值必须有可追溯来源（官网、政府开放数据、OSM、用户反馈审核）。没有证据就留空并在 UI 显示"未提供/暂无"。
2. **L2 不落库**：高德等实时接口只做展示，禁止写表、缓存响应体；响应需带 `stored:false` 与 `no-store`。
3. **不提交密钥**：`.env`、Key、口令一律不入库；仓库只保留 `.env.example`。
4. **结论必须有证据**：汇报用数字（覆盖率、用例数、接口返回），不写"应该可以"。
5. **交付命名**：文件用英文 kebab-case；代码注释只写必要技术约束，不写叙事、历史、踩坑故事；对外文档简练规范，分析过程放 `docs/internal/`。

## 命名与注释

| 类型 | 规范 | 反例 |
| --- | --- | --- |
| 目录/文件 | `kebab-case`，英文 | `一键部署.md`、`build_db_doc.py` |
| Vue 组件 | `PascalCase.vue` | `detailpanel.vue` |
| Java 类 | `PascalCase`，按领域分包 | `Utils2.java` |
| 接口路径 | `/api/v1/<resource>`，复数名词 | `/getData` |
| 注释 | 1-3 行说明职责/约束 | 大段设计缘由、表情符号、"注意这里" |
| 文档 | 结论先行、表格化 | 过程流水账、口语化 |

## 部署要点

### GitHub Pages（前端静态站）

- `vite.config.ts` 读取 `VITE_BASE`；Pages 构建传 `/LingYu/`，路由用 `createWebHistory(import.meta.env.BASE_URL)`。
- Pages 无后端：构建时传 `VITE_DEMO_DATA=1`，前端读 `public/demo-data/*.json`（由 `scripts/export-demo-data.mjs` 导出）。
- `404.html` 复制 `index.html` 以支持 SPA 刷新。
- Pages 设置必须为 **Source: GitHub Actions**，否则 404。

### Codespaces

- `.devcontainer/setup.sh` 生成 `.env` 并启动 Compose；端口 8081（Web）、18080（API）、8443（HTTPS）。
- Secrets 里的 `AMAP_KEY`、`DEEPSEEK_API_KEY` 由 setup 写入 `.env`。

### PaaS / 公网后端（小程序必需）

- 需要 HTTPS 域名并加入微信后台 `request 合法域名`；`miniprogram/config.js` 的 `API_BASE` 指向该域名。
- 后端镜像使用 `backend/Dockerfile`（`-Dmaven.test.skip=true`，避免测试依赖下载失败）。
- 必填环境变量：`DB_*`、`AUTH_SECRET`、`OPERATOR_PASSWORD`；`AUTH_SECRET` 为空会导致 token 重启失效。

## GitHub Actions 踩坑

1. **pnpm 版本重复**：`pnpm/action-setup@v4` 的 `version` 与 `package.json` 的 `packageManager` 同时存在会报 `Multiple versions of pnpm specified`。保留 `packageManager`，移除 workflow 里的 `version`。
2. **GHCR 标签大小写**：`ghcr.io/${{ github.repository }}` 含大写会报 `repository name must be lowercase`。先转小写：`echo "lc=${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"`。
3. **空库 e2e**：全新 MySQL 没有 `community_pending` 数据，后台用例不能假设有数据；用 `isVisible().catch(() => false)` 跳过并在报告里注明。
4. **Pages 与 CI 分开**：`pages.yml` 只构建静态前端；后端镜像由 `ci.yml` 推 GHCR。

## Playwright 踩坑

- 自动化环境 `navigator.webdriver=true` 会跳过开场动画；录演示时用 `/?intro=1` 强制播放。
- 录屏需要 `npx playwright install ffmpeg`；系统未装 ffmpeg 时无法烧录字幕，用 `<track>` 加载 SRT。
- 视频体积大：用 Playwright 自带 ffmpeg 转 VP9（`-c:v libvpx-vp9 -b:v 0 -crf 38`），1 分钟约 2 MB。
- 移动端用例注意长文本撑宽：卡片容器加 `min-w-0 overflow-hidden`，否则 aside 拦截点击。

## 后端与数据踩坑

- **JDBC 聚合类型**：`SUM()` 在 MySQL 返回 `BigDecimal`/字符串，前端统一 `Number()` 转换。
- **MyBatis 别名**：`snake_case` 列必须显式 `AS camelCase`，否则映射为空。
- **Mapper XML**：`<`、`>` 需转义；每个 `<sql>` 片段末尾不能多逗号。
- **迁移顺序**：`db/migration/V*.sql` 启动自动执行，已执行版本不可修改，只能追加。
- **楼栋名称**：`29栋`、`36号楼` 之类不是小区，入库前用 `NameQuality.isBuildingLike` 拦截。
- **演示值**：`demo_attributes=1` 的哈希价格/年份必须清理，前端也要防御性不展示。
- **服务类型**：只从官网营业时间文本提取"对公/对私"，ATM 记"自助"，其余显示"未提供"。
- **坐标**：OSM/浏览器 WGS-84，高德 GCJ-02；调用前转换，返回后转回 WGS-84 再上 Leaflet。
- **高德配额**：每日总预算 + 周边独立预算 + 最小间隔三道闸；超限返回 `throttled`，不发出请求。
- **Agent 白名单**：`SourcePolicy` 只允许银行官网/政府/OSM 域名；抽取后先校验再复核。

## 验收门禁

```bash
pnpm check                 # lint + format + type + 75 单测
pnpm e2e                   # Playwright 20 通过 / 4 跳过
cd backend && mvn test     # 32 单测
docker compose --env-file .env build
curl -s localhost:18080/api/v1/health
```

发布前检查：`git status` 无未跟踪垃圾、`.env` 未入库、迁移已应用、Pages/CI 均为 success。

## 汇报格式

- 先给结论，再给数字与证据（接口返回、SQL 统计、截图路径）。
- 明确区分"已完成 / 受数据源限制 / 未开始"，不把计划写成结果。
- 对外文档只保留结论与操作步骤；过程与踩坑写入 `docs/internal/engineering-notes.md`。
