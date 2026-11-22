# 邻域 · 微信小程序端

与 Web 端（`BISAI-FRONTEND`）共用同一个 Spring Boot 后端，UI 沿用 Web 的蓝白卡片体系，覆盖地图、列表、详情、洞察、用户反馈、待定位小区、存量用地与运营后台。

## 1. 打开与联调

1. 启动后端（默认 `http://127.0.0.1:8080`），确认：
   ```bash
   curl http://127.0.0.1:8080/api/v1/health
   ```
2. 微信开发者工具 → 导入项目 → 选择本目录 `miniprogram/`（`project.config.json` 在此目录）。
3. AppID 使用测试号 `touristappid`，或替换成自己的 AppID。
4. 「详情 → 本地设置」勾选 **不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**（开发期 HTTP 直连 8080 必需）。
5. 编译；首页为地图。

> 真机预览：把 `config.js` 的 `API_BASE` 改成电脑局域网 IP（如 `http://192.168.1.20:8080`），手机与电脑同一网段并放行 8080 防火墙。
> 上线必须换成 HTTPS 域名，并在小程序后台配置 `request` 合法域名。

## 2. 配置

- `config.js`：`API_BASE`、请求超时、版本号。
- `project.config.json`：AppID、编译设置（`urlCheck: false` 仅用于开发）。
- `app.json`：页面、tabBar、定位权限说明。
- `utils/api.js`：统一 `{code,message,data}` 信封、Bearer token、错误提示。
- `utils/coord.js`：GCJ-02 → WGS-84（待定位小区提交用）。
- `utils/poi.js`：后端字段 → 小程序内部 POI 结构。

## 3. 页面与功能

| 页面 | 路径 | 对应 Web |
| --- | --- | --- |
| 开场 | `pages/intro` | 品牌粒子开场，轻触可跳过 |
| 地图 | `pages/map` | 地图查询：视野拉取、类型/区域筛选、搜索、marker 详情、导航、纠错 |
| 列表 | `pages/list` | 列表查询：关键词、区域、类型、排序、分页加载 |
| 详情 | `pages/detail` | 点位详情：小区画像、网点信息、最近银行/周边小区、字段级来源、实时地址/周边 |
| 洞察 | `pages/stats` | 数据洞察：KPI、品牌、均价分布、区域对比、查询热点、待定位/土地入口 |
| 我的 | `pages/me` | 用户后台：本机访客档案、反馈入口、管理后台入口 |
| 纠错 | `pages/feedback` | 纠错/补充：搜索点位、反馈类型、字段、说明、联系方式、受理编号 |
| 我的反馈 | `pages/history` | 本机反馈记录与状态 |
| 待定位小区 | `pages/pending` | 名录、区域/关键词筛选、实地选点提交坐标（GCJ→WGS） |
| 存量用地 | `pages/land` | 宗地级政府开放数据、区域筛选、面积/类型/状态 |
| 查询热点 | `pages/hotspots` | query_log 聚合的热门网格（公开 `/hotspots`），空结果可作为采集优先级参考 |
| 管理后台 | `pages/admin` | 运营登录、概览、反馈审核、Agent 建议（含发起/采纳）、抓取任务、查询热点 |

管理后台演示账号：`operator`，口令由后端 `OPERATOR_PASSWORD` 提供（未设置/为空时后端拒绝启动；`operator123` 已不再默认可登录）。

## 4. 后端契约

必读：

- `docs/miniprogram/backend-contract.md`
- `docs/architecture/file-architecture.md`
- `GET /api/v1/meta`：启动自检（坐标约定、接口清单）

公共接口无需登录；运营接口使用 `Authorization: Bearer <token>`。地图/导航必须使用后端返回的 `gcjLng / gcjLat`，**不要**把 WGS-84 的 `lng/lat` 直接喂给微信地图。

## 5. 质量自检

本端是原生微信小程序，没有 Node 构建产物；提交前至少跑：

```bash
# 1. 后端小程序接口冒烟（在仓库根目录）
node scripts/smoke-miniprogram.mjs

# 2. JS / JSON 静态检查（PowerShell）
Get-ChildItem miniprogram -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
Get-ChildItem miniprogram -Recurse -Filter *.json | ForEach-Object { Get-Content $_.FullName -Raw | ConvertFrom-Json | Out-Null }

# 3. 微信开发者工具编译，检查 Console 无报错
```

## 6. 已知边界

- 用户侧与 Web 一样是**访客模式**：昵称/联系方式只存本机，反馈进入服务端审核队列。
- 运营后台聚焦移动端高频操作：反馈审核、Agent、任务、热点、坐标审核；存量用地/待定位为只读浏览入口。复杂的导入、批量标注与数据维护仍建议在 Web 运营后台完成。
- 实时层依赖后端 `AMAP_KEY`；未配置时页面会展示「合规降级」提示，不伪造数据。
- 小程序不能复用 Leaflet，地图使用原生 `<map>`；底图控件与 Web 的 Leaflet 视觉不同，但筛选、marker、详情与导航流程一致。
