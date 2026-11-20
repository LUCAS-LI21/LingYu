---
title: 邻域 POI 情报系统
doc: 数据库设计
team: 待填写
regno: 待填写
---

# 1 数据表清单

表 1 数据表清单

| 序号 | 数据表名                | 作用                          | 与其他表关系                                                                       |
| ---- | ----------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| 1    | `poi_bank`              | 银行网点与 ATM                | 经 `v_poi` 合并；`poi_version`、`poi_field_source` 以 `poi_type + poi_id` 指向本表 |
| 2    | `poi_community`         | 住宅小区                      | 经 `v_poi` 合并；`poi_version`、`poi_field_source` 以 `poi_type + poi_id` 指向本表 |
| 3    | `feedback`              | 用户反馈与审核状态            | 1:N `poi_version`（`feedback_id`）                                                 |
| 4    | `poi_version`           | POI 变更版本                  | N:1 `feedback`；按 `poi_type + poi_id` 指向主表                                    |
| 5    | `poi_field_source`      | 字段级数据来源                | 按 `poi_type + poi_id` 指向主表                                                    |
| 6    | `ingest_job`            | 抓取任务                      | `source_code` → `ds_source`；`feedback_code` → `feedback`                          |
| 7    | `ds_source`             | 数据源注册表（存储策略/限速） | 被 `ingest_job` 引用                                                               |
| 8    | `query_log`             | 查询行为日志                  | 按 `grid + stat_date` 聚合到 `hot_region`                                          |
| 9    | `hot_region`            | 热点聚合                      | 驱动 `ingest_job` 选择抓取区域                                                     |
| 10   | `bank_pending`          | 有地址无坐标的银行网点        | 转正后写入 `poi_bank`                                                              |
| 11   | `community_pending`     | 有地址无坐标的小区            | 转正后写入 `poi_community`；被 `coordinate_submission.pending_id` 指向             |
| 12   | `coordinate_submission` | 用户提交的小区坐标（待审）    | N:1 `community_pending`                                                            |
| 13   | `dedupe_log`            | 去重黑名单                    | 抓取前置过滤，避免已删点位被重新抓回                                               |
| 14   | `sys_user`              | 运营账号                      | 独立，无外键                                                                       |
| 15   | `agent_run`             | AI 抽取运行记录               | `entity_id` 指向主表主键                                                           |
| 16   | `land_parcel`           | 存量住宅用地（宗地级）        | 独立，与小区级 POI 语义不同                                                        |
| 17   | `v_poi`                 | 统一查询视图（非物理表）      | `UNION ALL` 两张主表，排除 `status='closed'`                                       |

# 2 数据表内容

> 字段类型与约束取自 `db/migration/V1–V3`，与代码保持一致；`v_poi` 为视图，仅列字段含义。

## 2.1 poi_bank（银行网点与 ATM）

表 2 poi_bank 字段说明

| 序号 | 字段英文名      | 字段类型       | 字段中文名 | 字段解释                           |
| ---- | --------------- | -------------- | ---------- | ---------------------------------- |
| 1    | `id`            | VARCHAR(64)    | 主键       | 唯一标识；抓取来源内唯一           |
| 2    | `name`          | VARCHAR(128)   | 名称       | 网点名或小区名                     |
| 3    | `brand`         | VARCHAR(64)    | 银行品牌   | 中英文/繁简归一后的品牌名          |
| 4    | `branch_type`   | VARCHAR(16)    | 网点类型   | `branch` 营业网点 / `atm` 自助设备 |
| 5    | `address`       | VARCHAR(255)   | 地址       | 门牌地址                           |
| 6    | `district`      | VARCHAR(32)    | 行政区     | 深圳 10 区枚举                     |
| 7    | `lng`           | DECIMAL(10, 6) | 经度       | WGS-84                             |
| 8    | `lat`           | DECIMAL(10, 6) | 纬度       | WGS-84                             |
| 9    | `phone`         | VARCHAR(64)    | 联系电话   | 网点公开电话                       |
| 10   | `opening_hours` | VARCHAR(128)   | 营业时间   | 营业时间原始文本                   |
| 11   | `source`        | VARCHAR(64)    | 数据来源   | 来源名称，与 `ds_source.name` 对应 |
| 12   | `license`       | VARCHAR(32)    | 数据许可   | ODbL / 政府开放数据条款等          |
| 13   | `source_level`  | VARCHAR(8)     | 授权级别   | L1 可入库 / L2 仅展示 / L3 禁用    |
| 14   | `status`        | VARCHAR(16)    | 状态       | `active` / `closed` 等状态机取值   |
| 15   | `updated_at`    | DATETIME       | 更新时间   | 最后写入时间                       |

索引与约束：KEY idx_bank_geo (lat, lng)；KEY idx_bank_district (district)；KEY idx_bank_brand (brand)。

## 2.2 poi_community（住宅小区）

表 3 poi_community 字段说明

