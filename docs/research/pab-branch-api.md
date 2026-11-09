# 平安银行「服务网点」数据链路实测（深圳）

> 探测日期：2026-11-10（Asia/Shanghai）
> 入口：<https://b.pingan.com.cn/papb/ebank/pc-map/geren/fuwuwangdian/map.shtml>（由 bank.pingan.com 页脚「服务网点」进入）
> 脚本：`scripts/probe-pab.mjs`（Playwright 交互 + 无浏览器独立复跑）
> 产物：`scripts/probe-out/pab-shenzhen.json`、`scripts/probe-out/pab-0{1,2,3}-*.png`

## 0. 结论速览

| 问题                   | 结论                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| 返回网点列表的接口     | `GET https://rsb.pingan.com.cn/mkt/iclient-core/cust/ams-rbms-core/app/getBankShowListJsonp` |
| 传输方式               | **JSONP**（`dataType:'jsonp'`、`jsonpCallback:'callback'`），不是 XHR；无 POST body          |
| 是否依赖 Cookie / 登录 | **不依赖**。全新 Node 进程、零 Cookie、无 Referer 直接请求即得 `responseCode=000000`         |
| 是否要城市 ID          | 不要。`cityId` 恒为空，`city=深圳` 即城市选择器；`srhKeyword` 可空                           |
| 经纬度                 | **有**，`lat`/`lng` 全量 90/90；坐标系为**百度 BD-09**（见 §3）                              |
| 每页 / 总数            | 接口**不分页、无 total 字段**，一次返回全部 **90** 条；前端本地按 10 条/页分页（共 9 页）    |
| 深圳营业网点数         | **90**（名称、地址各 90 个唯一值；电话 114 个）                                              |
| 城市列表               | `getBankShowCityListJsonp` 返回 106 个城市名，无 id、无坐标                                  |
| 同接口 ATM             | `type=ATM` 返回深圳 **232** 条自助设备（仅 name/address/lat/lng/cardRepay/preciseDistance）  |

## 1. 页面交互路径（Playwright 实测）

`bank.pingan.com` → 页脚「服务网点」→ `b.pingan.com.cn/.../fuwuwangdian/map.shtml`（title：平安银行网点地图）。

该页是 jQuery 老站，**省级下拉在源码里被整段注释**（`<!-- 选择省份 -->`），UI 上只有「选择城市」。
脚本内真实点击流程：

1. 打开页面（默认城市已是深圳，页面自动请求一次 `getBankShowListJsonp?city=深圳`）
2. 点击「选择城市」输入框 → 输入「深圳」→ 下拉过滤出深圳
3. 点选「深圳」→ 触发第二次 `getBankShowListJsonp`，左侧渲染 10 条、分页条 `1 2 3 4`

抓到的数据类请求（完整 URL/method/postData/响应前 600 字符见 JSON）：

| #   | 请求                                                                     | 用途                                   |
| --- | ------------------------------------------------------------------------ | -------------------------------------- |
| 1   | `getBankShowCityListJsonp?callback=callback&type=YYWD`                   | 城市列表（106）                        |
| 2   | `getBankShowListJsonp?callback=callback&source=WEB&city=深圳&type=YYWD`  | **网点列表**（页面自动，90 条）        |
| 3   | `bfiles.pingan.com.cn/.../dlds-dfp/public/generate/jsonp?...`            | 设备指纹埋点，与网点无关               |
| 4   | `getBankShowListJsonp?...&srhKeyword=请输入关键字..&city=深圳&type=YYWD` | 点选深圳后再次查询（90 条，结果同 #2） |

> 页面把搜索框占位符「请输入关键字..」当 `srhKeyword` 传了，但服务端未按它过滤；实现时留空即可。

## 2. 接口细节

### 2.1 城市列表

```text
GET https://rsb.pingan.com.cn/mkt/iclient-core/cust/ams-rbms-core/app/getBankShowCityListJsonp
  ?type=YYWD          # YYWD=营业网点；ATM 页传 ATM
  &callback=callback  # JSONP 回调名，必需（缺省时返回 null(...)）
```

响应：`{"data":[{"city":"深圳"},...],"responseCode":"000000","responseMsg":"成功"}`，106 个城市，**无 cityId**。

### 2.2 网点列表

```text
GET https://rsb.pingan.com.cn/mkt/iclient-core/cust/ams-rbms-core/app/getBankShowListJsonp
  ?source=WEB
  &cityId=            # 实测恒为空，不影响结果
  &srhKeyword=        # 关键词，空=全量；不参与服务端过滤时也返回全量
  &city=深圳          # 城市名（不带“市”），URL 编码
  &type=YYWD          # YYWD 营业网点 / ATM 自助设备
  &callback=callback  # JSONP 必需
```

- method 全部为 **GET**，无 POST body，参数只在 query string。
- 请求头只需浏览器 UA；**无 Referer、无 Cookie 亦可**。
- 响应顶层只有 `data` / `responseCode` / `responseMsg`，**没有 total、pageNo、pageSize**；90 条一次给全。
- `responseCode="000000"` 为成功。

