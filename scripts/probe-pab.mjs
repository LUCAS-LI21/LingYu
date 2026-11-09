// 平安银行深圳网点探针（Playwright + 独立复跑）
//
// 入口链路（全部 pingan 域）：
//   https://bank.pingan.com/sitemap.shtml →「服务网点」
//   → https://b.pingan.com.cn/papb/ebank/pc-map/geren/fuwuwangdian/map.shtml
// 页面是 jQuery 老站，取数不是 XHR，而是 dataType:'jsonp' + jsonpCallback:'callback'：
//   城市列表 GET https://rsb.pingan.com.cn/mkt/iclient-core/cust/ams-rbms-core/app/getBankShowCityListJsonp?type=YYWD
//   网点列表 GET https://rsb.pingan.com.cn/mkt/iclient-core/cust/ams-rbms-core/app/getBankShowListJsonp
//                ?source=WEB&cityId=&srhKeyword=&city=深圳&type=YYWD
// 页面无省级下拉（源码里被注释），只能按城市名选；本脚本在「选择城市」输入框里检索并点选深圳。
//
// 合规：
//   - 只请求 *.pingan.com / *.pingan.com.cn；Playwright 拦截并 abort 其余第三方请求
//     （页面原本要加载百度地图 JS，这里用最小 BMap stub 顶替，仅为让页面交互跑通，不伪造数据）
//   - 主动请求间隔 >= 1100ms
//   - 只读取公开页面，无登录、无 Cookie 依赖
// 坐标：接口 lat/lng 为百度 BD-09（页面直接用 BMap.Point 渲染）；脚本末尾用 OSM(WGS-84)
//       平安银行点做最近邻比对来验证（换算成 BD-09→WGS-84 后平均距离显著更小）。
// 用法：node scripts/probe-pab.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { curlText } from './lib/http.mjs'
import { gcj02ToWgs84 } from './lib/coord.mjs'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const PAGE_URL = 'https://b.pingan.com.cn/papb/ebank/pc-map/geren/fuwuwangdian/map.shtml'
const API_BRANCH =
  'https://rsb.pingan.com.cn/mkt/iclient-core/cust/ams-rbms-core/app/getBankShowListJsonp'
const API_CITY =
  'https://rsb.pingan.com.cn/mkt/iclient-core/cust/ams-rbms-core/app/getBankShowCityListJsonp'
const OUT_DIR = path.resolve('scripts/probe-out')
const STATE_FILE = path.join(OUT_DIR, 'pab-shenzhen.json')
const PINGAN_RE = /(^|\.)pingan\.com(\.cn)?$/i

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findChrome() {
  try {
    const p = chromium.executablePath()
    if (p && fs.existsSync(p)) return p
  } catch {}
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
  if (!fs.existsSync(base)) return undefined
  for (const d of fs
    .readdirSync(base)
    .filter((x) => /^chromium-\d+$/.test(x))
    .sort()
    .reverse()) {
    const p = path.join(base, d, 'chrome-win64', 'chrome.exe')
    if (fs.existsSync(p)) return p
  }
  return undefined
}

function parseJsonp(text) {
  const t = text.trim()
  const i = t.indexOf('(')
  if (i < 0) throw new Error('不是 JSONP：' + t.slice(0, 80))
  return JSON.parse(t.slice(i + 1, t.lastIndexOf(')')))
}

/** 独立复跑：Node fetch 优先，SSL 重协商报错时退回系统 curl；全程不带 Cookie */
async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } })
    return { via: 'node-fetch', status: res.status, text: await res.text() }
  } catch (e) {
    const code = e?.cause?.code || e?.code || ''
    if (!/SSL|LEGACY|UNABLE_TO|CERT/i.test(code + e.message)) throw e
    console.log(`[verify] node fetch 失败（${code || e.message}），改用 curl 兜底`)
    const text = curlText(url, { headers: { 'User-Agent': UA } })
    return { via: 'curl(fallback)', status: 'n/a', text }
  }
}