| 序号 | 字段英文名            | 字段类型       | 字段中文名      | 字段解释                                 |
| ---- | --------------------- | -------------- | --------------- | ---------------------------------------- |
| 1    | `id`                  | VARCHAR(64)    | 主键            | 唯一标识；抓取来源内唯一                 |
| 2    | `name`                | VARCHAR(128)   | 名称            | 网点名或小区名                           |
| 3    | `address`             | VARCHAR(255)   | 地址            | 门牌地址                                 |
| 4    | `district`            | VARCHAR(32)    | 行政区          | 深圳 10 区枚举                           |
| 5    | `lng`                 | DECIMAL(10, 6) | 经度            | WGS-84                                   |
| 6    | `lat`                 | DECIMAL(10, 6) | 纬度            | WGS-84                                   |
| 7    | `built_year`          | SMALLINT       | 建成年份        | 竣工验收备案来源为真实值                 |
| 8    | `avg_price`           | INT            | 官方参考均价    | 元/平方米，仅放官方来源                  |
| 9    | `avg_price_source`    | VARCHAR(32)    | 均价来源        | `demo` 演示 / `gov_reference` 官方参考价 |
| 10   | `property_fee`        | DECIMAL(6, 1)  | 物业费          | 元/㎡·月                                 |
| 11   | `property_company`    | VARCHAR(64)    | 物业公司        | 政府物业项目库匹配结果                   |
| 12   | `water_saving_year`   | SMALLINT       | 节水型小区年度  | 获评年度，空表示非节水型小区             |
| 13   | `surround_bank_count` | INT            | 1 公里内银行数  | 预计算，来源于本地库空间查询             |
| 14   | `surround_atm_count`  | INT            | 1 公里内 ATM 数 | 预计算                                   |
| 15   | `nearest_bank_m`      | INT            | 最近银行距离    | 单位米，预计算                           |
| 16   | `nearby_brand_count`  | INT            | 1 公里内品牌数  | 预计算                                   |
| 17   | `rent_dc`             | DECIMAL(8, 2)  | 多层租金        | 政府租赁参考价，元/㎡·月                 |
| 18   | `rent_gc`             | DECIMAL(8, 2)  | 高层租金        | 政府租赁参考价                           |
| 19   | `rent_dmd`            | DECIMAL(8, 2)  | 低密度租金      | 政府租赁参考价                           |
| 20   | `developer`           | VARCHAR(64)    | 建设单位        | 竣工验收备案中的建设单位/开发商          |
| 21   | `demo_attributes`     | TINYINT(1)     | 演示字段标记    | 1 表示含演示值                           |
| 22   | `source`              | VARCHAR(64)    | 数据来源        | 来源名称，与 `ds_source.name` 对应       |
| 23   | `license`             | VARCHAR(32)    | 数据许可        | ODbL / 政府开放数据条款等                |
| 24   | `source_level`        | VARCHAR(8)     | 授权级别        | L1 可入库 / L2 仅展示 / L3 禁用          |
| 25   | `status`              | VARCHAR(16)    | 状态            | `active` / `closed` 等状态机取值         |
| 26   | `updated_at`          | DATETIME       | 更新时间        | 最后写入时间                             |
| 27   | `avg_price_demo`      | INT            | 演示均价        | 哈希生成的演示值，不参与筛选/排序/统计   |

索引与约束：KEY idx_comm_geo (lat, lng)；KEY idx_comm_district (district)；KEY idx_comm_price (avg_price)。

## 2.3 feedback（用户反馈与审核状态）

表 4 feedback 字段说明

| 序号 | 字段英文名    | 字段类型      | 字段中文名 | 字段解释                            |
| ---- | ------------- | ------------- | ---------- | ----------------------------------- |
| 1    | `id`          | BIGINT        | 主键       | 唯一标识；抓取来源内唯一            |
| 2    | `code`        | VARCHAR(32)   | 编号       | 反馈编号，形如 FB20261119-0103      |
| 3    | `poi_type`    | VARCHAR(16)   | POI 类型   | `bank` / `community`                |
| 4    | `poi_id`      | VARCHAR(64)   | POI 主键   | 指向主表 `id`                       |
| 5    | `poi_name`    | VARCHAR(128)  | POI 名称   | 冗余存名称，便于审核列表直接展示    |
| 6    | `type`        | VARCHAR(16)   | 类型       | 反馈类型 `error` / `closed` / `add` |
| 7    | `field_name`  | VARCHAR(64)   | 字段名     | 被纠错的字段中文名                  |
| 8    | `new_value`   | VARCHAR(255)  | 新值       | 用户提交的新值                      |
| 9    | `description` | VARCHAR(1024) | 描述       | 问题描述                            |
| 10   | `contact`     | VARCHAR(128)  | 联系方式   | 可选，便于回访                      |
| 11   | `status`      | VARCHAR(24)   | 状态       | `active` / `closed` 等状态机取值    |
| 12   | `reviewer`    | VARCHAR(64)   | 审核人     | 取自登录 token 的主体               |
| 13   | `review_note` | VARCHAR(255)  | 审核意见   | 驳回理由等                          |
| 14   | `reviewed_at` | DATETIME      | 审核时间   | 状态变更时间                        |
| 15   | `created_at`  | DATETIME      | 创建时间   | 记录落库时间                        |

索引与约束：UNIQUE KEY uk_feedback_code (code)；KEY idx_feedback_created (created_at)；KEY idx_feedback_status (status)。

## 2.4 poi_version（POI 变更版本）

表 5 poi_version 字段说明

