# 数据模型（ER）

> 对应 `backend/src/main/resources/db/migration/（V1–V3）`。MySQL 8.0，InnoDB，utf8mb4。

## 1. 表关系

```text
                    ┌──────────────┐
                    │  ds_source   │  数据源（含存储策略 L1/L2/L3）
                    └──────┬───────┘
                           │ 1:N
                    ┌──────▼───────┐
                    │  ingest_job  │  抓取任务（手动/定时/热点）
                    └──────────────┘

  ┌────────────┐        ┌──────────────────┐
  │  poi_bank  │        │  poi_community   │
  └─────┬──────┘        └────────┬─────────┘
        │  └────────────┬────────┘
        │               │ UNION ALL
        │        ┌──────▼──────┐
        │        │   v_poi     │  统一查询视图（排除 closed）
        │        └─────────────┘
        │
        │ 1:N（按 poi_type + poi_id）
  ┌─────▼───────┐
  │ poi_version │  变更留痕（before/after JSON + 操作人）
  └─────▲───────┘
        │ feedback_id
  ┌─────┴───────┐
  │  feedback   │  用户反馈（风险分流 → 自动采纳/人工审核）
  └─────────────┘

  ┌───────────┐   每日/手动聚合   ┌────────────┐
  │ query_log │ ───────────────► │ hot_region │ → 驱动调度
  └───────────┘                   └────────────┘

  ┌──────────┐
  │ sys_user │  运营账号（PBKDF2 口令）
  └──────────┘
```

## 2. 表清单

| 表              | 作用                | 关键字段                                                                       | 索引/约束                              |
| --------------- | ------------------- | ------------------------------------------------------------------------------ | -------------------------------------- |
| `poi_bank`      | 银行网点            | id, name, brand, branch_type, lng, lat, district, phone, opening_hours, status | PK(id)、(lat,lng)、district、brand     |
| `poi_community` | 住宅小区            | id, name, built_year, avg_price, property_fee, demo_attributes                 | PK(id)、(lat,lng)、district、avg_price |
| `feedback`      | 用户反馈            | code, poi_type, poi_id, type, field_name, new_value, status, reviewer          | UNIQUE(code)、status、created_at       |
| `poi_version`   | POI 变更版本        | poi_type, poi_id, change_type, before_json, after_json, operator, feedback_id  | (poi_type, poi_id, created_at)         |
| `ingest_job`    | 抓取任务            | source_code, trigger_type, scope_value, status, fetched/inserted/updated_count | created_at、status                     |
| `ds_source`     | 数据源              | code, storage_policy, rate_limit_qps, enabled                                  | UNIQUE(code)                           |
| `query_log`     | 查询日志            | kind, keyword, district, grid, result_count, cost_ms                           | created_at、grid                       |
| `hot_region`    | 热点聚合            | grid, stat_date, query_count, zero_result_count, priority                      | UNIQUE(grid, stat_date)                |
| `sys_user`      | 运营账号            | username, password_hash, role, status                                          | UNIQUE(username)                       |
| `v_poi`（视图） | 两类 POI 统一查询面 | 合并字段 + `updated_at`                                                        | 排除 `status='closed'`                 |

## 3. 三个设计决策

1. **统一视图而非统一表**
   银行与小区字段差异大，物理上分表（避免大量 NULL 列）；查询侧用 `v_poi` 合并，分页/排序/筛选只写一套 SQL。`closed` 状态在视图层过滤，保证"关掉就查不到"。

2. **版本与主表分离**
   `poi_version` 只追加不修改，记录 before/after JSON、操作人与来源反馈 ID。回答"谁在什么时候把营业时间改成 9-18"。

3. **热点用聚合表而非实时算**
   `query_log` 每次查询追加一行；`hot_region` 由 `query_count + 2 × zero_result_count` 聚合（零结果权重更高，因为它代表"该有数据却没有"）。调度器只读聚合表，避免实时扫描日志。

## 4. 空间查询口径

- **周边查询**：`ST_Distance_Sphere(POINT(lng,lat), POINT(?,?))`，MySQL 内置，返回米。
- **框选**：`lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?`，走 `(lat,lng)` 复合索引。
- **网格聚合**：`FLOOR(lng/0.02)` / `FLOOR(lat/0.02)`，约 2.2km × 2.2km，与前端统计页口径一致。
- 坐标系：全库统一 GCJ-02（OSM 原始为 WGS-84，导入时按同源处理；混源时需转换，见 `docs/requirements/03-合规与数据来源.md`）。

## 5. 已知限制（下一轮要补）

- 没有真正的迁移工具（Flyway 未引入），`db/migration` 靠 `CREATE TABLE IF NOT EXISTS` 幂等；**加字段需手工 ALTER**。
- `poi_version` 目前只由反馈审核写入，抓取任务尚未产生版本记录（应改为 upsert 时对比字段并写版本）。
- `query_log` 无归档策略，演示量级够用，生产需按月分区。
