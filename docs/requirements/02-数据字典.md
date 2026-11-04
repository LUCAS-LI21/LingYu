# 数据字典（v0.1 草案）

> 需求阶段只定**实体与关键字段**，最终 DDL 在《设计》阶段确定。目标库：MySQL 8.0（空间函数可用，但主查询走「外包框 + geohash + 球面距离」以保证可移植）。

## 1. 实体总览

```text
ds_source 1 ──< ingest_job
ds_source 1 ──< poi_bank / poi_community
poi_bank 1 ──< poi_version
poi_community 1 ──< poi_version
poi_bank / poi_community 1 ──< feedback
sys_user 1 ──< feedback（提交/审核）
query_log >── hot_region（聚合）
sys_user 1 ──< audit_log
```

## 2. 表设计

### 2.1 `ds_source` 数据源

| 字段           | 类型               | 说明                                                                                                 |
| -------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| id             | bigint PK          |                                                                                                      |
| code           | varchar(32) UNIQUE | `amap_api` / `seed_demo` / `bank_icbc`                                                               |
| name           | varchar(64)        | 展示名                                                                                               |
| type           | varchar(16)        | `official_api` / `open_data` / `public_page` / `seed`                                                |
| base_url       | varchar(255)       | API 基址                                                                                             |
| auth_config    | json               | Key/Secret（**加密存储**，不落日志）                                                                 |
| rate_limit_qps | decimal(5,2)       | 默认 1.00                                                                                            |
| daily_quota    | int                | 日调用上限                                                                                           |
| robots_policy  | varchar(16)        | `n/a`（官方 API）/ `checked_allow` / `checked_disallow`                                              |
| storage_policy | varchar(16)        | **授权级别**：`storable`(L1 可入库) / `display_only`(L2 仅展示) / `forbidden`(L3 禁用)，写库前强校验 |
| enabled        | tinyint(1)         | 开关                                                                                                 |
| notes          | varchar(512)       | 合规备注、许可依据（如 `ODbL`、`协议3.5禁止存储`）                                                   |

### 2.2 `ingest_job` 抓取任务

| 字段                                                                          | 类型          | 说明                                                      |
| ----------------------------------------------------------------------------- | ------------- | --------------------------------------------------------- |
| id                                                                            | bigint PK     |                                                           |
| source_id                                                                     | bigint FK     |                                                           |
| trigger_type                                                                  | varchar(16)   | `manual` / `schedule` / `feedback` / `hotspot`            |
| scope_type                                                                    | varchar(16)   | `city` / `radius` / `bbox`                                |
| scope_value                                                                   | json          | `{"city":"330100","center":[120.15,30.28],"radius":1000}` |
| poi_types                                                                     | varchar(64)   | `bank,community`                                          |
| status                                                                        | varchar(16)   | `pending/running/success/partial/failed/cancelled`        |
| fetched_count / inserted_count / updated_count / skipped_count / failed_count | int           | 统计                                                      |
| error_summary                                                                 | varchar(1024) | 失败摘要                                                  |
| trace_id                                                                      | varchar(64)   | 链路追踪                                                  |
| started_at / finished_at                                                      | datetime      |                                                           |
| created_by                                                                    | bigint        | 触发人（系统任务为 NULL）                                 |

索引：`idx_source_status(source_id,status)`、`idx_created(created_at)`。

### 2.3 `poi_bank` 银行网点

| 字段                                         | 类型                  | 说明                                                                 |
| -------------------------------------------- | --------------------- | -------------------------------------------------------------------- |
| id                                           | bigint PK             |                                                                      |
| source_id / source_ref                       | bigint / varchar(128) | **UNIQUE(source_id, source_ref)** 天然去重键                         |
| name                                         | varchar(128)          | 网点名                                                               |
| brand                                        | varchar(64)           | 归一后品牌：中国工商银行…                                            |
| branch_type                                  | varchar(16)           | `branch` 网点 / `atm` 自助银行 / `counter` 柜台                      |
| address                                      | varchar(255)          | 标准化后地址                                                         |
| province / city / district / street          | varchar(64)           | 行政区划                                                             |
| lng / lat                                    | decimal(10,6)         | **统一 GCJ-02**                                                      |
| raw_lng / raw_lat                            | decimal(10,6)         | 原始坐标（可追溯）                                                   |
| geohash                                      | varchar(12)           | 前缀索引，粗筛                                                       |
| phone                                        | varchar(64)           | 允许 `-`、`转`                                                       |
| business_hours                               | varchar(128)          | 如 `周一至周五 09:00-17:00`                                          |
| services                                     | json                  | 对公/对私/外币/理财…                                                 |
| status                                       | varchar(16)           | `active/closed/pending_verify/rejected`                              |
| confidence                                   | decimal(3,2)          | 0-1，多源一致则高                                                    |
| raw_payload_id                               | bigint                | 指向原始响应                                                         |
| service_radius                               | int                   | 服务半径（米），默认 1000；用于 FR-Q-08「银行覆盖小区」              |
| field_source                                 | json                  | 字段级来源标记，如 `{"phone":"A","business_hours":"C"}`，见 SRS §7.4 |
| first_seen_at / last_fetched_at / updated_at | datetime              | 新鲜度依据                                                           |

