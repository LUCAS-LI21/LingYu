---
title: 邻域 POI 情报系统
doc: 接口设计
team: 待填写
regno: 待填写
---

# 1 接口清单

系统对外提供 REST 接口 44 个，统一前缀 `/api/v1`，统一响应体 `{code, message, data}`（`code=0` 为成功）。运营接口（`/api/v1/admin/**`）需 Bearer token。

表 1 接口清单

| 序号 | 分组 | 方法 | 路由                                                | 说明                                                            |
| ---- | ---- | ---- | --------------------------------------------------- | --------------------------------------------------------------- |
| 1    | 公开 | GET  | `/api/v1/health`                                    | 健康检查（含数据库连通）                                        |
| 2    | 公开 | GET  | `/api/v1/meta`                                      | 元信息：坐标系、鉴权、接口自描述                                |
| 3    | 公开 | GET  | `/api/v1/pois`                                      | 列表/地图查询：类型、区域、关键词、价格、年代、bbox、排序、分页 |
| 4    | 公开 | GET  | `/api/v1/pois/{id}`                                 | POI 详情（含 GCJ-02 坐标）                                      |
| 5    | 公开 | GET  | `/api/v1/pois/nearby`                               | 周边银行：球面距离，支持网点/ATM 过滤                           |
| 6    | 公开 | GET  | `/api/v1/pois/{id}/nearest-banks`                   | 某小区最近的 N 家银行                                           |
| 7    | 公开 | GET  | `/api/v1/pois/{id}/nearby-communities`              | 某银行服务半径内的小区（反向关联）                              |
| 8    | 公开 | GET  | `/api/v1/pois/{id}/sources`                         | 字段级数据来源                                                  |
| 9    | 公开 | GET  | `/api/v1/stats`                                     | 品牌 Top8、价格分桶、区域分布、网格密度                         |
| 10   | 公开 | GET  | `/api/v1/hotspots`                                  | 热点排行（前台展示）                                            |
| 11   | 公开 | GET  | `/api/v1/community-pending`                         | 待定位小区名录（分页/按区/关键词）                              |
| 12   | 公开 | GET  | `/api/v1/community-pending/hint`                    | 待定位小区地图初始中心                                          |
| 13   | 公开 | POST | `/api/v1/community-pending/{id}/locate`             | 用户提交坐标（进审核队列）                                      |
| 14   | 公开 | GET  | `/api/v1/land-parcels`                              | 存量住宅用地（宗地级）                                          |
| 15   | 公开 | GET  | `/api/v1/reference-price`                           | 成交参考价分区统计                                              |
| 16   | 公开 | GET  | `/api/v1/reference-price/items`                     | 成交参考价明细（按区分页）                                      |
| 17   | 公开 | GET  | `/api/v1/live/address`                              | L2 实时地址（高德，不落库）                                     |
| 18   | 公开 | GET  | `/api/v1/live/pois`                                 | L2 实时周边（高德，不落库）                                     |
| 19   | 反馈 | POST | `/api/v1/feedback`                                  | 提交纠错/关闭/新增反馈                                          |
| 20   | 反馈 | GET  | `/api/v1/feedback/{code}`                           | 查询反馈处理进度                                                |
| 21   | 鉴权 | POST | `/api/v1/auth/login`                                | 运营登录，返回 Bearer token                                     |
| 22   | 运营 | GET  | `/api/v1/admin/overview`                            | 概览：待审反馈、任务成功率、版本数、新鲜度                      |
| 23   | 运营 | GET  | `/api/v1/admin/feedback`                            | 反馈列表（按状态分页）                                          |
| 24   | 运营 | POST | `/api/v1/admin/feedback/{code}/approve`             | 采纳：分流生效、写版本、必要时建定向任务                        |
| 25   | 运营 | POST | `/api/v1/admin/feedback/{code}/reject`              | 驳回                                                            |
| 26   | 运营 | POST | `/api/v1/admin/pois/{id}/reopen`                    | 恢复被关闭的点位                                                |
| 27   | 运营 | POST | `/api/v1/admin/import`                              | 批量导入 POI（CSV/JSON 行）                                     |
| 28   | 运营 | GET  | `/api/v1/admin/pending`                             | 待定位银行列表                                                  |
| 29   | 运营 | POST | `/api/v1/admin/pending/import`                      | 导入待定位银行                                                  |
| 30   | 运营 | POST | `/api/v1/admin/pending/{id}/promote`                | 待定位银行转正                                                  |
| 31   | 运营 | POST | `/api/v1/admin/community-pending/{id}/locate`       | 管理员标注小区坐标并转正                                        |
| 32   | 运营 | POST | `/api/v1/admin/community-pending/{id}/reject`       | 驳回待定位小区                                                  |
| 33   | 运营 | GET  | `/api/v1/admin/coordinate-submissions`              | 用户提交的坐标列表                                              |
| 34   | 运营 | POST | `/api/v1/admin/coordinate-submissions/{id}/approve` | 采纳用户坐标                                                    |
| 35   | 运营 | POST | `/api/v1/admin/coordinate-submissions/{id}/reject`  | 驳回用户坐标                                                    |
| 36   | 运营 | GET  | `/api/v1/admin/jobs`                                | 抓取任务列表                                                    |
| 37   | 运营 | POST | `/api/v1/admin/jobs`                                | 手动触发抓取（异步）                                            |
| 38   | 运营 | GET  | `/api/v1/admin/hotspots`                            | 热点排行                                                        |
| 39   | 运营 | POST | `/api/v1/admin/hotspots/recompute`                  | 重算热点                                                        |
| 40   | 运营 | GET  | `/api/v1/admin/agent/status`                        | AI 补全是否可用                                                 |
| 41   | 运营 | POST | `/api/v1/admin/agent/propose`                       | 生成一条补全建议（不写库）                                      |
| 42   | 运营 | POST | `/api/v1/admin/agent/{runId}/apply`                 | 采纳建议并写库                                                  |
| 43   | 运营 | GET  | `/api/v1/admin/agent/runs`                          | 运行记录                                                        |
| 44   | 运营 | POST | `/api/v1/admin/agent/batch`                         | 批量生成建议（≤20 条）                                          |

