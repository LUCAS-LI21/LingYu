---
title: 邻域 POI 情报系统
doc: 设计文档（精简版）
team: 待填写
regno: 待填写
---

# 1 系统概述

## 1.1 建设目标

本系统面向"办金融业务、选居住地"两类场景：办业务要知道周边网点在哪、几点开门、能否办对私；选居住地要知道小区价格、年份与周边银行密度。这些信息分散在地图服务、银行官网、房产网站与政府部门，口径、坐标系、更新节奏都不一致。系统以深圳 10 区为范围，把可合法入库的银行网点与住宅小区汇聚到一处，提供地图、列表、组合关联三类查询，并以"用户反馈 + 查询热点"驱动数据持续更新，形成**采集 → 清洗入库 → 查询展示 → 反馈 → 审核生效 → 再采集**的闭环。截至 2026-11-22，已入库 POI 5,428 个，另有 4,940 个缺坐标小区进入众包标注通道。

## 1.2 现状规模

表 1 系统数据与运行规模（2026-11-20，取自生产库）

| 指标        | 数值           | 说明                                  |
| ----------- | -------------- | ------------------------------------- |
| 在线 POI    | 5,428          | 统一视图 `v_poi`，排除关闭点位        |
| 银行 / 小区 | 1,859 / 3,598  | 含 ATM 368 个；银行覆盖持牌网点 93.5% |
| 待定位点位  | 4,990          | 小区 4,940 + 网点 50，缺坐标不进主表  |
| 变更 / 溯源 | 4,509 / 10,723 | 版本记录 / 字段级来源                 |

# 2 系统架构

## 2.1 总体架构

系统采用前后端分离、单库多表加统一视图的分层结构。数据源层按三级授权隔离：OSM、银行官网、政府开放数据为 L1 可入库，高德 API 为 L2 仅展示、代码层禁止写库，链家与贝壳为 L3 禁用。采集层提供定时、手动、反馈定向、批量导入与 AI 抽取五条入口，统一走清洗与幂等去重。存储层由两张主表加 `v_poi` 视图承载查询，另设版本、字段级来源与闭环运行表。服务层以 Spring Boot 提供 REST 接口，鉴权、限流、空间查询与统计聚合在服务内完成；展示层有两个端：Vue 单页应用（地图、列表、洞察、用户后台、管理后台）与微信小程序（12 个页面，同仓维护），两端共用同一套接口。

![图 1 系统总体架构（五层分层 + 三条横切能力）](assets/fig1-architecture.png)

## 2.2 技术选型

表 2 技术选型与理由

| 层     | 选型                      | 理由                                          |
| ------ | ------------------------- | --------------------------------------------- |
| 前端   | Vue 3.5 + TS 5.9 + Vite 8 | 组合式 API 便于拆分地图与列表，构建快         |
| 地图   | Leaflet 1.9 + OSM 瓦片    | 免 Key、可离线兜底，规避存储与配额约束        |
| 后端   | Spring Boot 3.2 + Java 17 | 定时任务、事务、批量导入成熟，工具链齐备      |
| 数据库 | MySQL 8.0                 | `ST_Distance_Sphere` 原生球面距离，免空间扩展 |
| 部署   | Docker Compose + Nginx    | 一条命令拉起三服务，满足独立部署要求          |

## 2.3 关键设计决策

（1）**物理分表 + 统一视图**：银行与小区字段差异大，分表避免大量空列；查询侧用 `v_poi` 合并，分页、排序、筛选只写一套 SQL，`closed` 在视图层过滤。

（2）**三级授权落到表字段**：`storage_policy` 取 `storable / display_only / forbidden`，采集侧据此决定能否写库；高德通道响应头 `no-store`，不落库、不缓存；ATM 缺口同样走高德 L2 实时周边补足，库内 368 台仍是唯一可落库来源。

（3）**版本 + 字段级来源双轨**：`poi_version` 记整行变更快照，`poi_field_source` 按 `(poi_type, poi_id, field)` 记每个字段的最后写入者与来源 URL。

（4）**坐标双轨**：库内统一 WGS-84，对外同时返回 `lng/lat`（算距离）与 `gcjLng/gcjLat`（跳转高德、腾讯、微信地图），避免 500 米级偏移。

（5）**热点优先级固定**：`priority = 查询次数 + 2 × 零结果次数`，零结果权重更高，调度器只读聚合表。

# 3 业务闭环流程

## 3.1 闭环主干

![图 2 业务闭环流程（五步主干 + 三条链路）](assets/fig2-loop.png)

主干五步为采集、清洗入库、查询展示、用户反馈、审核与生效，审核结果既写回主表，又作为下一轮采集的输入。围绕主干下沉三条可独立演示的链路：A 纠错解决"数据不对"，B 补采解决"这里没有数据"，C 热点解决"哪里该优先更新"。三条链路共用同一套表与接口，只是触发源与处理分支不同。

## 3.2 三条闭环

表 3 三条闭环的触发、处理与可见结果