| 序号 | 字段英文名       | 字段类型     | 字段中文名  | 字段解释                                 |
| ---- | ---------------- | ------------ | ----------- | ---------------------------------------- |
| 1    | `id`             | BIGINT       | 主键        | 唯一标识；抓取来源内唯一                 |
| 2    | `poi_type`       | VARCHAR(16)  | POI 类型    | `bank` / `community`                     |
| 3    | `poi_id`         | VARCHAR(64)  | POI 主键    | 指向主表 `id`                            |
| 4    | `change_type`    | VARCHAR(16)  | 变更类型    | `create` / `update` / `reopen`           |
| 5    | `before_json`    | TEXT         | 变更前快照  | 整行 JSON                                |
| 6    | `after_json`     | TEXT         | 变更后快照  | 整行 JSON                                |
| 7    | `changed_fields` | VARCHAR(255) | 变更字段    | 形如 `phone=0755-11112222`               |
| 8    | `operator`       | VARCHAR(64)  | 操作人      | `system` / `operator` / `agent:xxx@域名` |
| 9    | `feedback_id`    | BIGINT       | 关联反馈 ID | `feedback.id`                            |
| 10   | `created_at`     | DATETIME     | 创建时间    | 记录落库时间                             |

索引与约束：KEY idx_version_poi (poi_type, poi_id, created_at)。

## 2.5 poi_field_source（字段级数据来源）

表 6 poi_field_source 字段说明

| 序号 | 字段英文名   | 字段类型     | 字段中文名 | 字段解释                           |
| ---- | ------------ | ------------ | ---------- | ---------------------------------- |
| 1    | `poi_type`   | VARCHAR(16)  | POI 类型   | `bank` / `community`               |
| 2    | `poi_id`     | VARCHAR(64)  | POI 主键   | 指向主表 `id`                      |
| 3    | `field`      | VARCHAR(32)  | 字段       | 被补全的字段名                     |
| 4    | `source`     | VARCHAR(64)  | 数据来源   | 来源名称，与 `ds_source.name` 对应 |
| 5    | `source_url` | VARCHAR(255) | —          | —                                  |
| 6    | `updated_at` | DATETIME     | 更新时间   | 最后写入时间                       |

索引与约束：PRIMARY KEY (poi_type, poi_id, field)。

## 2.6 ingest_job（抓取任务）

表 7 ingest_job 字段说明

| 序号 | 字段英文名       | 字段类型     | 字段中文名 | 字段解释                                       |
| ---- | ---------------- | ------------ | ---------- | ---------------------------------------------- |
| 1    | `id`             | BIGINT       | 主键       | 唯一标识；抓取来源内唯一                       |
| 2    | `source_code`    | VARCHAR(32)  | 数据源编码 | `ds_source.code`                               |
| 3    | `trigger_type`   | VARCHAR(16)  | 触发方式   | `manual` / `schedule` / `hotspot` / `feedback` |
| 4    | `scope_type`     | VARCHAR(16)  | 范围类型   | `bbox` 矩形 / `radius` 半径                    |
| 5    | `scope_value`    | VARCHAR(255) | 范围取值   | 矩形为四角坐标串                               |
| 6    | `status`         | VARCHAR(16)  | 状态       | `active` / `closed` 等状态机取值               |
| 7    | `fetched_count`  | INT          | 抓取条数   | 外部接口返回条数                               |
| 8    | `inserted_count` | INT          | 新增条数   | 本轮新写入条数                                 |
| 9    | `updated_count`  | INT          | 更新条数   | 本轮更新条数                                   |
| 10   | `failed_count`   | INT          | 失败条数   | 解析或写库失败条数                             |
| 11   | `error_summary`  | VARCHAR(512) | 错误摘要   | 失败原因，截断 512 字                          |
| 12   | `started_at`     | DATETIME     | 开始时间   | 任务开始执行时间                               |
| 13   | `finished_at`    | DATETIME     | 结束时间   | 任务结束时间                                   |
| 14   | `created_at`     | DATETIME     | 创建时间   | 记录落库时间                                   |
| 15   | `feedback_code`  | VARCHAR(32)  | 关联反馈   | 由该反馈触发的任务                             |

索引与约束：KEY idx_job_created (created_at)；KEY idx_job_status (status)。

## 2.7 ds_source（数据源注册表（存储策略/限速））

表 8 ds_source 字段说明

| 序号 | 字段英文名       | 字段类型      | 字段中文名 | 字段解释                                  |
| ---- | ---------------- | ------------- | ---------- | ----------------------------------------- |
| 1    | `id`             | BIGINT        | 主键       | 唯一标识；抓取来源内唯一                  |
| 2    | `code`           | VARCHAR(32)   | 编号       | 反馈编号，形如 FB20261119-0103            |
| 3    | `name`           | VARCHAR(64)   | 名称       | 网点名或小区名                            |
| 4    | `type`           | VARCHAR(16)   | 类型       | 反馈类型 `error` / `closed` / `add`       |
| 5    | `storage_policy` | VARCHAR(16)   | 存储策略   | `storable` / `display_only` / `forbidden` |
| 6    | `rate_limit_qps` | DECIMAL(5, 2) | 限速       | 每秒请求数                                |
| 7    | `enabled`        | TINYINT(1)    | 启用       | 1 启用 / 0 停用                           |
| 8    | `notes`          | VARCHAR(255)  | 说明       | 数据源备注                                |

索引与约束：UNIQUE KEY uk_source_code (code)。

## 2.8 query_log（查询行为日志）

表 9 query_log 字段说明