const robotsInfo = []
async function checkRobots(host) {
  const url = host + '/robots.txt'
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/plain' } })
    const text = await res.text()
    const isRobots = /^\s*(User-agent|Sitemap|Disallow|Allow)/im.test(text) && !/<html/i.test(text)
    robotsInfo.push({ host, url, status: res.status, isRobots, body: text.slice(0, 600) })
    console.log(
      `[robots] ${url} -> ${res.status} ${isRobots ? 'robots 文本' : '非 robots（软 404/HTML）'}`,
    )
  } catch (e) {
    robotsInfo.push({ host, url, status: 'ERR', error: e.message })
    console.log(`[robots] ${url} -> ERR ${e.message}`)
  }
  await sleep(1100)
}

fs.mkdirSync(OUT_DIR, { recursive: true })

// ---------- 0) robots ----------
for (const host of [
  'https://bank.pingan.com',
  'https://b.pingan.com.cn',
  'https://rsb.pingan.com.cn',
]) {
  await checkRobots(host)
}

// ---------- 1) Playwright 打开网点页并交互 ----------
const browser = await chromium.launch({
  headless: true,
  executablePath: findChrome(),
  args: ['--disable-blink-features=AutomationControlled'],
})
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'zh-CN',
  userAgent: UA,
})

// 只放行 pingan 域；其余（含百度地图 JS）全部 abort
const blocked = []
await ctx.route('**/*', async (route) => {
  const u = route.request().url()
  if (!/^https?:/i.test(u)) return route.continue()
  let host = ''
  try {
    host = new URL(u).hostname
  } catch {}
  if (PINGAN_RE.test(host)) return route.continue()
  blocked.push(u)
  return route.abort()
})

// 最小 BMap stub：页面渲染依赖百度地图，但为了“只访问 pingan 域”不加载它
await ctx.addInitScript(() => {
  const noop = () => {}
  class Point {
    constructor(lng, lat) {
      this.lng = lng
      this.lat = lat
    }
  }
  class Size {
    constructor(w, h) {
      this.width = w
      this.height = h
    }
  }
  class Icon {
    constructor(url, size, opts) {
      Object.assign(this, { url, size }, opts || {})
    }
  }
  class Marker {
    constructor(point, opts) {
      Object.assign(this, { point }, opts || {})
      this._handlers = {}
    }
    setTitle() {}
    setIcon() {}
    setPosition() {}
    setMap() {}
    addEventListener(type, fn) {
      ;(this._handlers[type] ||= []).push(fn)
    }
    removeEventListener() {}
  }
  class Map {
    constructor(id) {
      this.id = id
      this._overlays = []
    }
    centerAndZoom() {}
    setMinZoom() {}
    setMaxZoom() {}
    setZoom() {}
    setViewport() {}
    enableScrollWheelZoom() {}
    enableContinuousZoom() {}
    addControl() {}
    addOverlay(o) {
      this._overlays.push(o)
    }
    removeOverlay() {}
    clearOverlays() {
      this._overlays = []
    }
    reset() {}
    panTo() {}
    openInfoWindow() {}
    animate() {}
    getZoom() {
      return 12
    }
  }
  class Polyline {
    constructor(path, opts) {
      Object.assign(this, { path }, opts || {})
    }
  }
  class Empty {
    constructor() {}
    search() {}
  }
  window.BMap = {
    Point,
    Size,
    Icon,
    Marker,
    Map,
    Polyline,
    InfoWindow: Empty,
    LocalSearch: Empty,
    DrivingRoute: Empty,
    TransitRoute: Empty,
    Symbol: Empty,
    ScaleControl: Empty,
    OverviewMapControl: Empty,
    NavigationControl: Empty,
  }
  // eslint-disable-next-line no-console
  console.log('[stub] BMap injected')
})

const page = await ctx.newPage()
const reqLog = []
const bodies = new Map()

page.on('request', (req) => {
  let host = ''
  try {
    host = new URL(req.url()).hostname
  } catch {}
  if (!PINGAN_RE.test(host)) return
  const type = req.resourceType()
  if (!['xhr', 'fetch', 'script'].includes(type)) return
  if (/\.js(\?|$)/i.test(req.url())) return // 静态脚本不算数据请求
  reqLog.push({
    t: new Date().toISOString(),
    method: req.method(),
    resourceType: type,
    url: req.url(),
    postData: req.postData() || null,
    status: null,
    respHead600: null,
  })
})