| 链路   | 触发与处理                                                    | 可见结果                               |
| ------ | ------------------------------------------------------------- | -------------------------------------- |
| A 纠错 | 用户提交反馈；低风险字段自动采纳，关闭/改名/改坐标/新增转人工 | 同事务写版本并改主表，接口立即返回新值 |
| B 补采 | 审核通过"新增点位"；落暂存表并以锚点 ±1.3km 建定向任务        | 新点位入库；抓不到的留在待定位名录     |
| C 热点 | 查询写 `query_log`；每日或手动重算 `hot_region`               | 定时任务按优先级选网格抓取             |

当前度量：反馈闭环时延小于 1 秒（提交与版本落库同秒），反馈触发定向任务 6 条，字段级溯源 10,723 条；任务有效产出率 58.8%，银行覆盖率 93.5%。

# 4 核心接口定义

## 4.1 通用约定

- **响应信封**：统一返回 `{code, message, data}`，`code=0` 为成功；业务错误用 HTTP 状态码表达（400 参数、401 未登录、404 不存在、409 冲突、429 限流、405 方法错）。
- **鉴权**：`/api/v1/admin/**` 需 `Authorization: Bearer <token>`，HMAC-SHA256 签名，默认 12 小时有效；审核人取自 token 主体。
- **坐标系**：请求与存储统一 WGS-84，`gcjLng/gcjLat` 为服务端换算结果，仅供跳转国内地图。

## 4.2 接口清单

表 4 核心接口清单（共 20 个，此处列主链路）

| #   | 方法 | 路径                             | 说明                                                        |
| --- | ---- | -------------------------------- | ----------------------------------------------------------- |
| 1   | GET  | `/health`、`/meta`               | 健康检查；元信息与接口自描述                                |
| 2   | GET  | `/pois`                          | 列表/地图：类型、区域、关键词、价格、年代、bbox、排序、分页 |
| 3   | GET  | `/pois/{id}`                     | 详情，含 GCJ-02 坐标                                        |
| 4   | GET  | `/pois/nearby`                   | 周边银行，球面距离，支持网点/ATM 过滤                       |
| 5   | GET  | `/pois/{id}/nearest-banks`       | 某小区最近的 N 家银行                                       |
| 6   | GET  | `/pois/{id}/nearby-communities`  | 某银行服务半径内的小区（反向关联）                          |
| 7   | GET  | `/pois/{id}/sources`             | 字段级数据来源                                              |
| 8   | GET  | `/stats`                         | 品牌 Top8、价格分桶、区域分布、网格密度                     |
| 9   | GET  | `/community-pending`             | 待定位小区名录（分页、按区、关键词）                        |
| 10  | POST | `/community-pending/{id}/locate` | 用户提交坐标，进审核队列                                    |
| 11  | POST | `/feedback`                      | 提交纠错/关闭/新增反馈                                      |
| 12  | GET  | `/live/address`                  | L2 实时地址（高德，不落库）                                 |
| 13  | POST | `/auth/login`                    | 运营登录，返回 Bearer token                                 |
| 14  | GET  | `/admin/overview`、`/admin/jobs` | 概览；任务列表 / 手动触发                                   |
| 15  | POST | `/admin/feedback/{code}/approve` | 采纳：分流生效、写版本、必要时建任务                        |
| 16  | POST | `/admin/hotspots/recompute`      | 重算热点                                                    |

## 4.3 关键接口详述

### 4.3.1 GET /api/v1/pois

参数：`types`、`district`、`keyword`、`branchType`、`minPrice`/`maxPrice`、`minYear`/`maxYear`、`west`/`south`/`east`/`north`、`sort`、`page`、`size`（≤20,000）。

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "id": "osm-node-4866753941",
        "type": "bank",
        "name": "Bank of China",
        "district": "宝安区",
        "lng": 113.841718,
        "lat": 22.604593,
        "gcjLng": 113.846699,
        "gcjLat": 22.601611,
        "brand": "中国银行",
        "branchType": "atm",
        "source": "OpenStreetMap",
        "license": "ODbL"
      }
    ],
    "total": 5104,
    "page": 1,
    "size": 20
  }
}
```

### 4.3.2 GET /api/v1/pois/nearby

参数：`lng`、`lat`（WGS-84，必填）、`radius`（米，默认 1000）、`branchType`、`limit`（≤200）。先用半径换算的矩形走 `(lat, lng)` 索引预筛，再用 `ST_Distance_Sphere` 精算。

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "poi": {
          "id": "import-249265493",
          "name": "招商银行深圳时代广场支行",
          "lng": 114.058673,
          "lat": 22.542872
        },
        "distance": 83.34
      }
    ],
    "total": 47
  }
}
```

### 4.3.3 反馈提交与采纳

`POST /feedback` 返回受理编号；`POST /admin/feedback/{code}/approve` 按类型分流：普通纠错写主表并记版本，`add` 类型落暂存表并以锚点建定向任务（实测返回 `status=need_refetch`、`pendingStaged=true`、`jobId=440`）；重复采纳返回 409。

# 5 关键表结构

## 5.1 数据模型