| 序号 | 字段英文名     | 字段类型     | 字段中文名 | 字段解释                 |
| ---- | -------------- | ------------ | ---------- | ------------------------ |
| 1    | `id`           | BIGINT       | 主键       | 唯一标识；抓取来源内唯一 |
| 2    | `kind`         | VARCHAR(16)  | 查询类型   | `list` / `nearby`        |
| 3    | `keyword`      | VARCHAR(128) | 关键词     | 查询关键词               |
| 4    | `district`     | VARCHAR(32)  | 行政区     | 深圳 10 区枚举           |
| 5    | `grid`         | VARCHAR(32)  | 网格编码   | 经纬度按 0.02° 取整      |
| 6    | `result_count` | INT          | 命中条数   | 本次查询总命中数         |
| 7    | `cost_ms`      | INT          | 耗时       | 毫秒                     |
| 8    | `created_at`   | DATETIME     | 创建时间   | 记录落库时间             |

索引与约束：KEY idx_query_created (created_at)；KEY idx_query_grid (grid)。

## 2.9 hot_region（热点聚合）

表 10 hot_region 字段说明

| 序号 | 字段英文名          | 字段类型      | 字段中文名 | 字段解释                  |
| ---- | ------------------- | ------------- | ---------- | ------------------------- |
| 1    | `id`                | BIGINT        | 主键       | 唯一标识；抓取来源内唯一  |
| 2    | `grid`              | VARCHAR(32)   | 网格编码   | 经纬度按 0.02° 取整       |
| 3    | `stat_date`         | DATE          | 统计日期   | 按天聚合                  |
| 4    | `query_count`       | INT           | 查询次数   | 当日该网格查询次数        |
| 5    | `zero_result_count` | INT           | 零结果次数 | 当日该网格无结果次数      |
| 6    | `priority`          | DECIMAL(6, 2) | 优先级     | 查询次数 + 2 × 零结果次数 |
| 7    | `updated_at`        | DATETIME      | 更新时间   | 最后写入时间              |

索引与约束：UNIQUE KEY uk_hot (grid, stat_date)。

## 2.10 bank_pending（有地址无坐标的银行网点）

表 11 bank_pending 字段说明

| 序号 | 字段英文名      | 字段类型     | 字段中文名 | 字段解释                           |
| ---- | --------------- | ------------ | ---------- | ---------------------------------- |
| 1    | `id`            | BIGINT       | 主键       | 唯一标识；抓取来源内唯一           |
| 2    | `name`          | VARCHAR(128) | 名称       | 网点名或小区名                     |
| 3    | `address`       | VARCHAR(255) | 地址       | 门牌地址                           |
| 4    | `phone`         | VARCHAR(64)  | 联系电话   | 网点公开电话                       |
| 5    | `opening_hours` | VARCHAR(128) | 营业时间   | 营业时间原始文本                   |
| 6    | `district`      | VARCHAR(32)  | 行政区     | 深圳 10 区枚举                     |
| 7    | `source`        | VARCHAR(64)  | 数据来源   | 来源名称，与 `ds_source.name` 对应 |
| 8    | `source_url`    | VARCHAR(255) | —          | —                                  |
| 9    | `status`        | VARCHAR(16)  | 状态       | `active` / `closed` 等状态机取值   |
| 10   | `note`          | VARCHAR(200) | 备注       | 人工标注说明                       |
| 11   | `created_at`    | DATETIME     | 创建时间   | 记录落库时间                       |

索引与约束：KEY idx_pending_status (status)；KEY idx_pending_source (source)。

## 2.11 community_pending（有地址无坐标的小区）

表 12 community_pending 字段说明

| 序号 | 字段英文名         | 字段类型     | 字段中文名       | 字段解释                                 |
| ---- | ------------------ | ------------ | ---------------- | ---------------------------------------- |
| 1    | `id`               | VARCHAR(64)  | 主键             | 唯一标识；抓取来源内唯一                 |
| 2    | `name`             | VARCHAR(128) | 名称             | 网点名或小区名                           |
| 3    | `address`          | VARCHAR(255) | 地址             | 门牌地址                                 |
| 4    | `district`         | VARCHAR(32)  | 行政区           | 深圳 10 区枚举                           |
| 5    | `street`           | VARCHAR(64)  | —                | —                                        |
| 6    | `village_num`      | VARCHAR(32)  | 物业管理区域编码 | 政府物业库唯一码                         |
| 7    | `attribute`        | VARCHAR(32)  | 属性             | 普通住宅/商住一体/自然村等               |
| 8    | `source`           | VARCHAR(64)  | 数据来源         | 来源名称，与 `ds_source.name` 对应       |
| 9    | `status`           | VARCHAR(16)  | 状态             | `active` / `closed` 等状态机取值         |
| 10   | `lng`              | DOUBLE       | 经度             | WGS-84                                   |
| 11   | `lat`              | DOUBLE       | 纬度             | WGS-84                                   |
| 12   | `geocode_source`   | VARCHAR(32)  | 坐标来源         | `admin` 管理员标注 / `user` 用户提交     |
| 13   | `geocoded_at`      | DATETIME     | 标注时间         | 坐标写入时间                             |
| 14   | `poi_id`           | VARCHAR(64)  | POI 主键         | 指向主表 `id`                            |
| 15   | `avg_price`        | INT          | 官方参考均价     | 元/平方米，仅放官方来源                  |
| 16   | `avg_price_source` | VARCHAR(32)  | 均价来源         | `demo` 演示 / `gov_reference` 官方参考价 |
| 17   | `created_at`       | DATETIME     | 创建时间         | 记录落库时间                             |