# 2 接口详情

## 2.1 公共约定

- **响应信封**：`{"code":0,"message":"ok","data":{...}}`；`code` 非 0 时 `message` 为人可读原因。
- **状态码**：400 参数错误 / 401 未登录或凭据错误 / 404 资源不存在 / 405 方法不允许 / 409 状态冲突 / 429 限流。
- **鉴权**：`Authorization: Bearer <token>`，token 为 HMAC-SHA256 签名，默认 12 小时有效；审核人取自 token 主体，不读请求体。
- **坐标系**：入参与存储统一 WGS-84；响应中的 `gcjLng/gcjLat` 为服务端换算的 GCJ-02，供跳转国内地图。
- **限流**：匿名写接口（反馈 10 次/分钟、坐标 20 次/分钟）超限返回 429。

## 2.2 GET /api/v1/health、GET /api/v1/meta

健康检查返回服务与数据库状态；元信息返回坐标系、鉴权方式与全部接口自描述，便于端侧发现能力。

| 项       | 内容                                                                                       |
| -------- | ------------------------------------------------------------------------------------------ |
| 涉及表   | 无（`SELECT 1`）；元信息为常量                                                             |
| 请求参数 | 无                                                                                         |
| 返回示例 | `{"code":0,"data":{"status":"ok","db":"up"}}`；`/meta` 返回 `coord`、`auth`、`endpoints[]` |

## 2.3 GET /api/v1/pois

列表与地图共用：按类型、区域、关键词、价格、年代、矩形范围过滤，支持排序与分页。

| 参数                          | 类型   | 必填 | 说明                                                         |
| ----------------------------- | ------ | ---- | ------------------------------------------------------------ |
| `types`                       | string | 否   | 逗号分隔：`bank`、`community`                                |
| `district`                    | string | 否   | 行政区，如 `南山区`                                          |
| `keyword`                     | string | 否   | 名称/地址模糊匹配                                            |
| `branchType`                  | string | 否   | `all` / `branch` / `atm`                                     |
| `minPrice`/`maxPrice`         | int    | 否   | 小区均价区间（元/㎡）                                        |
| `minYear`/`maxYear`           | int    | 否   | 建成年份区间                                                 |
| `west`/`south`/`east`/`north` | number | 否   | 框选矩形（WGS-84）                                           |
| `sort`                        | string | 否   | `default`/`name`/`priceAsc`/`priceDesc`/`yearDesc`/`yearAsc` |
| `page`/`size`                 | int    | 否   | 默认 1/20，`size` 上限 20,000                                |

