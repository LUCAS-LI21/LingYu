// 深圳农商银行（深圳农村商业银行）深圳网点接口探测 —— 可复现脚本
//
// 结论（详见 scripts/probe-out/szrcb-probe.json）：
//   列表接口 POST/GET https://www.4001961200.com/api/CMS/BranchQryList.do
//     ?ClientType=Client&DeptType=<branch|atm|fortune|pmf>&Type=1&City=深圳市[&Name=关键字]
//     必须带 Accept-Language: zh-CN（缺省会 404，后端按 locale 找 JSP）；一次返回全量、无分页。
//     字段：type,name,address,phonenum,time,lat,lon,ext1,deptid,score,comments,allScore,Lat,Lng,distance
//     注意：小写的 lat 存的是「经度」、lon 存的是「纬度」（页面 position:[branch.lat,branch.lon] 直接喂高德），
//           值是 GCJ-02 高德坐标；大写的 Lat/Lng 是 BD-09 百度坐标（语义正确：Lat=纬、Lng=经）。
//           两者经 bd09↔gcj02 换算残差 ≈0.05×1e-5 度，即同一地点的两套坐标。
//   城市/省份列表 POST https://www.4001961200.com/api/CMS/CategoryListQry.do?ClientType=Client&Type=省|市[&ParentId=]
//   页面没有「区」级下拉（只有 省→市 两级），区只出现在 address 文本里，本脚本按行政区名本地切分。
//   robots.txt：不存在（302 → /404），无 Disallow / Crawl-delay。
//   深圳网点数：营业网点 199 + 自助银行 237 + 财富中心 5 + 小企业中心 4 = 445（全部落在深圳经纬度范围内）。
//
// 用法：
//   node scripts/probe-szrcb.mjs            # 完整流程：Playwright 交互 + 无 Cookie 复跑
//   node scripts/probe-szrcb.mjs --no-browser   # 只跑 curl 复跑（跳过 Playwright）
//
// 纪律：所有出站请求串行，间隔 ≥ 1100 ms；只访问 www.4001961200.com 一个域。
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { curlText } from './lib/http.mjs'

const HOST = 'www.4001961200.com'
const ORIGIN = `https://${HOST}`
const MAP_PAGE = `${ORIGIN}/index.php/map`
const API = `${ORIGIN}/api/CMS/`
const OUT = 'scripts/probe-out'
const GAP = 1150 // 限速：≥1.1 秒/请求

mkdirSync(OUT, { recursive: true })

// ---------- 限速器：所有 Node 侧请求串行，保证相邻两次出站间隔 ≥ GAP ----------
let lastAt = 0
async function gate() {
  const wait = GAP - (Date.now() - lastAt)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastAt = Date.now()
}

const sha = (s) =>
  createHash('sha256')
    .update(s.replace(/^\uFEFF/, '').replace(/\s+/g, ''))
    .digest('hex')