page.on('response', async (res) => {
  const req = res.request()
  const url = res.url()
  if (!PINGAN_RE.test(new URL(url).hostname)) return
  const entry = reqLog.find((x) => x.url === url && x.status === null)
  if (!entry) return
  entry.status = res.status()
  try {
    const text = await res.text()
    entry.respHead600 = text.slice(0, 600)
    if (/getBankShowListJsonp|getBankShowCityListJsonp/.test(url)) bodies.set(url, text)
  } catch (e) {
    entry.respHead600 = `<读取失败: ${e.message}>`
  }
  console.log(`[resp] ${entry.method} ${entry.status} ${url}`)
})

console.log(`\n[nav] 打开 ${PAGE_URL}`)
await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(2500)
await page.screenshot({ path: path.join(OUT_DIR, 'pab-01-initial.png'), fullPage: false })

// 交互：点开“选择城市”下拉 → 输入深圳 → 点选深圳
const cityInput = page.locator('#j_search .sel-box .sel-name input').first()
console.log('[ui] 点击城市下拉并输入「深圳」')
await cityInput.click()
await page.waitForTimeout(300)
await cityInput.fill('深圳')
await page.waitForTimeout(800)
await page.screenshot({ path: path.join(OUT_DIR, 'pab-02-city-dropdown.png'), fullPage: false })

const option = page.locator('#j_search .sel-box .sel-list a').filter({ hasText: '深圳' }).first()
console.log(`[ui] 下拉项可见=${await option.isVisible()}，点选「深圳」`)
await option.click()
await page.waitForTimeout(3000)
await page.screenshot({ path: path.join(OUT_DIR, 'pab-03-after-city.png'), fullPage: false })