![图 3 核心数据模型（主表、视图、溯源与暂存表）](assets/fig3-er.png)

两类 POI 分表存储，经 `v_poi` 视图合并；反馈、版本、字段级来源通过 `poi_type + poi_id` 与主表关联，回答"谁在什么时候把哪个字段改成什么"；暂存表承接有名称地址但无坐标的数据，转正后写入主表。

## 5.2 表清单

表 5 数据表清单（17 张表 + 1 个视图）

| 分组        | 表名                                                         | 作用                                |
| ----------- | ------------------------------------------------------------ | ----------------------------------- |
| 主表 / 视图 | `poi_bank`、`poi_community`、`v_poi`                         | 银行网点、住宅小区、统一查询面      |
| 溯源        | `poi_version`、`poi_field_source`                            | 整行变更留痕、字段级来源            |
| 闭环        | `feedback`、`ingest_job`、`query_log`、`hot_region`          | 反馈、任务、查询日志、热点          |
| 暂存        | `bank_pending`、`community_pending`、`coordinate_submission` | 缺坐标点位与用户提交的坐标          |
| 治理        | `ds_source`、`dedupe_log`、`agent_run`                       | 数据源策略、去重黑名单、AI 运行记录 |
| 其他        | `sys_user`、`land_parcel`                                    | 运营账号；存量住宅用地（宗地级）    |

## 5.3 核心表字段

表 6 `poi_bank`（银行网点）

| 字段                                  | 类型               | 说明                                  |
| ------------------------------------- | ------------------ | ------------------------------------- |
| `id` / `name` / `brand`               | VARCHAR            | 来源内唯一标识、网点名、归一后的品牌  |
| `branch_type`                         | VARCHAR(16)        | `branch` 网点 / `atm` 自助设备        |
| `address` / `district`                | VARCHAR            | 门牌地址、行政区（深圳 10 区）        |
| `lng` / `lat`                         | DECIMAL(10,6)      | WGS-84 坐标，建 `(lat, lng)` 复合索引 |
| `phone` / `opening_hours`             | VARCHAR            | 电话、营业时间                        |
| `source` / `license` / `source_level` | VARCHAR            | 来源名、许可、授权级别                |
| `status` / `updated_at`               | VARCHAR / DATETIME | `active`/`closed`；最后更新时间       |

表 7 `poi_community`（住宅小区）

| 字段                                     | 类型              | 说明                                     |
| ---------------------------------------- | ----------------- | ---------------------------------------- |
| `id` / `name` / `address`                | VARCHAR           | 主键、小区名、地址                       |
| `lng` / `lat`                            | DECIMAL(10,6)     | WGS-84 坐标                              |
| `built_year` / `avg_price`               | SMALLINT / INT    | 建成年份、官方参考均价（元/㎡）          |
| `avg_price_demo`                         | INT               | 演示均价，仅展示，不参与筛选、排序、统计 |
| `property_fee` / `property_company`      | DECIMAL / VARCHAR | 物业费、物业公司                         |
| `rent_dc` / `rent_gc` / `rent_dmd`       | DECIMAL(8,2)      | 政府租赁参考价（多层/高层/低密度）       |
| `surround_bank_count` / `nearest_bank_m` | INT               | 1 公里内银行数、最近银行距离             |

表 8 闭环与溯源表（节选）

| 表            | 关键字段                                                                                    | 说明                                                  |
| ------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `feedback`    | `code`(UNIQUE)、`poi_type`、`poi_id`、`type`、`field_name`、`status`、`reviewer`            | 状态机 `pending → approved / need_refetch / rejected` |
| `poi_version` | `poi_type`、`poi_id`、`change_type`、`before_json`、`after_json`、`operator`、`feedback_id` | 只追加，可按点位回放                                  |
| `ingest_job`  | `trigger_type`、`scope_value`、`status`、`fetched_count`、`error_summary`、`feedback_code`  | 任务结束回写反馈状态                                  |

## 5.4 索引与约束

- **空间与去重**：两张主表建 `(lat, lng)` 复合索引；来源标识为主键，跨源重复按"名称归一 + 165 米球面距离"判定，删除项进 `dedupe_log` 作抓取黑名单。
- **幂等与唯一性**：抓取按主键 upsert；`feedback.code`、`ds_source.code`、`sys_user.username`、`hot_region(grid, stat_date)` 建唯一索引；结构演进由 `SchemaMigrator` 按 `db/migration/V1–V3` 顺序执行。

# 6 约束与后续

**已知限制**：`v_poi` 为 `UNION ALL` 视图，全量拉取 5,000 条 P95 约 1 秒；公共 Overpass 不稳定，任务有效产出率 58.8%，靠多镜像与两段式抓取兜底；未引入 Flyway、TLS 与角色分权；演示价已清理（`demo_attributes` 全为 0），均价只保留 1,093 条官方参考价，其余前端显示「暂无」。

**后续演进**：小程序端已落地（12 个页面，与 Web 同仓，共用接口）；补齐抓取任务回写反馈状态；按数据源维度做质量看板。