索引：`idx_city_district(city,district)`、`idx_geo(lat,lng)`、`idx_geohash(geohash)`、`idx_status(status)`、`idx_fetched(last_fetched_at)`。

### 2.4 `poi_community` 小区

| 字段                                                                     | 类型         | 说明                                                                 |
| ------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------- |
| id / source_id / source_ref / name / address / 行政区划 / 坐标 / geohash | 同上         | UNIQUE(source_id, source_ref)                                        |
| alias                                                                    | varchar(255) | 别名（多个用 `,`）                                                   |
| built_year                                                               | smallint     | 1900 ~ 当前年                                                        |
| avg_price                                                                | int          | 元/㎡，1000 ~ 300000                                                 |
| property_fee                                                             | decimal(6,2) | 元/㎡·月                                                             |
| developer                                                                | varchar(128) | 开发商                                                               |
| property_company                                                         | varchar(128) | 物业公司                                                             |
| households                                                               | int          | 户数                                                                 |
| building_count                                                           | int          | 楼栋数                                                               |
| green_rate                                                               | decimal(4,2) | 绿化率                                                               |
| facilities                                                               | json         | 周边配套标签（可由系统计算：1km 内银行/ATM/学校/医院计数）           |
| field_source                                                             | json         | 字段级来源标记，如 `{"avg_price":"U","built_year":"S"}`，见 SRS §7.4 |
| status / confidence / first_seen_at / last_fetched_at / updated_at       | 同上         |                                                                      |

### 2.5 `poi_version` 版本历史（闭环可追溯的关键）

| 字段                     | 类型         | 说明                               |
| ------------------------ | ------------ | ---------------------------------- |
| id                       | bigint PK    |                                    |
| poi_type                 | varchar(16)  | `bank` / `community`               |
| poi_id                   | bigint       |                                    |
| version_no               | int          | 同 POI 自增                        |
| change_type              | varchar(16)  | `insert/update/merge/close/reopen` |
| before_json / after_json | json         | 变更前后快照                       |
| changed_fields           | varchar(512) | `avg_price,built_year`             |
| source_id                | bigint NULL  | 系统变更来源                       |
| operator_type            | varchar(16)  | `system/user/admin/feedback`       |
| operator_id              | bigint NULL  |                                    |
| feedback_id              | bigint NULL  | 由哪条反馈引起                     |
| created_at               | datetime     |                                    |

索引：`idx_poi(poi_type,poi_id,version_no)`。

### 2.6 `feedback` 用户反馈

| 字段                                    | 类型                 | 说明                                                           |
| --------------------------------------- | -------------------- | -------------------------------------------------------------- |
| id / code                               | bigint / varchar(24) | `FB20261105-0001` 便于用户查询                                 |
| poi_type / poi_id                       | varchar / bigint     | 新增点位时 poi_id 为空                                         |
| type                                    | varchar(16)          | `error` / `closed` / `add`                                     |
| field_name                              | varchar(64)          | 纠错的目标字段                                                 |
| old_value / new_value                   | varchar(512)         | 差异对比用                                                     |
| evidence_url                            | varchar(512)         | 证据（截图/链接）                                              |
| description                             | varchar(1024)        | 补充说明                                                       |
| contact                                 | varchar(64)          | 访客联系方式（脱敏展示）                                       |
| submit_lng / submit_lat                 | decimal(10,6)        | 「新增点位」的位置                                             |
| user_id / ip                            | bigint / varchar(45) | 防滥用                                                         |
| risk_level                              | varchar(8)           | `low/high`                                                     |
| status                                  | varchar(16)          | `pending/auto_applied/approved/rejected/need_refetch/resolved` |
| reviewer_id / review_note / reviewed_at |                      | 审核信息                                                       |
| related_job_id                          | bigint               | 触发的抓取任务                                                 |
| created_at                              | datetime             |                                                                |

索引：`idx_status_created(status,created_at)`、`idx_poi(poi_type,poi_id)`。

### 2.7 `query_log` 查询日志（热点来源）