// 服务端返回顺序可能抖动，比对用「按 deptid 排序后的规范哈希」
function canonHash(text) {
  try {
    const j = JSON.parse(text.replace(/^\uFEFF/, ''))
    const list = (j.List || [])
      .map((b) => [b.deptid, b.name, b.lat, b.lon, b.Lat, b.Lng].join('|'))
      .sort()
    return sha(JSON.stringify(list))
  } catch {
    return 'unparsable'
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 该老站点 Node fetch 可能 TLS 失败，统一走系统 curl 兜底
async function apiGet(path, { method = 'POST' } = {}) {
  await gate()
  const url = API + path
  const text = curlText(url, {
    method,
    headers: {
      'Accept-Language': 'zh-CN',
      Referer: MAP_PAGE,
      'Content-Type': 'application/json',
      ...(method === 'POST' ? { 'Content-Length': '0' } : {}),
    },
    body: method === 'POST' ? '' : undefined,
  })
  return { url, text, json: JSON.parse(text.replace(/^\uFEFF/, '')) }
}

// ---------- 1. robots.txt ----------
async function probeRobots() {
  await gate()
  const body = curlText(`${ORIGIN}/robots.txt`, { method: 'GET' })
  // curl -s 不跟重定向，拿不到状态码；用页面重定向目标 + 正文判断
  const isShell = /302 Found|404 Not Found|<html/i.test(body)
  return {
    url: `${ORIGIN}/robots.txt`,
    reachable: !isShell,
    http: '302 → /404（应用层无 robots.txt）',
    body: isShell ? '' : body,
    note: isShell
      ? 'robots.txt 不存在：nginx 302 到 /404（/404 本身返回 HTTP 200 软 404）。无 Disallow / Crawl-delay 约束。'
      : 'robots.txt 存在，内容见 body。',
  }
}

// ---------- 2. Playwright：交互 + 全量 XHR 记录 ----------
async function launch() {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' })
  } catch {
    return await chromium.launch({ headless: true }) // 需 playwright install chromium
  }
}

async function probeWithBrowser() {
  const browser = await launch()
  const ctx = await browser.newContext({ locale: 'zh-CN', ignoreHTTPSErrors: true })
  const page = await ctx.newPage()
  const xhr = []
  const pending = []

  page.on('response', (res) => {
    const req = res.request()
    const type = req.resourceType()
    if (type !== 'xhr' && type !== 'fetch') return
    pending.push(
      (async () => {
        let head = ''
        let canon = null
        try {
          const t = await res.text()
          head = t.slice(0, 600)
          res.__len = t.length
          res.__sha = sha(t)
          if (/\/api\/CMS\//.test(res.url())) canon = canonHash(t)
        } catch {
          head = '<binary|unreadable>'
        }
        xhr.push({
          method: req.method(),
          url: res.url(),
          postData: req.postData(),
          status: res.status(),
          respLen: res.__len ?? null,
          respSha256: res.__sha ?? null,
          respCanon: canon,
          head600: head,
        })
      })().catch(() => {}),
    )
  })

  await page.goto(MAP_PAGE, { waitUntil: 'networkidle', timeout: 90000 })
  await sleep(1500)
  const steps = []

  // 省 → 市
  const selects = await page.$$('select[name="branchCityId"]')
  steps.push({
    step: 'load',
    selects: await page.$$eval('select', (els) =>
      els.map((s) => [...s.options].map((o) => o.text).join('|')),
    ),
  })

  await page.selectOption('select[name="branchCityId"] >> nth=0', '0') // 广东省
  await sleep(GAP + 900)
  steps.push({
    step: 'province=广东省',
    selects: await page.$$eval('select', (els) =>
      els.map((s) => [...s.options].map((o) => o.text).join('|')),
    ),
  })

  const citySel = (await page.$$('select[name="branchCityId"]'))[1]
  await citySel.selectOption('深圳市')
  await sleep(GAP + 1800)
  steps.push({
    step: 'city=深圳市',
    branchCount: await page.$$eval('.branch-info-title', (e) => e.length),
  })

  // 「区」级探测：页面只有两个 select，没有区下拉
  const third = (await page.$$('select[name="branchCityId"]')).length
  steps.push({
    step: '探测区级下拉',
    selectCount: third,
    note: third < 3 ? '无区级下拉，仅 省→市 两级' : '存在第三级',
  })

  // 四个部门类型 tab（营业网点/自助银行/财富中心/小企业中心）
  const tabs = ['营业网点', '自助银行', '财富中心', '小企业中心']
  for (const tab of tabs) {
    try {
      await page.click(`.common-tabs a:has-text("${tab}")`, { timeout: 8000 })
      await sleep(GAP + 1600)
      steps.push({
        step: `tab=${tab}`,
        branchCount: await page.$$eval('.branch-info-title', (e) => e.length),
      })
    } catch (e) {
      steps.push({ step: `tab=${tab}`, error: String(e.message).split('\n')[0].slice(0, 120) })
    }
  }

  // 关键字搜索（无「区」下拉时，用区名做名称检索，是站内唯一的区级线索）
  try {
    await page.click('.common-tabs a:has-text("营业网点")')
    await sleep(GAP + 1200)
    await page.fill('#branchName', '南山')
    await page.click('button[type="submit"].btn-common-sm')
    await sleep(GAP + 1600)
    steps.push({
      step: 'keyword=南山',
      branchCount: await page.$$eval('.branch-info-title', (e) => e.length),
    })
  } catch (e) {
    steps.push({ step: 'keyword=南山', error: String(e.message).split('\n')[0].slice(0, 120) })
  }

  await page.screenshot({ path: `${OUT}/szrcb-map.png` }).catch(() => {})
  await Promise.all(pending)
  await browser.close()
  return { xhr, steps }
}

// ---------- 3. 无 Cookie 复跑：与浏览器结果逐字节比对 ----------
async function replayNoCookie(browserCanon) {
  const rows = []
  for (const [label, qs] of [
    [
      'branch',
      'BranchQryList.do?ClientType=Client&DeptType=branch&Type=1&City=' +
        encodeURIComponent('深圳市'),
    ],
    [
      'atm',
      'BranchQryList.do?ClientType=Client&DeptType=atm&Type=1&City=' + encodeURIComponent('深圳市'),
    ],
    [
      'fortune',
      'BranchQryList.do?ClientType=Client&DeptType=fortune&Type=1&City=' +
        encodeURIComponent('深圳市'),
    ],
    [
      'pmf',
      'BranchQryList.do?ClientType=Client&DeptType=pmf&Type=1&City=' + encodeURIComponent('深圳市'),
    ],
  ]) {
    const post = await apiGet(qs, { method: 'POST' })
    const get = await apiGet(qs, { method: 'GET' })
    const cPost = canonHash(post.text)
    const cGet = canonHash(get.text)
    rows.push({
      label,
      url: qs,
      post: { len: post.text.length, canon: cPost, n: (post.json.List || []).length },
      get: { len: get.text.length, canon: cGet, n: (get.json.List || []).length },
      getEqPost: cPost === cGet,
      browserMatches: browserCanon.size ? browserCanon.has(cPost) : null,
    })
  }
  return rows
}

// ---------- 4. 解析 / 归档 ----------
const DISTRICTS = [
  '深汕特别合作区',
  '大鹏新区',
  '光明区',
  '坪山区',
  '龙华区',
  '龙岗区',
  '宝安区',
  '盐田区',
  '南山区',
  '罗湖区',
  '福田区',
]
const ALIAS = { 光明新区: '光明区', 龙华新区: '龙华区', 坪山新区: '坪山区' }
function districtOf(addr) {
  const a = String(addr)
  const m = a.match(/深圳市(.{2,7}?(?:区|新区|合作区))/)
  const hit = m
    ? DISTRICTS.find((d) => m[1].startsWith(d)) || m[1]
    : DISTRICTS.find((d) => a.includes(d))
  if (!hit) return '未标注'
  return ALIAS[hit] || hit
}
function normalize(b, deptType) {
  const lng = Number(b.lat) // 小写 lat 实为经度（GCJ-02 / 高德）
  const lat = Number(b.lon) // 小写 lon 实为纬度（GCJ-02 / 高德）
  const bdLng = Number(b.Lng) // 大写 Lng = 经度（BD-09 / 百度）
  const bdLat = Number(b.Lat) // 大写 Lat = 纬度（BD-09 / 百度）
  return {
    deptType,
    type: b.type,
    name: String(b.name).trim(),
    address: String(b.address).trim(),
    district: districtOf(b.address),
    phone: String(b.phonenum).trim(),
    hours: String(b.time).trim(),
    lng, // 页面实际绘点用的坐标：GCJ-02（高德），可直接进高德/腾讯地图
    lat,
    bd09Lng: bdLng, // 大写字段：BD-09（百度），可直接进百度地图
    bd09Lat: bdLat,
    deptid: b.deptid,
    raw: b,
  }
}

// ---------- 坐标系验证（离线，不发请求）：小写=GCJ-02、大写=BD-09 ----------
const X_PI = (Math.PI * 3000) / 180
function bd09ToGcj02(lng, lat) {
  const x = lng - 0.0065
  const y = lat - 0.006
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI)
  const t = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI)
  return [z * Math.cos(t), z * Math.sin(t)]
}
function gcj02ToBd09(lng, lat) {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI)
  const t = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI)
  return [z * Math.cos(t) + 0.0065, z * Math.sin(t) + 0.006]
}
function verifyDatum(rows) {
  const d1 = []
  const d2 = []
  for (const b of rows) {
    const [gl, ga] = bd09ToGcj02(b.bd09Lng, b.bd09Lat)
    d1.push(Math.hypot((gl - b.lng) * 1e5, (ga - b.lat) * 1e5))
    const [bl, ba] = gcj02ToBd09(b.lng, b.lat)
    d2.push(Math.hypot((bl - b.bd09Lng) * 1e5, (ba - b.bd09Lat) * 1e5))
  }
  const st = (a) => ({
    mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3),
    max: +Math.max(...a).toFixed(3),
  })
  return {
    unit: '1e-5 度 ≈ 1.1 m',
    bd09ToGcj02_vs_lowercase: st(d1),
    gcj02ToBd09_vs_uppercase: st(d2),
    conclusion:
      '大写 Lat/Lng 依 BD-09→GCJ-02 换算后与小写 lat/lon 平均差 0.05×1e-5 度（≈5 cm），反向换算残差 0；' +
      '故小写 lat/lon = GCJ-02（高德），大写 Lat/Lng = BD-09（百度），二者是同一点的两套坐标，非误差。',
  }
}

