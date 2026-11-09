# 中国建设银行「网点及ATM」数据链路实测（深圳）

> 探测日期：2026-11-10（Asia/Shanghai）  
> 入口：<http://ebank3.ccb.cn/cn/home/map/branchSearch.html>  
> 脚本：`scripts/probe-ccb.mjs`（Playwright 交互 + 纯 HTTP 两种模式）  
> 产物：`data/ccb-probe/`、`scripts/probe-out/ccb-shenzhen.json`

## 0. 结论速览

| 问题                           | 结论                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| 真正返回网点列表的接口         | `GET https://wealth.ccb.com/tran/WCCMainPlatV5?...&TXCODE=NZX013`                                  |
| 是否要登录 / Cookie / 页面会话 | **不要**。全新进程、零 Cookie 直接请求即返回 `SUCCESS=true`；页面里的 `TXCODE=100119` 不是前置条件 |
| 能否拿到经纬度                 | **能**。字段 `Lgt`（经度）/`Ltt`（纬度），全量 153 条无缺失；坐标系按页面声明为 **GCJ-02**         |
| 一次请求返回多少条             | **固定 10 条**（`CURR_TOTAL_REC=10`），改页大小参数无效                                            |
| 深圳市（营业网点）总共多少条   | **153 条，16 页**（`TOTAL_REC=153`）                                                               |
| 福田区（营业网点）             | **40 条，4 页**                                                                                    |
| 分页参数                       | `PAGE_JUMP`，从 **1** 开始；越界会被夹到最后一页                                                   |
| 其他字段                       | 名称 `CCBIns_Nm`、地址 `Dtl_Adr`、电话 `Fix_TelNo`、营业时间（对私/对公分时段）一应俱全            |

## 1. 页面交互路径（Playwright 实测）

入口 `http://ebank3.ccb.cn/...` 会被站点脚本切到 `https://wealth.ccb.com/cn/home/map/branchSearch.html`。
在 headless Chrome 中依次**真实点击**：

1. `#selectProvince` → 广东省（`areacode=440000`）
2. `#selectCity` → 深圳市（`areacode=440300`）
3. `#selectcountry` → 福田区（`areacode=440304`）——选中即自动查询
4. 点放大镜「查询」按钮 `.btn-map`——走同一个接口
5. 点分页条 `#page` 的数字「2」——`PAGE_JUMP=2`

抓到的 XHR 顺序（节选）：

| #   | 请求                                               | 用途                                                     |
| --- | -------------------------------------------------- | -------------------------------------------------------- |
| 1   | `TXCODE=NAREA2&type=1`                             | 34 个省级行政区                                          |
| 2   | `TXCODE=NAREA2&type=2&areacode=440000`             | 广东 21 个地市                                           |
| 3   | `TXCODE=NAREA2&type=3&areacode=440300`             | 深圳 10 个区（含 440301 市辖区）                         |
| 4   | `TXCODE=100119`                                    | 页面查询前的“访问登录”，返回 108 字节 base64，**非必需** |
| 5   | `TXCODE=NZX013&...&ADiv_Cd=440304&...&PAGE_JUMP=1` | **网点列表**                                             |
| 6   | 同上（点查询按钮）                                 | 结果与 5 一致（TOTAL_REC=40）                            |
| 7   | 同上（`PAGE_JUMP=2`）                              | 第 2 页，`CURR_TOTAL_PAGE=2`                             |
| 8   | 同上（`ADiv_Cd=440300`）                           | 深圳全市，TOTAL_REC=153                                  |

完整 URL / method / postData / 响应前 800 字符见 `data/ccb-probe/xhr-log.json`。

## 2. 列表接口

```text
GET https://wealth.ccb.com/tran/WCCMainPlatV5
  ?CCB_IBSVersion=V5
  &SERVLET_NAME=WCCMainPlatV5
  &isAjaxRequest=true
  &TXCODE=NZX013
  &Enqr_Cnd_Cntnt＝011860003      ← 注意是全角等号 U+FF1D；实测可省略、也可改半角，结果一致
  &isJSONRequest=true
  &ADiv_Cd=440304                 ← 区县代码；传 440300 即整个深圳
  &Kywd_List_Cntnt=               ← 关键词，空=不筛；传「支行」时福田 40→39
  &Enqr_MtdCd=1                   ← 1 营业网点 / 2 自助银行 / 3 ATM / 4 全部
  &Cur_StCd=4                     ← 状态筛选，4=全部；传 1 时该区返回 0
  &PAGE_JUMP=1                    ← 页码，从 1 开始
```

- **method**：GET，无 POST body，全部参数在 query string。
- **必须的请求头**：只要 `User-Agent` 以浏览器标识开头即可；`Referer` 可有可无。
  - 纯自定义 UA（如 `poi-intel-demo/0.1 ...`）→ **HTTP 200 但 body 为空**；
  - 浏览器 UA 后可追加项目标识（`... Safari/537.36 poi-intel-demo/0.1 (contact ...)`）→ 正常返回。