// 页面 DOM 侧证据
const dom = await page.evaluate(() => {
  const dls = [...document.querySelectorAll('#j_side .side-inner > dl.bank')]
  const items = dls.map((dl) => ({
    name: (dl.querySelector('dt')?.textContent || '').trim(),
    addr: (dl.getAttribute('adr') || '').trim(),
    lat: dl.getAttribute('lat'),
    lng: dl.getAttribute('lng'),
  }))
  return {
    city: (document.querySelector('#j_side .city-name')?.textContent || '').trim(),
    rendered: items.length,
    items,
    pagination: (document.querySelector('#j_side .pagination')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim(),
    sideText: (document.querySelector('#j_side .side-inner')?.textContent || '')
      .replace(/\s+/g, ' ')
      .slice(0, 200),
  }
})
console.log(
  `[dom] 城市=${dom.city} 当前页渲染=${dom.rendered} 条 分页=${dom.pagination || '(无)'} 样例=${JSON.stringify(dom.items[0] || null)}`,
)

// 解析页面实际收到的网点 JSONP
const branchUrls = [...bodies.keys()].filter((u) => u.includes('getBankShowListJsonp'))
const cityUrls = [...bodies.keys()].filter((u) => u.includes('getBankShowCityListJsonp'))
let apiItems = []
let apiMeta = null
if (branchUrls.length) {
  const json = parseJsonp(bodies.get(branchUrls[0]))
  apiItems = json.data || []
  apiMeta = {
    url: branchUrls[0],
    responseCode: json.responseCode,
    responseMsg: json.responseMsg,
    count: apiItems.length,
    keys: Object.keys(apiItems[0] || {}),
  }
  console.log(`[api] ${branchUrls[0]}`)
  console.log(
    `[api] responseCode=${json.responseCode} 条数=${apiItems.length} 字段=${apiMeta.keys.join(',')}`,
  )
} else {
  console.log('[api] 未捕获到 getBankShowListJsonp 响应')
}
const cityMeta = cityUrls.length
  ? { url: cityUrls[0], count: (parseJsonp(bodies.get(cityUrls[0])).data || []).length }
  : null

const norm = apiItems.map((x) => ({
  id: x.id,
  name: x.name,
  address: x.address,
  phones: x.tles || [],
  workHours: {
    shopHour: x.shopHour || '',
    personal: x.workingTime || '',
    corporate: x.corporateWorkingTime || '',
  },
  lat: x.lat,
  lng: x.lng,
  city: x.city,
}))

// ---------- 1.5) 坐标系判定：与 OSM(WGS-84) 的平安银行点做最近邻比对 ----------
function bd09ToWgs84(lng, lat) {
  const x = lng - 0.0065
  const y = lat - 0.006
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * Math.PI)
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI)
  return gcj02ToWgs84(z * Math.cos(theta), z * Math.sin(theta))
}
function haversine([lng1, lat1], [lng2, lat2]) {
  const R = 6371000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
let coordCheck = null
const osmFile = path.resolve('public/data/pois.json')
if (fs.existsSync(osmFile) && norm.length) {
  const osm = JSON.parse(fs.readFileSync(osmFile, 'utf8')).pois.filter(
    (p) => p.brand === '平安银行' && Number.isFinite(p.lng) && Number.isFinite(p.lat),
  )
  const meanNearest = (conv) => {
    let sum = 0
    for (const o of osm) {
      let best = Infinity
      for (const it of norm) {
        const d = haversine([o.lng, o.lat], conv(it))
        if (d < best) best = d
      }
      sum += best
    }
    return Math.round(sum / osm.length)
  }
  const raw = meanNearest((it) => [+it.lng, +it.lat])
  const bd = meanNearest((it) => bd09ToWgs84(+it.lng, +it.lat))
  coordCheck = {
    reference: 'public/data/pois.json（OSM，WGS-84）平安银行点',
    samples: osm.length,
    meanNearestMeters: { treatAsWgs84: raw, convertBd09ToWgs84: bd },
    verdict: bd < raw ? 'BD-09' : '非 BD-09（需复核）',
  }
  console.log(
    `[coord] 与 OSM 最近邻平均距离：直接当 WGS-84=${raw}m，BD-09→WGS-84 换算=${bd}m → ${coordCheck.verdict}`,
  )
}

// ---------- 2) 独立复跑（无浏览器、无 Cookie、带 Referer 与否都试） ----------
console.log('\n[verify] 独立复跑（node fetch，无 Cookie、无 Referer）')
await sleep(1100)
const verifyUrl = `${API_BRANCH}?source=WEB&cityId=&srhKeyword=&city=${encodeURIComponent('深圳')}&type=YYWD&callback=callback`
const v = await fetchText(verifyUrl)
let vJson
try {
  vJson = parseJsonp(v.text)
} catch (e) {
  vJson = null
}
const vItems = vJson?.data || []
console.log(
  `[verify] via=${v.via} status=${v.status} responseCode=${vJson?.responseCode} 条数=${vItems.length}`,
)
const vHasCoord = vItems.filter((x) => x.lat && x.lng).length
const same =
  vItems.length === apiItems.length &&
  vItems.every(
    (x, i) => x.name === apiItems[i].name && x.lat === apiItems[i].lat && x.lng === apiItems[i].lng,
  )
console.log(`[verify] 与浏览器结果一致=${same} 含经纬度=${vHasCoord}/${vItems.length}`)

// 城市列表接口单独复跑（1.1s 间隔）
await sleep(1100)
const vc = await fetchText(`${API_CITY}?type=YYWD&callback=callback`)
const vcJson = parseJsonp(vc.text)
const cityHit = (vcJson.data || []).some((c) => c.city === '深圳')
console.log(
  `[verify] 城市列表 via=${vc.via} 城市数=${(vcJson.data || []).length} 含深圳=${cityHit}`,
)

// ---------- 3) 落盘 ----------
const result = {
  bank: '平安银行',
  city: '深圳',
  generatedAt: new Date().toISOString(),
  page: { url: PAGE_URL, title: await page.title() },
  robots: robotsInfo,
  requestLog: reqLog,
  blockedThirdParty: [...new Set(blocked.map((u) => new URL(u).hostname))],
  apis: {
    cityList: cityMeta,
    branchList: apiMeta,
  },
  ui: dom,
  coordinateCheck: coordCheck,
  hasCoordinate: vItems.every((x) => x.lat && x.lng),
  count: norm.length,
  independentVerify: {
    via: v.via,
    status: v.status,
    count: vItems.length,
    consistentWithBrowser: same,
    cityListHasShenzhen: cityHit,
    cookies: 'none',
    referer: 'none',
  },
  items: norm,
}
fs.writeFileSync(STATE_FILE, JSON.stringify(result, null, 2))
console.log(
  `\n[结果] 深圳网点 ${norm.length} 个，含经纬度 ${vHasCoord} 个；XHR/JSONP 记录 ${reqLog.length} 条 -> ${STATE_FILE}`,
)
console.log('[robots]', robotsInfo.map((r) => `${r.host}=${r.status}`).join(' '))
console.log('[blocked]', result.blockedThirdParty.join(', ') || '无')

await browser.close()