索引与约束：KEY idx_cp_status (status)；KEY idx_cp_district (district)；KEY idx_cp_district_name (district, name)。

## 2.12 coordinate_submission（用户提交的小区坐标（待审））

表 13 coordinate_submission 字段说明

| 序号 | 字段英文名    | 字段类型     | 字段中文名 | 字段解释                           |
| ---- | ------------- | ------------ | ---------- | ---------------------------------- |
| 1    | `id`          | BIGINT       | 主键       | 唯一标识；抓取来源内唯一           |
| 2    | `pending_id`  | VARCHAR(64)  | 待定位 ID  | `community_pending.id`             |
| 3    | `lng`         | DOUBLE       | 经度       | WGS-84                             |
| 4    | `lat`         | DOUBLE       | 纬度       | WGS-84                             |
| 5    | `source`      | VARCHAR(16)  | 数据来源   | 来源名称，与 `ds_source.name` 对应 |
| 6    | `submitter`   | VARCHAR(64)  | 提交人     | 匿名或账号标识                     |
| 7    | `note`        | VARCHAR(200) | 备注       | 人工标注说明                       |
| 8    | `status`      | VARCHAR(16)  | 状态       | `active` / `closed` 等状态机取值   |
| 9    | `reviewer`    | VARCHAR(64)  | 审核人     | 取自登录 token 的主体              |
| 10   | `reviewed_at` | DATETIME     | 审核时间   | 状态变更时间                       |
| 11   | `poi_id`      | VARCHAR(64)  | POI 主键   | 指向主表 `id`                      |
| 12   | `created_at`  | DATETIME     | 创建时间   | 记录落库时间                       |

索引与约束：KEY idx_cs_status (status)；KEY idx_cs_pending (pending_id)。

## 2.13 dedupe_log（去重黑名单）

表 14 dedupe_log 字段说明

| 序号 | 字段英文名   | 字段类型     | 字段中文名 | 字段解释                  |
| ---- | ------------ | ------------ | ---------- | ------------------------- |
| 1    | `id`         | BIGINT       | 主键       | 唯一标识；抓取来源内唯一  |
| 2    | `brand`      | VARCHAR(64)  | 银行品牌   | 中英文/繁简归一后的品牌名 |
| 3    | `reason`     | VARCHAR(255) | 原因       | 去重/驳回原因             |
| 4    | `removed_at` | DATETIME     | 移除时间   | 下线时间                  |

索引与约束：KEY idx_dedupe_brand (brand)。

## 2.14 sys_user（运营账号）

表 15 sys_user 字段说明

| 序号 | 字段英文名      | 字段类型     | 字段中文名 | 字段解释                         |
| ---- | --------------- | ------------ | ---------- | -------------------------------- |
| 1    | `id`            | BIGINT       | 主键       | 唯一标识；抓取来源内唯一         |
| 2    | `username`      | VARCHAR(64)  | 用户名     | 登录名                           |
| 3    | `password_hash` | VARCHAR(255) | 口令哈希   | PBKDF2 加盐哈希                  |
| 4    | `role`          | VARCHAR(16)  | 角色       | `operator`                       |
| 5    | `display_name`  | VARCHAR(64)  | 显示名     | 后台展示用                       |
| 6    | `status`        | TINYINT(1)   | 状态       | `active` / `closed` 等状态机取值 |
| 7    | `last_login_at` | DATETIME     | 最后登录   | 最近一次登录时间                 |
| 8    | `created_at`    | DATETIME     | 创建时间   | 记录落库时间                     |

索引与约束：UNIQUE KEY uk_user (username)。

## 2.15 agent_run（AI 抽取运行记录）

表 16 agent_run 字段说明

| 序号 | 字段英文名          | 字段类型     | 字段中文名 | 字段解释                         |
| ---- | ------------------- | ------------ | ---------- | -------------------------------- |
| 1    | `id`                | BIGINT       | 主键       | 唯一标识；抓取来源内唯一         |
| 2    | `entity_type`       | VARCHAR(16)  | 实体类型   | `bank` / `community`             |
| 3    | `entity_id`         | VARCHAR(64)  | 实体 ID    | 主表主键                         |
| 4    | `field`             | VARCHAR(32)  | 字段       | 被补全的字段名                   |
| 5    | `status`            | VARCHAR(16)  | 状态       | `active` / `closed` 等状态机取值 |
| 6    | `model`             | VARCHAR(64)  | 模型       | 如 `deepseek-flash`              |
| 7    | `prompt_tokens`     | INT          | 输入 token | 计费用量                         |
| 8    | `completion_tokens` | INT          | 输出 token | 计费用量                         |
| 9    | `latency_ms`        | INT          | 耗时       | 毫秒                             |
| 10   | `result_json`       | TEXT         | 结果       | 模型建议的 JSON                  |
| 11   | `error`             | VARCHAR(500) | 错误       | 失败原因                         |
| 12   | `reviewed_by`       | VARCHAR(64)  | 采纳人     | 点采纳的管理员                   |
| 13   | `reviewed_at`       | DATETIME     | 审核时间   | 状态变更时间                     |
| 14   | `created_at`        | DATETIME     | 创建时间   | 记录落库时间                     |
| 15   | `finished_at`       | DATETIME     | 结束时间   | 任务结束时间                     |