- **Cookie / 会话**：无需。无 Cookie 直接请求返回 `SUCCESS=true`。
- **前置请求**：页面会先调 `TXCODE=100119`（返回 base64），但实测不调也能取到数据。

### 响应顶层结构

```json
{
  "SUCCESS": "true",
  "MTTC": "",
  "TXCODE": "NZX013",
  "SYS_EVT_TRACE_ID": "1010165321794255776357333",
  "TOTAL_PAGE": "4",
  "TOTAL_REC": "40",
  "CURR_TOTAL_PAGE": "1",
  "CURR_TOTAL_REC": "10",
  "STS_TRACE_ID": "",
  "OUTLET_DTL_LIST": [ ... ]
}
```

`Enqr_MtdCd=1` 时只有 `OUTLET_DTL_LIST`；`=2` 时只有 `SLFBANK_DTL_LIST`（自助银行）；
`=4` 时同时返回 `OUTLET_DTL_LIST` + `SLFBANK_DTL_LIST`（两表合计每页 10 条）。

### 网点对象字段（`OUTLET_DTL_LIST[]`）

| 字段                             | 含义                                                            | 示例                                         |
| -------------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| `PK_ID`                          | 网点唯一 ID                                                     | `442000094`                                  |
| `CCBIns_Nm`                      | 网点名称                                                        | `建行深圳园博园支行`                         |
| `Dtl_Adr`                        | 地址                                                            | `深圳市福田区竹子林紫竹六道越海家园裙楼首层` |
| `Fix_TelNo`                      | 电话                                                            | `86-0755-82025240`                           |
| `Lgt` / `Ltt`                    | 经度 / 纬度（字符串，GCJ-02）                                   | `114.006632000767` / `22.5346279997833`      |
| `ADiv_Cd`                        | 区县代码                                                        | `440304`                                     |
| `Enqr_MtdCd`                     | 网点类型                                                        | `1`                                          |
| `Cur_StCd`                       | 当前状态码（页面图例：0 休息 / 1 仅对私 / 2 对私对公 / 3 营业） | `0`                                          |
| `Prvt_WkDy_Oprg_StTm` / `EdTm`   | 对私 周一至周五 起/止                                           | `09:00:00` / `17:00:00`                      |
| `Prvt_WkDy_Rst_StTm` / `EdTm`    | 对私 工作日午休起/止（`00:00:00`=无）                           | `00:00:00`                                   |
| `Prvt_Sat_*` / `Prvt_Sun_*`      | 对私 周六 / 周日 营业与午休时段                                 | `00:00:00`（休息）                           |
| `CorpWkDyFrnnOprg_StTm` / `EdTm` | 对公 工作日上午                                                 | `09:00:00` / `12:00:00`                      |
| `CorpWkDyAftrnOprgStTm` / `EdTm` | 对公 工作日下午                                                 | `14:00:00` / `17:00:00`                      |
| `Dstn_Len`                       | 距离类字段（未确认口径，不建议使用）                            | `12475851`                                   |

> 页面信息弹窗的「营业时间」由这些字段拼出（`message_box_b.html`），列表响应本身就带全了，**不需要再调详情接口**。
> 详情接口 `TXCODE=ZX0003&Enqr_Cnd_Cntnt=<PK_ID>&Enqr_MtdCd=1` 也可用，但字段与列表一致（实测无额外备注字段）。

### 响应样例（首条，已截断）

```json
{
  "Enqr_MtdCd": "1",
  "PK_ID": "442000094",
  "CCBIns_Nm": "建行深圳园博园支行",
  "Dtl_Adr": "深圳市福田区竹子林紫竹六道越海家园裙楼首层",
  "Fix_TelNo": "86-0755-82025240",
  "ADiv_Cd": "440304",
  "Lgt": "114.006632000767",
  "Ltt": "22.5346279997833",
  "Prvt_WkDy_Oprg_StTm": "09:00:00",
  "Prvt_WkDy_Oprg_EdTm": "17:00:00",
  "Prvt_Sun_Oprg_StTm": "09:00:00",
  "Prvt_Sun_Oprg_EdTm": "16:00:00",
  "CorpWkDyFrnnOprg_StTm": "09:00:00",
  "CorpWkDyFrnnOprg_EdTm": "12:00:00",
  "CorpWkDyAftrnOprgStTm": "14:00:00",
  "CorpWkDyAftrnOprgEdTm": "17:00:00",
  "Cur_StCd": "0"
}
```

## 3. 经纬度与坐标系

