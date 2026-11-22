# 文件架构与协作边界

> 三条并行工作线共用 **同一个后端**：Web 前端、小程序端、后端。
> 本文说明目录归属、接口契约与部署路径。

## 1. 仓库与工作区

| 工作区（worktree）               | 分支               | 负责内容                                                                                 | 不能碰                                   |
| -------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| `E:\TraeMaven\BISAI-AGENT`       | `main`             | 后端（`backend/`）、数据脚本（`scripts/`）、文档（`docs/`）、Web 前端（`src/` 兜底维护） | —                                        |
| `E:\TraeMaven\BISAI-FRONTEND`    | `feat/frontend-ui` | Web 前端 `src/`、`tests/`、`e2e/`                                                        | `backend/`、`docs/requirements/`         |
| `E:\TraeMaven\BISAI-MINIPROGRAM` | `feat/miniprogram` | 微信小程序（建议放 `miniprogram/`）                                                      | `backend/`、`src/`、`docs/requirements/` |

创建方式（已执行，供复现）：

```bash
git worktree add ../BISAI-MINIPROGRAM -b feat/miniprogram
```

**合并顺序**：后端契约变更先合 `main` → 前端/小程序 rebase `main` → 各自合并回 `main`。
契约文件（`docs/miniprogram/backend-contract.md`）**只能由后端维护者修改**。

## 2. 目录职责

```
BISAI-AGENT/
├── backend/                     Spring Boot 后端（唯一服务端）
│   └── src/main/java/com/poiintel/
│       ├── poi/                 POI 查询、详情、周边、统计、待定位小区、坐标提交
│       ├── admin/               运营后台：审核、导入、抓取任务、待定位银行
│       ├── agent/               DeepSeek 数据接入 Agent（建议生成 + 采纳）
│       ├── ingest/              OSM 抓取与调度（ScheduledIngest）
│       ├── feedback/            用户反馈
│       ├── live/                L2 实时层（高德，仅展示不落库）
│       ├── auth/                登录 + HMAC token
│       ├── common/              ApiResult、坐标转换、异常处理、CORS
│       ├── reference/           政府参考价数据
│       └── seed/                初始数据装载
├── src/                         Web 前端（Vue3 + TS + Tailwind + Leaflet）
│   ├── views/                   地图 / 列表 / 洞察 / 用户后台 / 管理后台
│   ├── components/              含 admin/ 下的 Agent、存量用地、待定位小区面板
│   ├── api/                     后端客户端（server.ts 负责 snake_case → camelCase）
│   ├── lib/                     nav（高德/腾讯链接）、viewport、queryTracker 等
│   └── types/                   POI 类型定义
├── scripts/                     采集与导入脚本（Node ESM）
│   ├── scrape-*.mjs             各银行官网适配器（8 家）
│   ├── import-*.mjs             政府数据集导入
│   ├── lib/                     http（curl 兜底）、coord（坐标系）、import-client
│   └── probe-*.mjs              侦察脚本（不参与运行）
├── docs/
│   ├── requirements/            赛题原文（基准）+ SRS + 合规
│   ├── design/                  数据接入 Agent、数据源矩阵
│   ├── miniprogram/             小程序后端契约 ← 小程序线必读
│   ├── architecture/            本文
│   ├── deploy/                  一键部署说明
│   └── internal/research/       调研与核查记录（不对外发布）
├── docker/ + Dockerfile*        部署（nginx 配置、compose）
├── data/                        本地数据产物（已 gitignore，除少量种子）
└── tests/ e2e/                  Web 前端测试
```

## 3. 后端接口面

完整契约见 [小程序后端契约](../miniprogram/backend-contract.md)，自描述接口：

```bash
curl http://127.0.0.1:8080/api/v1/meta
```

分组：

| 分组     | 前缀                                                              | 鉴权   | 说明                                  |
| -------- | ----------------------------------------------------------------- | ------ | ------------------------------------- |
| 公共查询 | `/api/v1/pois*`、`/stats`、`/land-parcels`、`/community-pending*` | 无     | 地图/列表/详情/周边/反向关联/统计     |
| 反馈     | `/api/v1/feedback`                                                | 无     | 纠错、补充、新增点位                  |
| 实时层   | `/api/v1/live/*`                                                  | 无     | 高德实时地址/周边（`no-store`）       |
| 运营     | `/api/v1/admin/*`                                                 | Bearer | 审核、导入、抓取任务、Agent、待定位置 |
| 认证     | `/api/v1/auth/login`                                              | —      | 返回 HMAC token                       |

**响应信封**：`{code, message, data}`，`code=0` 成功。

## 4. 坐标系（三端统一）

| 用途              | 字段              | 说明                 |
| ----------------- | ----------------- | -------------------- |
| 存储/距离计算     | `lng` `lat`       | WGS-84               |
| 国内地图展示/导航 | `gcjLng` `gcjLat` | 后端算好，前端直接用 |

小程序 `wx.openLocation` 要 GCJ-02；`wx.getLocation({type:'gcj02'})` 提交坐标前需转 WGS-84。

## 5. 小程序接入要点

1. **开发期**：后端默认监听 `0.0.0.0:8080`，微信开发者工具勾选「不校验合法域名」后可用
   `http://<你的局域网IP>:8080` 直连（手机与电脑同一网段，放行防火墙 8080）。
2. **上线期**：必须是 **HTTPS + 已备案域名**，并在小程序后台配置 `request` 合法域名。
3. 不需要 CORS（`wx.request` 无同源策略）；CORS 只对浏览器生效，当前仅放行 `127.0.0.1:5173`。
4. 运营接口需 `Authorization: Bearer <token>`；展示类接口一律免登录。

## 6. 构建与部署

| 目标       | 命令                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| 后端构建   | `cd backend && mvn -q -DskipTests package` → `target/poi-intel.jar`    |
| 后端测试   | `pnpm test:backend`（30 个 JUnit）                                     |
| Web 构建   | `pnpm build`（产物 `dist/`）                                           |
| Web 质量门 | `pnpm check`（lint + format + typecheck + 76 用例）                    |
| 一键部署   | `docker compose up -d --build`（见 [一键部署](../deploy/one-click-deployment.md)） |
| 小程序     | 微信开发者工具打开 `BISAI-MINIPROGRAM` 工作区                          |

## 7. 变更流程

1. 后端改接口 → 更新 `docs/miniprogram/backend-contract.md` + `/meta` 端点清单 → 合 `main`。
2. 前端/小程序 `git rebase main` 获取新契约。
3. 任一端改了响应字段，**先改后端并保持兼容**（只加不改），避免三端同时崩。
4. 提交信息带需求编号（`FR-Q-07` 等），详见 `AGENTS.md`。