索引与约束：KEY idx_agent_entity (entity_type, entity_id)；KEY idx_agent_status (status, created_at)。

## 2.16 land_parcel（存量住宅用地（宗地级））

表 17 land_parcel 字段说明

| 序号 | 字段英文名        | 字段类型       | 字段中文名 | 字段解释                           |
| ---- | ----------------- | -------------- | ---------- | ---------------------------------- |
| 1    | `id`              | VARCHAR(32)    | 主键       | 唯一标识；抓取来源内唯一           |
| 2    | `district_street` | VARCHAR(64)    | 区/街道    | 宗地所属区与街道                   |
| 3    | `location`        | VARCHAR(255)   | 位置       | 宗地位置描述                       |
| 4    | `area_ha`         | DECIMAL(10, 4) | 用地面积   | 公顷                               |
| 5    | `housing_type`    | VARCHAR(32)    | 住房类型   | 普通商品住房/保障性租赁住房等      |
| 6    | `build_status`    | VARCHAR(32)    | 建设状态   | 已动工/未动工等                    |
| 7    | `developer`       | VARCHAR(128)   | 建设单位   | 竣工验收备案中的建设单位/开发商    |
| 8    | `project_name`    | VARCHAR(128)   | 项目名称   | 宗地对应项目名                     |
| 9    | `supply_date`     | DATE           | 供地日期   | 土地出让时间                       |
| 10   | `source`          | VARCHAR(64)    | 数据来源   | 来源名称，与 `ds_source.name` 对应 |
| 11   | `updated_at`      | DATETIME       | 更新时间   | 最后写入时间                       |

## 2.17 v_poi（统一查询视图）

表 18 v_poi 字段说明

| 序号 | 字段英文名                             | 字段类型        | 字段中文名      | 字段解释               |
| ---- | -------------------------------------- | --------------- | --------------- | ---------------------- |
| 1    | `id`                                   | VARCHAR(64)     | 主键            | 两类 POI 的主键        |
| 2    | `type`                                 | VARCHAR(8)      | 类型            | `bank` / `community`   |
| 3    | `name`                                 | VARCHAR(128)    | 名称            | 网点名或小区名         |
| 4    | `address`                              | VARCHAR(255)    | 地址            | 门牌地址               |
| 5    | `district`                             | VARCHAR(32)     | 行政区          | 深圳 10 区             |
| 6    | `lng / lat`                            | DECIMAL(10,6)   | 经纬度          | WGS-84                 |
| 7    | `brand / branch_type`                  | VARCHAR         | 品牌/网点类型   | 小区行为 NULL          |
| 8    | `phone / opening_hours`                | VARCHAR         | 电话/营业时间   | 小区行为 NULL          |
| 9    | `built_year / avg_price`               | INT             | 建成年份/均价   | 银行行为 NULL          |
| 10   | `avg_price_demo`                       | INT             | 演示均价        | 仅展示，不参与统计     |
| 11   | `property_fee / property_company`      | DECIMAL/VARCHAR | 物业费/物业公司 | 银行行为 NULL          |
| 12   | `rent_dc / rent_gc / rent_dmd`         | DECIMAL(8,2)    | 租赁参考价      | 多层/高层/低密度       |
| 13   | `surround_bank_count / nearest_bank_m` | INT             | 周边配套        | 1 公里银行数、最近距离 |
| 14   | `source / license / source_level`      | VARCHAR         | 来源/许可/级别  | 溯源三元组             |
| 15   | `updated_at`                           | DATETIME        | 更新时间        | 最后写入时间           |

# 3 SQL 语句

> 下列语句与 `backend/src/main/resources/db/migration` 一致，按 V1 → V2 → V3 顺序执行；`V2` 的价格分列与 `V3` 的反馈回写已并入对应表。

## 3.1 poi_bank