| 字段                                    | 类型                 | 说明                                 |
| --------------------------------------- | -------------------- | ------------------------------------ |
| id                                      | bigint PK            |                                      |
| user_id / session_id                    | bigint / varchar(64) | 匿名用 session                       |
| keyword                                 | varchar(128)         | 脱敏，不含个人信息                   |
| poi_types                               | varchar(64)          |                                      |
| bbox / center_lng / center_lat / radius |                      | 空间条件                             |
| filters_json                            | json                 | 筛选条件                             |
| result_count                            | int                  | 结果数（0 结果最有价值：覆盖率缺口） |
| cost_ms                                 | int                  | 响应耗时                             |
| created_at                              | datetime             |                                      |

索引：`idx_created(created_at)`；按月归档或分区。

### 2.8 `hot_region` 热点聚合

| 字段              | 类型         | 说明                                                                                |
| ----------------- | ------------ | ----------------------------------------------------------------------------------- |
| id                | bigint PK    |                                                                                     |
| region_code       | varchar(12)  | 行政区划码或网格 ID                                                                 |
| region_level      | varchar(8)   | `district` / `grid`                                                                 |
| stat_date         | date         | 统计日                                                                              |
| query_count       | int          | 查询次数                                                                            |
| zero_result_count | int          | 空结果次数（缺口信号）                                                              |
| unique_users      | int          |                                                                                     |
| priority          | decimal(4,2) | 抓取优先级，公式见 SRS §6.4：`normalize(query_count_7d + 2 × zero_result_count_7d)` |
| last_query_at     | datetime     |                                                                                     |

UNIQUE(region_code, region_level, stat_date)。

### 2.9 `sys_user` / `audit_log`

`sys_user`：id、username(UNIQUE)、password_hash(bcrypt)、role(`visitor/operator`，MVP 两档，字段预留扩展)、display_name、status、last_login_at、created_at。

`audit_log`：id、user_id、action(`trigger_job/approve_feedback/update_source/recompute_hotspot/...`)、target_type、target_id、detail_json、ip、created_at。

### 2.10 `ingest_log` 抓取请求审计（v0.2 新增，配合 FR-D-16）

| 字段           | 类型         | 说明                           |
| -------------- | ------------ | ------------------------------ |
| id             | bigint PK    |                                |
| job_id         | bigint NULL  | 关联任务；单次探测可为空       |
| source_id      | bigint       |                                |
| url            | varchar(512) | **脱敏**（去掉 key/sign 参数） |
| method         | varchar(8)   | GET / POST                     |
| status_code    | int          |                                |
| latency_ms     | int          |                                |
| robots_allowed | tinyint(1)   | 是否通过 robots 校验           |
| error          | varchar(255) |                                |
| created_at     | datetime     |                                |

索引：`idx_job(job_id)`、`idx_created(created_at)`。

### 2.11 `geo_region` 地理区域字典（v0.2 新增，补赛题"地理位置表"）

| 字段                    | 类型           | 说明                                                  |
| ----------------------- | -------------- | ----------------------------------------------------- |
| code                    | varchar(12) PK | 行政区划码或网格 ID，与 `hot_region.region_code` 对应 |
| name                    | varchar(64)    | 名称                                                  |
| level                   | varchar(8)     | `city` / `district` / `street` / `grid`               |
| parent_code             | varchar(12)    | 上级区域                                              |
| bbox                    | json           | `[minLng,minLat,maxLng,maxLat]`，用于坐标合法性校验   |
| center_lng / center_lat | decimal(10,6)  | 区域中心                                              |
| population              | int NULL       | 可选，用于"每万人银行数"口径                          |

> 赛题原文要求"银行表、小区表、地理位置表等"，本表即为地理位置表：既做行政区划字典，也做热点网格载体，避免 `city/district` 字符串散落在业务表里无法统计。

## 3. 关键设计说明

1. **去重靠双键**：`UNIQUE(source_id, source_ref)` 解决同源重复；跨源合并靠「名称相似度 + 100m 距离」在清洗阶段判定，合并结果写 `poi_version.change_type=merge`。
2. **空间查询不依赖 GIS 扩展**：`bbox` 用 `lat/lng` 索引粗筛，再在应用层用 Haversine 精算，10 万级数据足够；`geohash` 作为二级筛选。
3. **闭环可追溯**：`feedback → poi_version → poi_*` 三张表串起来，能回答"这条数据是谁、什么时候、因为什么改的"。
4. **新鲜度可算**：所有 POI 都有 `last_fetched_at`，看板直接 `median(now - last_fetched_at)`。
5. **热点闭环**：`query_log` 每日（或手动触发）聚合进 `hot_region`，调度器只读 `hot_region`，避免实时聚合压力。
6. **字段级溯源**：`poi_bank.field_source` / `poi_community.field_source` 记录每个字段的来源级别（A/B/C/S/U），前端据此打"演示数据 / 用户提供"标签，回答"这条数据哪来的"。