### 2.3 返回字段（网点，18 个）

| 字段                                                                       | 含义 / 样例                                                                       |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `name`                                                                     | 网点名，如「平安银行深圳分行营业部」                                              |
| `address`                                                                  | 地址，**只有区+路名，不含“深圳市”**，如「福田区深南中路1099号平安银行大厦1、2楼」 |
| `tles`                                                                     | 电话数组（字符串），如 `["075525878047","075525859649"]`，无分隔符                |
| `workingTime`                                                              | 对私营业时间；**同一时段有重复片段**，需清洗                                      |
| `corporateWorkingTime`                                                     | 对公营业时间；同样有重复片段                                                      |
| `shopHour`                                                                 | 对私+对公合并后的展示串，**已去重、最干净**，建议优先入库                         |
| `lat` / `lng`                                                              | 经纬度，字符串（BD-09）                                                           |
| `city`                                                                     | 城市名「深圳」                                                                    |
| `id`                                                                       | 网点编号，如 `2101`、`0823`                                                       |
| `cardRepay` / `orderOpenCard` / `visitOpenCard` / `cardActivation`         | 业务标志，`"true"`/`"false"` 字符串                                               |
| `largeamountCashSumsill` / `openCardServicescope` / `openCardResponsetime` | 大额现金、开卡服务范围/响应时间等，多为空或数字串                                 |
| `preciseDistance`                                                          | 距离参考点的米数（浮点），与网点本身无关                                          |

### 2.4 分页

接口层无分页；前端 `Pager(current, data.length, 10)` 在浏览器内切片，**10 条/页、90 条共 9 页**。
分页条源码只显示 4 个页码窗口（首页显示 1–4），翻页不产生新请求。

## 3. 坐标系：BD-09（重要）

页面把接口值直接喂给百度地图：`new BMap.Point(data[i].lng, data[i].lat)`，未做任何转换 → 值为 **BD-09**。
用仓库内 OSM（WGS-84）的 12 个平安银行点做最近邻校验：

- 直接把接口值当 WGS-84：平均最近距离 **715 m**
- 先按 BD-09→GCJ-02→WGS-84 换算：平均最近距离 **104 m**

结论：接口坐标是 BD-09。入库前必须转换；`scripts/lib/coord.mjs` 目前只有 GCJ-02↔WGS-84，**缺 BD-09 段**，需补 `bd09ToGcj02`（再复用 `gcj02ToWgs84`）。

## 4. robots.txt

| 主机                | 状态                                                  | 内容                                                                                                                                  |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `bank.pingan.com`   | 200，真 robots                                        | `User-agent: *` / `Disallow: /webcall/` / `Disallow: /*mc_id*` / `Disallow: /member/` / `Sitemap: http://bank.pingan.com/sitemap.xml` |
| `b.pingan.com.cn`   | 200，**软 404**（返回口袋银行 SPA HTML，不是 robots） | 无有效规则                                                                                                                            |
| `rsb.pingan.com.cn` | 404                                                   | `{msg=slb didn't difine location route ...}`，无 robots                                                                               |

网点页与 `/mkt/iclient-core/...` 接口均不在任何 `Disallow` 内；仅访问公开页面，未登录。

## 5. 独立复跑（不依赖 Cookie）

脚本末尾用 Node `fetch`（零 Cookie、无 Referer、仅浏览器 UA）重新请求：

```bash
node scripts/probe-pab.mjs
# [verify] via=node-fetch status=200 responseCode=000000 条数=90
# [verify] 与浏览器结果一致=true 含经纬度=90/90
# [verify] 城市列表 城市数=106 含深圳=true
```

与浏览器内捕获的 90 条逐条比对（name/lat/lng）**完全一致**。本机未出现
`ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED`，`scripts/lib/http.mjs` 的 curl 兜底未触发（脚本仍保留该分支）。

## 6. 数据质量 / 入库建议

- 90 条覆盖 9 个行政区：南山 22、福田 21、龙岗 12、罗湖 11、宝安 10、龙华 8、盐田 3、光明 2、坪山 1。
- 纬度 22.4948–22.7840、经度 113.8257–114.4332，均在深圳范围内，无缺失、无重复名称。
- `address` 需补「深圳市」前缀；`tles` 需格式化为 `0755-xxxxxxxx`；营业时间建议直接用 `shopHour`。
- 业务标志（是否可开卡/还信用卡等）可直接映射为 POI 属性；`id` 可作行内唯一键（形如 4 位字符串）。

## 7. 复现

```bash
node scripts/probe-pab.mjs
```

- 只访问 `*.pingan.com` / `*.pingan.com.cn`；Playwright 路由拦截并 abort 其余第三方请求
  （页面原本加载百度地图 JS，脚本用最小 `BMap` stub 顶替，仅让交互跑通，不伪造数据）。
- 主动请求间隔 ≥1100 ms。
- 输出：`scripts/probe-out/pab-shenzhen.json`（含 robots、4 条请求日志、90 条明细、坐标校验）与 3 张页面截图。
