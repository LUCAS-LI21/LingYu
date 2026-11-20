# 初步验证 · 接口快照

- 采集时间：2026-11-19 17:31:55（本机时区）
- 目标环境：`http://127.0.0.1:18080`
- 结果：**20 / 20** 成功

| #   | 验证项                      | 方法与路径                                                              | 状态码 | 耗时  | 结果 |
| --- | --------------------------- | ----------------------------------------------------------------------- | ------ | ----- | ---- |
| 1   | 健康检查                    | `GET /api/v1/health`                                                    | 200    | 23 ms | PASS |
| 2   | 元信息                      | `GET /api/v1/meta`                                                      | 200    | 6 ms  | PASS |
| 3   | 列表首页                    | `GET /api/v1/pois?size=3&page=1`                                        | 200    | 66 ms | PASS |
| 4   | 列表-按区域筛选             | `GET /api/v1/pois?district=%E5%8D%97%E5%B1%B1%E5%8C%BA&size=2`          | 200    | 26 ms | PASS |
| 5   | 列表-小区                   | `GET /api/v1/pois?types=community&size=2`                               | 200    | 14 ms | PASS |
| 6   | 统计                        | `GET /api/v1/stats`                                                     | 200    | 27 ms | PASS |
| 7   | 周边银行 1km                | `GET /api/v1/pois/nearby?lng=114.0579&lat=22.5431&radius=1000&limit=5`  | 200    | 10 ms | PASS |
| 8   | 待定位小区                  | `GET /api/v1/community-pending?size=3`                                  | 200    | 18 ms | PASS |
| 9   | 存量住宅用地                | `GET /api/v1/land-parcels?limit=3`                                      | 200    | 5 ms  | PASS |
| 10  | L2 实时地址（无 Key 降级）  | `GET /api/v1/live/address?lng=114.0579&lat=22.5431`                     | 200    | 5 ms  | PASS |
| 11  | 详情                        | `GET /api/v1/pois/osm-node-4866753941`                                  | 200    | 4 ms  | PASS |
| 12  | 详情-字段级来源             | `GET /api/v1/pois/osm-way-1447687402/sources`                           | 200    | 6 ms  | PASS |
| 13  | 最近 3 家银行               | `GET /api/v1/pois/osm-way-1447687402/nearest-banks?limit=3&radius=5000` | 200    | 7 ms  | PASS |
| 14  | 运营登录                    | `POST /api/v1/auth/login`                                               | 200    | 53 ms | PASS |
| 15  | 后台概览                    | `GET /api/v1/admin/overview`                                            | 200    | 19 ms | PASS |
| 16  | 反馈列表                    | `GET /api/v1/admin/feedback?status=pending&size=3`                      | 200    | 8 ms  | PASS |
| 17  | 抓取任务                    | `GET /api/v1/admin/jobs?size=5`                                         | 200    | 6 ms  | PASS |
| 18  | 热点排行                    | `GET /api/v1/admin/hotspots`                                            | 200    | 6 ms  | PASS |
| 19  | 无 token 访问后台（应 401） | `GET /api/v1/admin/overview`                                            | 401    | 4 ms  | PASS |
| 20  | 未知接口（应 404）          | `GET /api/v1/not-exist`                                                 | 404    | 11 ms | PASS |