涉及表：`v_poi`（查询）、`query_log`（写入）。返回示例：

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
    "total": 5429,
    "page": 1,
    "size": 20
  }
}
```

## 2.4 GET /api/v1/pois/{id}

按主键取详情；已关闭点位不在视图内，返回 404。涉及表：`v_poi`。无查询参数。

## 2.5 GET /api/v1/pois/nearby

以给定坐标查周边银行，先按半径换算矩形走 `(lat, lng)` 索引预筛，再用 `ST_Distance_Sphere` 精算并按距离升序。

| 参数         | 类型   | 必填 | 说明                                             |
| ------------ | ------ | ---- | ------------------------------------------------ |
| `lng`/`lat`  | number | 是   | 圆心坐标（WGS-84）                               |
| `radius`     | number | 否   | 半径（米），默认 1000，上限 5000                 |
| `branchType` | string | 否   | `all`/`branch`/`atm`                             |
| `limit`      | int    | 否   | 默认 50，上限 200；返回条数与 `total` 同受此限制 |

涉及表：`poi_bank`（含 ATM）、`query_log`。返回示例：

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

## 2.6 GET /api/v1/pois/{id}/nearest-banks、/nearby-communities

两个方向相反的关联查询：前者以小区为圆心找最近 N 家银行（`limit` 默认 3、`radius` 默认 5000），后者以银行为圆心找服务半径内的小区（`radius` 默认 1000、`limit` 默认 10）。涉及表：`poi_bank`、`poi_community`。

```json
{
  "code": 0,
  "data": {
    "items": [
      { "name": "招商银行深圳宝安支行", "distance": 218 },
      { "name": "中国工商银行", "distance": 441 }
    ],
    "total": 2
  }
}
```

## 2.7 GET /api/v1/pois/{id}/sources

返回该点位每个字段的来源与来源 URL，用于详情页"数据来源"区块。涉及表：`poi_field_source`。

```json
{
  "code": 0,
  "data": { "items": [{ "field": "phone", "source": "招商银行官网", "sourceUrl": "https://..." }] }
}
```

## 2.8 GET /api/v1/stats

聚合统计：总量、品牌 Top8、价格分桶、分区银行/小区数、2km 网格密度 Top6；`priceSample.real_count` 标明真实均价条数。涉及表：`v_poi`。

## 2.9 GET /api/v1/community-pending、/hint

待定位小区名录：`district`、`keyword`、`page`、`size`，默认 20/页；`hint` 返回某区地图中心（含 GCJ 版）。涉及表：`community_pending`。

## 2.10 POST /api/v1/community-pending/{id}/locate

用户在地图上点为小区补坐标，写入待审表，不直接改主表。

| 参数        | 类型   | 必填 | 说明                   |
| ----------- | ------ | ---- | ---------------------- |
| `lng`/`lat` | number | 是   | 用户标注坐标（WGS-84） |
| `source`    | string | 否   | 默认 `user`            |
| `note`      | string | 否   | 备注                   |

涉及表：`community_pending`（校验存在）、`coordinate_submission`（写入）。返回 `{"code":0,"data":{"id":12,"status":"pending"}}`。

## 2.11 GET /api/v1/land-parcels

存量住宅用地（宗地级），`district` 与 `limit` 可选，按供地时间倒序。涉及表：`land_parcel`。

## 2.12 POST /api/v1/feedback

| 参数          | 类型   | 必填 | 说明                               |
| ------------- | ------ | ---- | ---------------------------------- |
| `poiType`     | string | 是   | `bank` / `community`               |
| `poiId`       | string | 是   | 目标点位主键（`add` 类型可用锚点） |
| `type`        | string | 是   | `error` / `closed` / `add`         |
| `field`       | string | 否   | 纠错字段中文名                     |
| `newValue`    | string | 否   | 新值                               |
| `description` | string | 是   | 问题描述                           |
| `contact`     | string | 否   | 联系方式                           |

涉及表：`feedback`（写入）；低风险字段开关打开时会同事务写 `poi_version` 与主表。返回 `{"code":0,"data":{"code":"FB20261119-0103","status":"pending"}}`。

## 2.13 GET /api/v1/feedback/{code}

用户凭编号查询处理进度与审核意见。涉及表：`feedback`。不存在返回 404。

## 2.14 GET /api/v1/live/address、/live/pois

高德 L2 通道：逆地理编码与周边搜索，**不落库、不缓存**，响应头 `Cache-Control: no-store`；服务端做 WGS-84 → GCJ-02 转换与每日预算闸门，触发闸门时仍返回 200，`throttled=true` 并给出原因。

## 2.15 POST /api/v1/auth/login

| 参数       | 类型   | 必填 | 说明                         |
| ---------- | ------ | ---- | ---------------------------- |
| `username` | string | 是   | 运营账号                     |
| `password` | string | 是   | 明文口令，服务端 PBKDF2 校验 |

涉及表：`sys_user`。成功返回 `{"token":"...","username":"operator","expiresAt":"..."}`；凭据错误 401，连续错误触发 429。

## 2.16 GET /admin/overview、GET /admin/feedback、POST /admin/feedback/{code}/approve|reject

概览聚合待审反馈、任务数、版本数与平均新鲜度；反馈列表按 `status`（`pending`/`approved`/`rejected`/`need_refetch`/`all`）分页；采纳时按类型分流并写版本，`add` 类型落暂存表并建定向任务，重复采纳返回 409。

涉及表：`feedback`、`poi_bank`、`poi_community`、`poi_version`、`bank_pending`、`community_pending`、`ingest_job`。

```json
{
  "code": 0,
  "data": {
    "code": "FB20261119-0099",
    "status": "need_refetch",
    "pendingStaged": true,
    "anchorLng": 114.052335,
    "anchorLat": 22.649201,
    "jobId": 440
  }
}
```

## 2.17 GET/POST /api/v1/admin/jobs

任务列表分页；手动触发接受 `south`/`west`/`north`/`east`/`trigger`，默认福田中心区，返回 `{"jobId":N,"status":"pending"}`，实际抓取异步执行。涉及表：`ingest_job`。

## 2.18 GET /api/v1/admin/hotspots、POST /hotspots/recompute

热点排行与重算（`查询次数 + 2 × 零结果次数`）。涉及表：`hot_region`、`query_log`。

## 2.19 GET /admin/pending、POST /admin/pending/import、POST /admin/pending/{id}/promote

待定位银行（有地址无坐标）的列表、导入与转正；转正时写 `poi_bank` 并标记 `geocoded`。涉及表：`bank_pending`、`poi_bank`、`poi_field_source`。

## 2.20 POST /admin/community-pending/{id}/locate|reject、GET/POST /admin/coordinate-submissions

管理员标注坐标直接转正；用户提交的坐标在此审核，通过后写 `poi_community` 与 `community_pending.poi_id`。涉及表：`community_pending`、`coordinate_submission`、`poi_community`、`poi_field_source`。

## 2.21 运营 AI 接口：/admin/agent/status|propose|{runId}/apply|runs|batch

`propose` 走"搜索 → 抽取 → 复核 → 规则校验"，只产出建议不写库；`apply` 由管理员触发，写主表与 `poi_version`；`batch` 一次最多 20 条。涉及表：`agent_run`、`poi_bank`、`poi_version`、`poi_field_source`。

# 3 其他

- **契约来源**：`docs/api/openapi.yaml` 为机器可读契约，本文与其保持同步；接口变更需同时改两处。
- **自描述**：`GET /api/v1/meta` 返回全部公开接口清单，小程序/第三方可据此发现能力。
- **测试**：`scripts/full-acceptance.mjs` 覆盖 32 项正向/反向/边界用例，`scripts/evidence-snapshot.mjs` 对 20 个接口逐项取证。
