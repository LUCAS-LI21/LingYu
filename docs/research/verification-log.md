# 核查记录（Verification Log）

> 规则：任何进入文档的**事实型结论**（版本、License、star、API 参数、标准条款）都要留一行记录。
> 状态：✅ 已核验 / ⚠️ 部分核验 / ❌ 核验不通过 / ⬜ 未核验

| 日期       | 结论                                                                                                                   | 核验方式                                                                                                                | 状态                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 2026-11-05 | Agent Skills 格式：`name` ≤64 且小写连字符、`description` ≤1024                                                        | 打开 https://agentskills.io/specification（HTTP 200）读字段表                                                           | ✅                          |
| 2026-11-05 | `anthropics/skills` 仓库存在                                                                                           | 打开 https://github.com/anthropics/skills（HTTP 200）                                                                   | ✅                          |
| 2026-11-05 | AMapPoi 许可证为 GPL-3.0                                                                                               | 抓 raw LICENSE，读到 GPL v3 全文                                                                                        | ✅                          |
| 2026-11-05 | RuoYi-Vue-Plus 许可证为 MIT                                                                                            | 抓 master 分支 LICENSE，读到 MIT 全文                                                                                   | ✅                          |
| 2026-11-05 | GaoDe-poi-crawler 许可证为 MIT                                                                                         | main/master 的 LICENSE、LICENSE.md 全 404                                                                               | ❌ 结论作废，改为「未核实」 |
| 2026-11-05 | GaoDe-poi-crawler 仓库存在且为四叉树采集工具                                                                           | 打开仓库页（HTTP 200）                                                                                                  | ✅                          |
| 2026-11-05 | 高德/百度条款限制批量存储与转售                                                                                        | 仅子代理转述 README，未读条款原文                                                                                       | ⬜                          |
| 2026-11-05 | 高德服务协议：**API 数据只能展示、不得存储/缓存/抓取**（3.5 条）；不得用于模型训练（3.4）；交互数据归高德（4.6）       | 打开 lbs.amap.com/pages/terms 读条款正文（HTTP 200，页面标注 2025-12-03 更新）                                          | ✅                          |
| 2026-11-05 | 链家 robots.txt：`User-agent: * → Disallow: /*`（全站禁止）                                                            | 抓 www.lianjia.com/robots.txt（HTTP 200）                                                                               | ✅                          |
| 2026-11-05 | 贝壳 robots.txt：同上，全站禁止                                                                                        | 抓 www.ke.com/robots.txt（HTTP 200）                                                                                    | ✅                          |
| 2026-11-05 | 安居客 robots.txt：`User-agent: * → Allow: /`（另 Disallow 若干 bot）                                                  | 抓 www.anjuke.com/robots.txt（HTTP 200）                                                                                | ✅                          |
| 2026-11-05 | 工商银行 robots.txt：404（无声明）                                                                                     | 抓 www.icbc.com.cn/robots.txt                                                                                           | ✅                          |
| 2026-11-05 | OSM 深圳覆盖：福田+罗湖 78 km² 内 `amenity=bank\|atm` 节点 **182**、`landuse=residential` 面 **792**；响应含 ODbL 声明 | node fetch POST 两个 `out count;` 到 overpass-api.de（HTTP 200，32.4s / 41.2s）                                         | ✅                          |
| 2026-11-05 | Overpass 缺自定义 UA 时返回 406                                                                                        | 首次探测无 UA → 406；加 `User-Agent: poi-intel-demo/0.1 (contact)` 后 200                                               | ✅                          |
| 2026-11-05 | 本机 Java 17 / Maven 3.9 / Node 24 / pnpm 11 / MySQL 8 运行中                                                          | `java -version`、`mvn -v`、`node -v`、`pnpm -v`、`Get-Service MySQL80`                                                  | ✅                          |
| 2026-11-05 | Docker Desktop 未运行                                                                                                  | `docker info` 返回管道不存在                                                                                            | ✅                          |
| 2026-11-07 | 高德月配额：**个人认证** 基础 LBS 15 万、基础搜索 5,000、JS 图面初始化 150 万；**未认证 0**；免费额度自认证日起 1 年   | 打开 https://lbs.amap.com/pages/base_service_price 与 https://lbs.amap.com/upgrade#price 读配额表（HTTP 200，两页互证） | ✅                          |
| 2026-11-07 | 高德超量单价：基础 LBS 30 元/万次、基础搜索 30 元/万次（无折扣）、基础地图定位 3 元/万次；2025-05-20 起执行            | 同上两页「调用价格」段                                                                                                  | ✅                          |
| 2026-11-07 | 高德配额按"共享平台"合并：同一账号 API / JS / Android / iOS / 微信小程序 同类服务共用月配额                            | 同上配额表「配额共享平台」表述                                                                                          | ✅                          |
| 2026-11-07 | JS API 2021-12-02 后申请的 Key 必须配安全密钥（`securityJsCode`），可用代理转发                                        | 打开 https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode（HTTP 200）                                            | ✅                          |
| 2026-11-07 | URI API 单点标注 `uri.amap.com/marker` 支持 `coordinate=wgs84` 直传 OSM 坐标，文档未列 Key 与计费项                    | 打开 https://lbs.amap.com/api/uri-api/guide/mobile-web/point（HTTP 200）                                                | ⚠️ 免配额为推断，非官方承诺 |

## 还欠的核验（进设计阶段前必做）

- [x] 高德开放平台 Web 服务 API 的实际配额（2026-11-07 已核验，见 [ADR-0002](../adr/0002-高德服务选型与配额预算.md)）
- [ ] **OSM 深圳覆盖度实测**：改用脚本（`curl` + 较长超时）跑 Overpass，统计福田/南山各 5km² 内的 bank/atm/residential 数量
- [ ] 深圳市政府开放数据平台有哪些可下载数据集（opendata.sz.gov.cn），许可是否允许再分发
- [ ] Leaflet 与 vue-leaflet 对 Vue 3.5 的兼容性（待装包后跑一次 demo 验证，不能只看 README）
- [ ] MySQL 8 的 `ST_Distance_Sphere` 在本机版本上的可用性（待 `SELECT VERSION()` + 实测）