```sql
CREATE TABLE poi_bank (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  brand VARCHAR(64) NOT NULL DEFAULT '',
  branch_type VARCHAR(16) NOT NULL DEFAULT 'branch',
  address VARCHAR(255) NOT NULL DEFAULT '',
  district VARCHAR(32) NOT NULL DEFAULT '',
  lng DECIMAL(10, 6) NOT NULL,
  lat DECIMAL(10, 6) NOT NULL,
  phone VARCHAR(64) NOT NULL DEFAULT '',
  opening_hours VARCHAR(128) NOT NULL DEFAULT '',
  source VARCHAR(64) NOT NULL DEFAULT 'OpenStreetMap',
  license VARCHAR(32) NOT NULL DEFAULT 'ODbL',
  source_level VARCHAR(8) NOT NULL DEFAULT 'L1',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_bank_geo (lat, lng),
  KEY idx_bank_district (district),
  KEY idx_bank_brand (brand)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.2 poi_community

```sql
CREATE TABLE poi_community (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  address VARCHAR(255) NOT NULL DEFAULT '',
  district VARCHAR(32) NOT NULL DEFAULT '',
  lng DECIMAL(10, 6) NOT NULL,
  lat DECIMAL(10, 6) NOT NULL,
  built_year SMALLINT NULL,
  avg_price INT NULL,
  avg_price_source VARCHAR(32) NOT NULL DEFAULT 'demo' COMMENT 'demo / gov_reference',
  property_fee DECIMAL(6, 1) NULL,
  property_company VARCHAR(64) NOT NULL DEFAULT '' COMMENT '物业公司',
  water_saving_year SMALLINT NULL COMMENT '节水型小区获评年度',
  surround_bank_count INT NOT NULL DEFAULT 0 COMMENT '1km 内银行网点数',
  surround_atm_count INT NOT NULL DEFAULT 0 COMMENT '1km 内 ATM 数',
  nearest_bank_m INT NOT NULL DEFAULT 0 COMMENT '最近银行距离(米)',
  nearby_brand_count INT NOT NULL DEFAULT 0 COMMENT '1km 内银行品牌数',
  rent_dc DECIMAL(8, 2) NULL COMMENT '多层租金(元/㎡·月，政府租赁参考价)',
  rent_gc DECIMAL(8, 2) NULL COMMENT '高层租金',
  rent_dmd DECIMAL(8, 2) NULL COMMENT '低密度租金',
  developer VARCHAR(64) NOT NULL DEFAULT '' COMMENT '建设单位/开发商（竣工验收备案）',
  demo_attributes TINYINT(1) NOT NULL DEFAULT 0 COMMENT '字段是否为演示数据',
  source VARCHAR(64) NOT NULL DEFAULT 'OpenStreetMap',
  license VARCHAR(32) NOT NULL DEFAULT 'ODbL',
  source_level VARCHAR(8) NOT NULL DEFAULT 'L1',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  avg_price_demo INT NULL COMMENT '演示均价(哈希生成，不参与筛选/排序/统计)',
  KEY idx_comm_geo (lat, lng),
  KEY idx_comm_district (district),
  KEY idx_comm_price (avg_price)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.3 feedback

```sql
CREATE TABLE feedback (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  poi_type VARCHAR(16) NOT NULL,
  poi_id VARCHAR(64) NOT NULL,
  poi_name VARCHAR(128) NOT NULL DEFAULT '',
  type VARCHAR(16) NOT NULL,
  field_name VARCHAR(64) NOT NULL DEFAULT '',
  new_value VARCHAR(255) NOT NULL DEFAULT '',
  description VARCHAR(1024) NOT NULL DEFAULT '',
  contact VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  reviewer VARCHAR(64) NOT NULL DEFAULT '',
  review_note VARCHAR(255) NOT NULL DEFAULT '',
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_feedback_code (code),
  KEY idx_feedback_created (created_at),
  KEY idx_feedback_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.4 poi_version

```sql
CREATE TABLE poi_version (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  poi_type VARCHAR(16) NOT NULL,
  poi_id VARCHAR(64) NOT NULL,
  change_type VARCHAR(16) NOT NULL,
  before_json TEXT NULL,
  after_json TEXT NULL,
  changed_fields VARCHAR(255) NOT NULL DEFAULT '',
  operator VARCHAR(64) NOT NULL DEFAULT 'system',
  feedback_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_version_poi (poi_type, poi_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.5 poi_field_source

```sql
CREATE TABLE poi_field_source (
  poi_type VARCHAR(16) NOT NULL,
  poi_id VARCHAR(64) NOT NULL,
  field VARCHAR(32) NOT NULL,
  source VARCHAR(64) NOT NULL DEFAULT '',
  source_url VARCHAR(255) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (poi_type, poi_id, field)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.6 ingest_job

```sql
CREATE TABLE ingest_job (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  source_code VARCHAR(32) NOT NULL DEFAULT 'osm_overpass',
  trigger_type VARCHAR(16) NOT NULL DEFAULT 'manual',
  scope_type VARCHAR(16) NOT NULL DEFAULT 'bbox',
  scope_value VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  fetched_count INT NOT NULL DEFAULT 0,
  inserted_count INT NOT NULL DEFAULT 0,
  updated_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  error_summary VARCHAR(512) NOT NULL DEFAULT '',
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  feedback_code VARCHAR(32) NOT NULL DEFAULT '' COMMENT '发起该任务的反馈编号',
  KEY idx_job_created (created_at),
  KEY idx_job_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.7 ds_source

```sql
CREATE TABLE ds_source (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL,
  type VARCHAR(16) NOT NULL DEFAULT 'official_api',
  storage_policy VARCHAR(16) NOT NULL DEFAULT 'storable' COMMENT 'L1 storable / L2 display_only / L3 forbidden',
  rate_limit_qps DECIMAL(5, 2) NOT NULL DEFAULT 1.00,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  notes VARCHAR(255) NOT NULL DEFAULT '',
  UNIQUE KEY uk_source_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.8 query_log

```sql
CREATE TABLE query_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(16) NOT NULL DEFAULT 'list',
  keyword VARCHAR(128) NOT NULL DEFAULT '',
  district VARCHAR(32) NOT NULL DEFAULT '',
  grid VARCHAR(32) NOT NULL DEFAULT '',
  result_count INT NOT NULL DEFAULT 0,
  cost_ms INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_query_created (created_at),
  KEY idx_query_grid (grid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.9 hot_region

```sql
CREATE TABLE hot_region (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  grid VARCHAR(32) NOT NULL,
  stat_date DATE NOT NULL,
  query_count INT NOT NULL DEFAULT 0,
  zero_result_count INT NOT NULL DEFAULT 0,
  priority DECIMAL(6, 2) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_hot (grid, stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.10 bank_pending

```sql
CREATE TABLE bank_pending (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  address VARCHAR(255) NOT NULL DEFAULT '',
  phone VARCHAR(64) NOT NULL DEFAULT '',
  opening_hours VARCHAR(128) NOT NULL DEFAULT '',
  district VARCHAR(32) NOT NULL DEFAULT '',
  source VARCHAR(64) NOT NULL DEFAULT '',
  source_url VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/geocoded/rejected',
  note VARCHAR(200) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pending_status (status),
  KEY idx_pending_source (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.11 community_pending

```sql
CREATE TABLE community_pending (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  address VARCHAR(255) NOT NULL DEFAULT '',
  district VARCHAR(32) NOT NULL DEFAULT '',
  street VARCHAR(64) NOT NULL DEFAULT '',
  village_num VARCHAR(32) NOT NULL DEFAULT '',
  attribute VARCHAR(32) NOT NULL DEFAULT '',
  source VARCHAR(64) NOT NULL DEFAULT '深圳市政府数据开放平台-物业管理区域基础信息',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/geocoded/rejected',
  lng DOUBLE NULL COMMENT '经度(WGS-84)',
  lat DOUBLE NULL COMMENT '纬度(WGS-84)',
  geocode_source VARCHAR(32) NOT NULL DEFAULT '' COMMENT 'admin/user',
  geocoded_at DATETIME NULL,
  poi_id VARCHAR(64) NOT NULL DEFAULT '',
  avg_price INT NULL COMMENT '官方成交参考价(元/㎡)，转正时带入 poi_community',
  avg_price_source VARCHAR(32) NOT NULL DEFAULT '' COMMENT 'gov_reference=官方参考价表匹配到的',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cp_status (status),
  KEY idx_cp_district (district),
  KEY idx_cp_district_name (district, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.12 coordinate_submission

```sql
CREATE TABLE coordinate_submission (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pending_id VARCHAR(64) NOT NULL,
  lng DOUBLE NOT NULL,
  lat DOUBLE NOT NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'user',
  submitter VARCHAR(64) NOT NULL DEFAULT '',
  note VARCHAR(200) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  reviewer VARCHAR(64) NOT NULL DEFAULT '',
  reviewed_at DATETIME NULL,
  poi_id VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cs_status (status),
  KEY idx_cs_pending (pending_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.13 dedupe_log

```sql
CREATE TABLE dedupe_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  brand VARCHAR(64) NOT NULL DEFAULT '',
  reason VARCHAR(255) NOT NULL DEFAULT '',
  removed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dedupe_brand (brand)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.14 sys_user

```sql
CREATE TABLE sys_user (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL COMMENT 'base64(salt)$base64(pbkdf2)',
  role VARCHAR(16) NOT NULL DEFAULT 'operator',
  display_name VARCHAR(64) NOT NULL DEFAULT '',
  status TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.15 agent_run

```sql
CREATE TABLE agent_run (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(16) NOT NULL DEFAULT 'bank',
  entity_id VARCHAR(64) NOT NULL,
  field VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'running',
  model VARCHAR(64) NOT NULL DEFAULT 'deepseek-flash',
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  result_json TEXT NULL,
  error VARCHAR(500) NOT NULL DEFAULT '',
  reviewed_by VARCHAR(64) NOT NULL DEFAULT '',
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  KEY idx_agent_entity (entity_type, entity_id),
  KEY idx_agent_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.16 land_parcel

```sql
CREATE TABLE land_parcel (
  id VARCHAR(32) NOT NULL PRIMARY KEY COMMENT '宗地号',
  district_street VARCHAR(64) NOT NULL DEFAULT '',
  location VARCHAR(255) NOT NULL DEFAULT '',
  area_ha DECIMAL(10, 4) NULL,
  housing_type VARCHAR(32) NOT NULL DEFAULT '',
  build_status VARCHAR(32) NOT NULL DEFAULT '',
  developer VARCHAR(128) NOT NULL DEFAULT '',
  project_name VARCHAR(128) NOT NULL DEFAULT '',
  supply_date DATE NULL,
  source VARCHAR(64) NOT NULL DEFAULT '深圳市政府数据开放平台-存量住宅用地',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='';
```

## 3.17 v_poi（视图）

```sql
CREATE VIEW v_poi AS
SELECT id, 'bank' AS type, name, address, district, lng, lat, brand, branch_type,
       phone, opening_hours, source, license, source_level, updated_at
FROM poi_bank WHERE status <> 'closed'
UNION ALL
SELECT id, 'community' AS type, name, address, district, lng, lat, NULL, NULL,
       NULL, NULL, source, license, source_level, updated_at
FROM poi_community WHERE status <> 'closed';
```

# 4 其他

**迁移机制**：后端启动时 `SchemaMigrator` 读取 `db/migration/V*.sql`，按版本号顺序执行并写入 `schema_version`，避免重复执行；未引入 Flyway，结构变更以新增版本文件的方式管理。

**空间与索引**：两张主表建 `(lat, lng)` 复合索引支撑框选与半径预筛；`v_poi` 为逻辑视图，不占存储。

**已知限制**：`v_poi` 为 `UNION ALL` 视图，全量查询会走物化中间结果，5,000 条量级 P95 约 1 秒；`query_log` 无归档策略，演示量级够用，生产需按月分区。