// ---------- main ----------
const noBrowser = process.argv.includes('--no-browser')
const robots = await probeRobots()
console.log('robots:', robots.note)

let browserPart = { xhr: [], steps: [], skipped: noBrowser }
let browserCanon = new Set()
if (!noBrowser) {
  try {
    browserPart = await probeWithBrowser()
    for (const r of browserPart.xhr) if (r.respCanon) browserCanon.add(r.respCanon)
  } catch (e) {
    browserPart.error = String(e.message).split('\n')[0]
    console.log('Playwright 失败：', browserPart.error)
  }
}
if (!noBrowser) writeFileSync(`${OUT}/szrcb-xhr.json`, JSON.stringify(browserPart.xhr, null, 2))
console.log(
  `\nXHR 记录 ${browserPart.xhr.length} 条${noBrowser ? '（--no-browser，跳过，不覆盖已有 xhr.json）' : ` → ${OUT}/szrcb-xhr.json`}`,
)
for (const r of browserPart.xhr) {
  if (!/\/api\//.test(r.url)) continue
  console.log(
    `  ${r.status} ${r.method} ${r.url.replace(ORIGIN, '')}  postData=${r.postData ?? 'null'}  len=${r.respLen}`,
  )
}

const replay = await replayNoCookie(browserCanon)

// 合并四个部门类型，得到深圳全量
const all = []
const perType = {}
const perTypeOutOfCity = {}
for (const [label] of [['branch'], ['atm'], ['fortune'], ['pmf']]) {
  const qs =
    `BranchQryList.do?ClientType=Client&DeptType=${label}&Type=1&City=` +
    encodeURIComponent('深圳市')
  const { json } = await apiGet(qs)
  const list = json.List || []
  perType[label] = { n: list.length, types: [...new Set(list.map((b) => b.type))] }
  perTypeOutOfCity[label] = list.filter((b) => !String(b.address).includes('深圳市')).length
  for (const b of list) all.push(normalize(b, label))
}
writeFileSync(`${OUT}/szrcb-shenzhen.json`, JSON.stringify(all, null, 2))

const byDistrict = {}
for (const b of all.filter((x) => x.deptType === 'branch'))
  byDistrict[b.district] = (byDistrict[b.district] || 0) + 1
const badCoord = all.filter((b) => !(b.lng > 113 && b.lng < 115.5 && b.lat > 22 && b.lat < 23.5))

const report = {
  generatedAt: new Date().toISOString(),
  host: HOST,
  mapPage: MAP_PAGE,
  robots,
  districtSelect: '站点无「区」级下拉，只有 省→市 两级；区只能从 address 文本切分',
  steps: browserPart.steps,
  xhrCount: browserPart.xhr.length,
  api: {
    list: {
      url: `${API}BranchQryList.do`,
      method: 'GET|POST（POST 需 Content-Length: 0）',
      params: {
        ClientType: 'Client（固定）',
        DeptType: 'branch=营业网点 / atm=自助银行 / fortune=财富中心 / pmf=小企业中心',
        Type: '1=按 City 过滤；2 或 3 = 忽略 City 返回广东+广西全部（223 条）',
        City: '城市中文名，深圳市（写「深圳」也可）',
        Name: '可选，按网点名模糊匹配，如 南山',
      },
      requiredHeaders:
        'Accept-Language: zh-CN（缺失 → 404，后端按 locale 找 mclient/<locale>/BranchQryJsp）',
      pagination:
        '无。一次返回全量，深圳营业网点 199 条 / 94 KB；PageNo、PageIndex、pageNum、pageSize 均被忽略',
      total: perType,
      coords:
        '有，且有两套：小写 lat/lon（注意名称颠倒：lat=经度、lon=纬度）= GCJ-02 高德坐标，页面 position:[branch.lat,branch.lon] 直接绘点；' +
        '大写 Lat/Lng = BD-09 百度坐标（语义正确：Lat=纬、Lng=经）。已用 bd09↔gcj02 双向换算验证：残差 ≈0.05×1e-5 度，属同一地点两套坐标。',
    },
    cityList: {
      url: `${API}CategoryListQry.do`,
      method: 'GET|POST',
      params: {
        ClientType: 'Client',
        Type: '省 | 市（区、街道未实现，Type=区 返回空 List）',
        ParentId: '上级 Id，省=0，市=2',
      },
      note: '省：广东省 Id=0、广西 Id=36；广东省下只有深圳市 Id=2',
    },
  },
  cookieIndependent: replay.every((r) => r.getEqPost && r.browserMatches !== false),
  replay,
  datum: verifyDatum(all),
  counts: {
    szBranch: perType.branch.n,
    szAtm: perType.atm.n,
    szFortune: perType.fortune.n,
    szPmf: perType.pmf.n,
    szTotalAllDeptTypes: perType.branch.n + perType.atm.n + perType.fortune.n + perType.pmf.n,
    byDistrictBranchOnly: byDistrict,
    addrWithoutCityName: perTypeOutOfCity,
    coordOutOfShenzhenBbox: badCoord.length,
  },
}
writeFileSync(`${OUT}/szrcb-probe.json`, JSON.stringify(report, null, 2))

console.log('\n=== 复跑（无 Cookie，curl） ===')
for (const r of replay)
  console.log(
    `  ${r.label.padEnd(8)} POST n=${r.post.n} GET n=${r.get.n} GET≡POST=${r.getEqPost} 浏览器同哈希=${r.browserMatches}`,
  )
console.log('\n=== 统计 ===')
console.log(JSON.stringify(report.counts, null, 1))
console.log(`\n输出：${OUT}/szrcb-probe.json, szrcb-shenzhen.json, szrcb-xhr.json`)
console.log('样例：', JSON.stringify(all[0], null, 1))