- 字段名：**`Lgt`（经度）、`Ltt`（纬度）**，十进制字符串，直接 `Number()` 即可。
- 覆盖：深圳全市 153 条**全部**有值；福田 40 条全部有值；坐标范围经度 114.00–114.42、纬度 22.49–22.77，符合深圳地理范围。
- 坐标系：页面 `js/selectshow3.js` 的 `createMap()` 显式设置
  `new BMap.Map(container, { coordsType: BMAP_COORD_GCJ02 })`，即把接口返回的 `Lgt/Ltt` 按 **GCJ-02** 交给百度地图。
  因此入库时应标记 `gcj02`；若下游用 WGS84/Leaflet+OSM，需要做 GCJ-02 → WGS84 偏移校正。**未做外部地理编码交叉验证**。

## 4. 分页与总量

- 页码参数：`PAGE_JUMP`，**1-based**。
- 每页条数：固定 **10**（`CURR_TOTAL_REC=10`）。实测追加 `PAGE_SIZE=50`、`Page_Size=50`、`CNT_PER_PG=50` 均被忽略，仍返回 10 条。
- 第 2 页与第 1 页无重复（福田 4 页共 40 条，`PK_ID` 40 个互不相同）。
- `PAGE_JUMP` 超过末页不会报错，服务端夹到最后一页（深圳 153 条时传 17 返回第 16 页的 3 条）。
- 排序看起来与距离/默认排序有关（同一次全量抓取中 153 条无重复、福田 40 条全部命中），**不要依赖顺序**，按 `PK_ID` 去重。

实测总量（2026-11-10）：

| 范围     | `Enqr_MtdCd` | `TOTAL_REC` | `TOTAL_PAGE`    |
| -------- | ------------ | ----------- | --------------- |
| 福田区   | 1 营业网点   | **40**      | 4               |
| 福田区   | 2 自助银行   | 36          | 4               |
| 福田区   | 4 全部       | 76          | 8               |
| 福田区   | 3 ATM        | 0           | 0               |
| 深圳全市 | 1 营业网点   | **153**     | 16（末页 3 条） |
| 深圳全市 | 4 全部       | 286         | 29              |

## 5. 纯 HTTP 可复现（推荐采集方式）

```bash
# 全量深圳营业网点（153 条，16 页，约 20s）
node scripts/probe-ccb.mjs --http --district 440300 --all-pages \
  --agg-out scripts/probe-out/ccb-shenzhen.json

# 单区
node scripts/probe-ccb.mjs --http --district 福田区 --all-pages
```

要点：

- 无需浏览器、无需 Cookie、无需 `100119`；一条 `fetch` 即可。
- 行政区划也可纯 HTTP 拿：`TXCODE=NAREA2&type=1/2/3`，返回
  `{ totalnum, arealist:[{areacode, NET_NAME}, ...] }`（末尾有一个空对象，遍历时跳过）。
- 请求间隔脚本强制 ≥ 1.1s，串行。
- UA 用「浏览器前缀 + 项目标识」，兼顾可访问性与可追溯。

## 6. 合规与限制

- `robots.txt`：`https://wealth.ccb.com/robots.txt`、`http://ebank3.ccb.cn/robots.txt`、`https://www.ccb.com/robots.txt` 均为 **404**（未声明禁止），按项目规范可低频访问。
- 数据为建行官网公开的网点信息，不含个人信息；电话是网点对外固话。
- 建议入库时保留 `source=ccb`、抓取日期、原始 `PK_ID`，展示时注明“数据来自中国建设银行官网，以网点实际为准”。
- 限制：接口无版本号、参数语义（如 `Cur_StCd`）未公开，站点改版可能失效；采集端必须校验 `SUCCESS === "true"` 且能 `JSON.parse`，失败即停。
- ATM 类型在福田返回 0 条，`Enqr_MtdCd=3` 的实际覆盖范围未进一步验证。

## 7. 复现脚本与产物

| 文件                                        | 说明                                                  |
| ------------------------------------------- | ----------------------------------------------------- |
| `scripts/probe-ccb.mjs`                     | Playwright 交互模式（默认）+ 纯 HTTP 模式（`--http`） |
| `data/ccb-probe/xhr-log.json`               | 全程 XHR：URL / method / postData / 响应前 800 字符   |
| `data/ccb-probe/nzx013-*.json`              | 列表接口完整响应                                      |
| `data/ccb-probe/report.json`                | UI 模式结论（字段、分页、坐标、样本）                 |
| `data/ccb-probe/report-http.json`           | HTTP 模式结论（最后运行的是深圳全量 16 页）           |
| `data/ccb-probe/branches-440304.json`       | 福田 40 条归一化结果（HTTP 全量）                     |
| `data/ccb-probe/branches-440300.json`       | 深圳 153 条归一化结果（HTTP 全量）                    |
| `data/ccb-probe/branches-440304-ui-p1.json` | UI 模式首页 10 条样本                                 |
| `scripts/probe-out/ccb-shenzhen.json`       | 深圳 153 条聚合结果（与其他银行 probe-out 同构）      |
| `data/ccb-probe/shot-result.png`            | 交互完成截图（广东/深圳/福田/40 条）                  |
