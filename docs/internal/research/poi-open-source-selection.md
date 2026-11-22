# 开源方案调研：银行 / 小区 POI 采集与查询系统

> 核查时间 2026-11-04。star 与"最近活跃"（末次 push）取自 GitHub 实时数据；License 对照各仓库 LICENSE 原文核实。标「未核实」者表示未亲眼在页面确认。

## A. 可嵌入 Vue3 的地图组件

| 仓库                                                                              | License      | 技术栈              | Star  | 最近活跃   | 复用点                                                                                                                                                                                                                                                   | 不能直接用                                                                                                  |
| --------------------------------------------------------------------------------- | ------------ | ------------------- | ----- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [Leaflet/Leaflet](https://github.com/Leaflet/Leaflet)                             | BSD-2-Clause | 原生 JS             | 45.8k | 2026-11-03 | Marker/Popup/TileLayer/图层组齐全；配 [vue-leaflet](https://github.com/vue-leaflet/vue-leaflet)（MIT, 860★, 2024-07）得 Vue3 组件；配 [leaflet-geoman](https://github.com/Geoman-io/leaflet-geoman)（MIT, 2.4k★, 2026-11-03）直接得到矩形/多边形**框选** | 只管"画"。高德瓦片是 GCJ-02，与 WGS-84 数据混用会整体偏移；`>1万`点需自接聚合；没有行政区/POI 检索/路径规划 |
| [openlayers/openlayers](https://github.com/openlayers/openlayers)                 | BSD-2-Clause | 原生 JS             | 12.6k | 2026-11-02 | 投影转换（4326↔3857）、Draw/Modify 交互、WMS/WMTS 最完整；Vue3 封装 [vue3-openlayers](https://github.com/MelihAltintas/vue3-openlayers)（MIT, 798★, 2026-02）                                                                                            | API 偏 GIS，学习曲线陡；与 Element Plus 无风格集成；业务表格/表单仍全手写                                   |
| [yangyanggu/vue-amap](https://github.com/yangyanggu/vue-amap)（@vuemap/vue-amap） | MIT          | Vue2/3 + 高德 JSAPI | 352   | 2025-09-01 | 组件化封装 AMap：marker、信息窗体、行政区、图层切换，正好对应"标注/弹窗/图层"                                                                                                                                                                            | 强依赖高德 JS Key（域名白名单+配额）；单人维护；深度定制仍要读 AMap 原生文档                                |

> 备注：`maplibre/maplibre-gl-js`（BSD-3, 12.0k★, 2026-11-04）渲染性能最好，但高德不提供矢量瓦片，国内自建底图合规成本高，本项目不建议作首选。

## B. POI 采集脚本

| 仓库                                                                          | License                                                           | 技术栈                                     | Star | 最近活跃           | 复用点                                                                                               | 不能直接用                                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ | ---- | ------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Civitasv/AMapPoi](https://github.com/Civitasv/AMapPoi)（POIKit）             | GPL-3.0                                                           | JavaFX8 + GeoTools + MyBatis-Plus + SQLite | 552  | 2022-10-17（停更） | **算法最值钱**：网格四叉树切分+阈值+断点续爬+多 Key 轮询+GCJ02/WGS84/BD09 转换，输出 csv/geojson/shp | GPL-3.0 传染，分发即须开源；桌面 GUI 不是服务；SQLite；无百度源；无增量/复查              |
| [zdbpython/GaoDe-poi-crawler](https://github.com/zdbpython/GaoDe-poi-crawler) | **未核实**（`LICENSE` / `LICENSE.md` 在 main、master 分支均 404） | Python + tkinter                           | 13   | 2026-02-16         | 四叉树递归拆分、多 Key 轮询、坐标转换的**思路**可参考                                                | 单人新项目、无测试无 CI；只落 CSV，无 MySQL/调度/鉴权；**许可证缺失，复制代码有法律风险** |
| [YeshuoShu/BaiduAOISpider](https://github.com/YeshuoShu/BaiduAOISpider)       | 未核实                                                            | Python                                     | 81   | 2023-04-18         | 采的是百度 **AOI 边界**——小区轮廓、银行网点面要素正好可用                                            | 不是 POI 列表；无人维护；License 未核实，商用前必须确认                                   |

## C. 去重与地址标准化

| 仓库                                                                                                                | License | 技术栈 | Star | 最近活跃   | 复用点                                                              | 不能直接用                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ------- | ------ | ---- | ---------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [dedupeio/dedupe](https://github.com/dedupeio/dedupe)                                                               | MIT     | Python | 4.5k | 2025-07-29 | 跨源"同网点/同小区"模糊匹配（blocking + 相似度），比手写 SQL 规则准 | Python 库，Java 后端要独立服务化；需人工标注训练对，冷启动有成本 |
| [DQinYuan/chinese_province_city_area_mapper](https://github.com/DQinYuan/chinese_province_city_area_mapper)（cpca） | MIT     | Python | 1.8k | 2024-03-19 | 中文地址抽省/市/区并归一，地址标准化第一步                          | 只抽行政区，不处理门牌/街道/别名；行政区划表需自行更新           |
| [openvenues/libpostal](https://github.com/openvenues/libpostal)                                                     | MIT     | C      | 4.9k | 2026-05-13 | 地址解析/标准化，国际地址强                                         | 中文（尤其"XX小区3栋"）效果一般；需编译+数 GB 数据，镜像大       |

## D. Spring Boot 后台脚手架

| 仓库                                                                  | License                                | 技术栈                                                 | Star  | 最近活跃   | 复用点                                                                                            | 不能直接用                                                                   |
| --------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------ | ----- | ---------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [dromara/RuoYi-Vue-Plus](https://github.com/dromara/RuoYi-Vue-Plus)   | MIT                                    | Spring Boot 3 + JDK17 + MyBatis-Plus + Sa-Token + Vue3 | 2.8k  | 2026-11-04 | 与你的 Java17 栈最贴：权限/字典/操作日志/定时任务/多租户齐全，"纠错单→审核"可直接复用状态机与审计 | 纯后台壳，零 GIS 能力；组件多（WarmFlow 等），裁剪有成本                     |
| [yangzongzhuan/RuoYi-Vue](https://github.com/yangzongzhuan/RuoYi-Vue) | MIT                                    | Spring Boot + Vue2（Vue3 另有版本）                    | 3.3k  | 2026-08-26 | 代码生成器、菜单权限、Quartz 定时任务，社区资料最多                                               | 前端以 Vue2+Element UI 为主，与你现有 Vue3+Element Plus 骨架冲突，替换成本高 |
| [jeecgboot/JeecgBoot](https://github.com/jeecgboot/JeecgBoot)         | Apache-2.0（附"不得开发竞争软件"条款） | Spring Boot + Vue3 + 低代码                            | 48.4k | 2026-11-03 | 在线报表/大屏能把④的统计图表省一大半                                                              | 体系重、侵入强，小系统属过度设计；附加条款法律边界模糊，商用需法务确认       |

## E. 完整类系统

**没找到**"POI 采集 + 地图展示 + 纠错闭环"三者齐全的开源项目。最接近的三个都只覆盖一段：

| 仓库                                                                    | License | Star | 最近活跃   | 覆盖了哪段                                              | 为何不能直接用                                      |
| ----------------------------------------------------------------------- | ------- | ---- | ---------- | ------------------------------------------------------- | --------------------------------------------------- |
| [openplans/shareabouts](https://github.com/openplans/shareabouts)       | 未核实  | 285  | 2026-09-22 | 公众在地图上提交点位 + 后台审核，反馈闭环的数据模型可抄 | Django 老项目，面向参与式制图，无采集/无 POI 主数据 |
| [Andytonglove/POI_project](https://github.com/Andytonglove/POI_project) | 未核实  | 9    | 2022-04-22 | 采集 + 核验的移动端流程                                 | 微信小程序，非 Web；停更                            |
| [tyrasd/overpass-turbo](https://github.com/tyrasd/overpass-turbo)       | MIT     | 1.3k | 2026-10-25 | OSM 数据挖掘 Web 工具，可作免费补充数据源的查询参考     | 是查询工具，不是业务系统                            |

## 结论

**最值得直接用的 2–3 个：**

1. **Leaflet + vue-leaflet + leaflet-geoman**（全 MIT/BSD）——地图标注、弹窗、图层切换、框选四件事一次到位，直接嵌进现有 Vue3 + Element Plus，不用改骨架。
2. **RuoYi-Vue-Plus**（MIT、JDK17、当天仍在提交）——只取权限、字典、定时任务、审计日志，省掉"纠错→审核→重抓"的流程地基；别用 JeecgBoot。
3. **算法思路抄 AMapPoi，代码自己写**——四叉树切分 + 断点续爬 + 多 Key 轮询是这类系统真正的难点。AMapPoi 是 GPL-3.0（已核实 LICENSE 原文），GaoDe-poi-crawler 许可证缺失（已核实 404），**两者都不能复制代码**，只能读思路后自行实现。

**自己做更划算的：** 周边 N 公里查询（MySQL 8 `ST_Distance_Sphere` + 空间索引）、多条件列表分页、增量更新 diff、纠错审核状态机、Docker Compose 编排。这几块没有现成轮子，硬套脚手架反而更慢。

**合规红线（先于编码）：** 有说法称高德/百度开放平台条款限制批量存储与转售（子代理转述自 AMapPoi 与 GaoDe-poi-crawler 的 README，**主代理未逐字核验条款原文**）。落地方案上：① 优先使用官方授权数据服务；② 演示数据可用 OSM/Overpass（ODbL，需署名+同许可）补充 `amenity=bank` 与小区面数据；③ 每类采集实现前过一遍 `docs/requirements/03-compliance-and-data-sources.md` 检查清单，并在正式使用前**自行阅读开放平台最新服务条款**。

---

## 核查记录（主代理复核，2026-11-05）

| 结论                       | 核验方式                                                            | 结果                                                         |
| -------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| AMapPoi 为 GPL-3.0         | 抓取 `raw.githubusercontent.com/Civitasv/AMapPoi/master/LICENSE`    | ✅ HTTP 200，正文为 GNU GPL v3 全文                          |
| RuoYi-Vue-Plus 为 MIT      | 抓取 `.../dromara/RuoYi-Vue-Plus/master/LICENSE`（`main` 分支 404） | ✅ HTTP 200，正文为 MIT License                              |
| GaoDe-poi-crawler 为 MIT   | 抓取 `main`/`master` 的 `LICENSE`、`LICENSE.md`                     | ❌ 全部 404，**原结论"MIT"不成立**，已改为「未核实」         |
| GaoDe-poi-crawler 仓库存在 | 打开仓库页                                                          | ✅ HTTP 200，描述确为"高德地图 POI 采集工具，四叉树递归拆分" |
| 高德条款限制批量存储/转售  | —                                                                   | ⚠️ 未逐字核验，已降级为"待自行阅读条款"                      |

> 教训：子代理给出的 License 结论必须自己拉一次 LICENSE 原文，否则"MIT 可自由改"这种话会直接把人带进法律风险。
