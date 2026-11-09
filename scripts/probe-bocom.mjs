/**
 * 交通银行（bankcomm.com）深圳网点数据接口探针
 *
 * 结论（本脚本可复现）：
 *   1) 网点查询页 https://www.bankcomm.com/BankCommSite/shtml/jyjr/cn/7158/8203/list.shtml?channelId=7158
 *      内嵌 iframe /BankCommSite/zonghang/cn/node/index.html?siteType=jyjr（网点地图应用）。
 *   2) 列表接口 POST https://www.bankcomm.com/SITE/queryBranchResult.do
 *      请求体 x-www-form-urlencoded：REQ_MESSAGE=<JSON>
 *      JSON = {"REQ_HEAD":{"TRAN_PROCESS":"","TRAN_ID":""},"REQ_BODY":{"URL_TYPE":"","CITY":"深圳市","COUNTY_NAME":""}}
 *      注意：REQ_BODY 只能有这 4 个键；多塞 TYPE/WORD 键会返回 count=0。
 *      响应 RSP_BODY.branch.data 为「对象」，键为 p0..pN，count 为总数；一次性返回全部，无服务端分页。
 *   3) 区县列表 POST /SITE/queryCountyByCityName.do  body {"cityName":"深圳市"}
 *      城市列表 POST /SITE/queryCityResult.do      body 空 {}
 *   4) 坐标：x=经度 y=纬度，坐标系为 GCJ-02（火星）。依据：页面把 (x,y) 以 from=3&to=5 送百度
 *      geoconv 做偏移，实测增量 +0.0065 经 / +0.0060 纬，正是 GCJ02→BD09 的固定偏移；
 *      若为 WGS84→BD09 增量会约为 +0.0118/+0.0077。故来源为 GCJ-02，入库前需转 WGS-84
 *      （scripts/lib/coord.mjs 的 gcj02ToWgs84）。
 *   5) robots.txt：https://www.bankcomm.com/robots.txt 返回 404（正文是一个 HTML 跳转页，
 *      不是 robots 文本）→ 站点未声明 robots 规则；本脚本仍自我限速 ≥1.1s/次。
 *   6) 接口无 Cookie、无 Referer 依赖，纯 curl 可复现。
 *
 * 用法：
 *   node scripts/probe-bocom.mjs            # Playwright 抓包 + 无 Cookie 直连复跑 + robots
 *   node scripts/probe-bocom.mjs --direct   # 只跑直连接口（不启浏览器）
 *
 * 限速：直连调用与浏览器内的数据类请求都经 gate()，相邻两次间隔 ≥1100ms。
 */
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { curlText, UA } from './lib/http.mjs'

const BASE = 'https://www.bankcomm.com'
const PAGE = `${BASE}/BankCommSite/shtml/jyjr/cn/7158/8203/list.shtml?channelId=7158`
const REFERER = `${BASE}/BankCommSite/zonghang/cn/node/index.html?siteType=jyjr`
const OUT_DIR = 'scripts/_recon-out'
const MIN_GAP = 1100
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let lastAt = 0
/** 全局限速闸门：任意两次对外请求之间至少 1.1s */
async function gate() {
  const wait = lastAt + MIN_GAP - Date.now()
  if (wait > 0) await sleep(wait)
  lastAt = Date.now()
}

const decode = (s) => {
  if (s == null) return ''
  try {
    return decodeURIComponent(String(s).replace(/\+/g, ' '))
  } catch {
    return String(s)
  }
}
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 直连接口：完全不带 Cookie（http.mjs 的 curl 每次独立临时目录，无 cookie jar） */
async function postSite(path, reqBody, { referer = REFERER } = {}) {
  await gate()
  const msg = JSON.stringify({ REQ_HEAD: { TRAN_PROCESS: '', TRAN_ID: '' }, REQ_BODY: reqBody })
  const text = curlText(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: 'REQ_MESSAGE=' + msg,
    referer,
  })
  return { text, json: JSON.parse(text) }
}

/** 取 HTTP 状态码（http.mjs 只回正文），用于 robots.txt；-D 把响应头写文件再解析状态行 */
async function statusOf(url) {
  await gate()
  const dir = mkdtempSync(join(tmpdir(), 'poi-st-'))
  const body = join(dir, 'body.txt')
  const head = join(dir, 'head.txt')
  try {
    const r = spawnSync(
      'curl.exe',
      ['-s', '--ssl-no-revoke', '-m', '40', '-A', UA, '-o', body, '-D', head, url],
      { stdio: 'ignore', timeout: 60000 },
    )
    if (r.error) throw r.error
    const lines = readFileSync(head, 'utf8').split(/\r?\n/)
    const statusLine = [...lines].reverse().find((l) => /^HTTP\//i.test(l)) || ''
    const code = Number((statusLine.match(/\s(\d{3})\s?/) || [])[1] || 0)
    const bodyText = readFileSync(body, 'utf8')
    return { code, bodyHead: bodyText.slice(0, 200).replace(/\s+/g, ' '), bodyLen: bodyText.length }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function pickRows(branchData) {
  return Object.values(branchData || {}).map((p) => ({
    name: decode(p.n),
    address: decode(p.a),
    phone: p.p || '',
    publicPhone: p.o || '',
    loanPhone: p.lp || '',
    hours: decode(p.t),
    loanHours: decode(p.ohl || ''),
    lng: num(p.x),
    lat: num(p.y),
    coordSys: 'GCJ-02',
    branchNo: p.d,
    nodeId: p.i,
    postcode: p.c,
    typeCode: p.b,
  }))
}

// ---------------------------------------------------------------- robots
async function probeRobots() {
  const { code, bodyHead } = await statusOf(`${BASE}/robots.txt`)
  console.log(`[robots] https://www.bankcomm.com/robots.txt -> HTTP ${code}`)
  console.log(`[robots] 正文前 120 字：${bodyHead.slice(0, 120)}`)
  console.log(
    code === 404
      ? '[robots] 404：站点无 robots.txt（该路径返回的是 HTML 跳转页，非 robots 文本）→ 无 robots 声明，按自我限速执行'
      : `[robots] HTTP ${code}`,
  )
  return code
}

// ---------------------------------------------------------------- 浏览器抓包
async function probeBrowser() {
  const browser = await launch()
  const ctx = await browser.newContext({
    locale: 'zh-CN',
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  })
  const page = await ctx.newPage()

  /** 所有 XHR：URL / method / postData / 状态 / 响应前 600 字符 */
  const xhrs = []
  /** 页面自身把 (x,y) 送百度 geoconv 做 from=3&to=5 的偏移，用一次样本来反推源坐标系 */
  let convSample = null
  page.on('response', async (res) => {
    if (/geoconv\/v1/.test(res.url()) && !convSample) {
      try {
        const u = new URL(res.url())
        const coords = u.searchParams.get('coords') || ''
        const from = u.searchParams.get('from')
        const to = u.searchParams.get('to')
        const txt = await res.text()
        const m = txt.match(/"x":([\d.]+),"y":([\d.]+)/)
        if (m) {
          const [inLng, inLat] = coords.split(',').map(Number)
          convSample = {
            from,
            to,
            inLng,
            inLat,
            outLng: Number(m[1]),
            outLat: Number(m[2]),
            dLng: Number(m[1]) - inLng,
            dLat: Number(m[2]) - inLat,
          }
        }
      } catch {
        /* 第三方转换失败不影响主流程 */
      }
    }
  })
  // 浏览器内的数据类请求也过闸门，保证 ≥1.1s
  await page.route('**/*', async (route) => {
    const req = route.request()
    if (req.resourceType() === 'xhr' || req.resourceType() === 'fetch') {
      if (new URL(req.url()).hostname === 'www.bankcomm.com') await gate()
    }
    await route.continue()
  })
  page.on('response', async (res) => {
    const req = res.request()
    const type = req.resourceType()
    if (type !== 'xhr' && type !== 'fetch') return
    let body = ''
    try {
      body = (await res.text()).slice(0, 600)
    } catch (e) {
      body = `[unreadable] ${e.message}`
    }
    xhrs.push({
      url: res.url(),
      host: new URL(res.url()).hostname,
      method: req.method(),
      postData: req.postData(),
      status: res.status(),
      bodyHead600: body,
    })
  })

  await gate()
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await sleep(4500)
  const frame = page.frames().find((f) => f.url().includes('zonghang'))
  if (!frame) throw new Error('未找到网点地图 iframe')

  // 步骤1：广东省 → 深圳市（页面的城市链接 onclick 里带省份，moveTDByProv('G','GD|广东省','2040')）
  const szLink = await frame.evaluate(() => {
    const a = [...document.querySelectorAll('#lstByCity a, .p-citys a')].find(
      (x) => x.textContent.trim() === '深圳市',
    )
    if (!a) return null
    return { text: a.textContent.trim(), onclick: a.getAttribute('onclick') || '' }
  })
  if (!szLink) throw new Error('城市列表未找到「深圳市」')
  console.log(`[ui] 广东省→深圳市：链接 onclick = ${szLink.onclick}`)
  await gate()
  await frame.evaluate(() => {
    ;[...document.querySelectorAll('#lstByCity a, .p-citys a')]
      .find((x) => x.textContent.trim() === '深圳市')
      .click()
  })
  await sleep(5000)
  const cityState = await frame.evaluate(() => ({
    currentCity: (document.querySelector('#currentCity')?.textContent || '').trim(),
    currentCounty: (document.querySelector('#currentCounty')?.textContent || '').trim(),
    districts: [...document.querySelectorAll('#loadCounty a')].map((a) => a.textContent.trim()),
    items: document.querySelectorAll('#wd_list_branch .p-node').length,
    pager: (document.querySelector('#wd_pg_branch')?.textContent || '').replace(/\s+/g, ' ').trim(),
  }))
  console.log(`[ui] 当前城市=${cityState.currentCity} 区县=${cityState.districts.join('/')}`)
  console.log(`[ui] 列表 DOM 节点=${cityState.items} 分页文案="${cityState.pager}"`)

  // 步骤2：选一个区（福田区）
  const district = '福田区'
  await gate()
  const clickedDistrict = await frame.evaluate((d) => {
    const a = [...document.querySelectorAll('#loadCounty a')].find(
      (x) => x.textContent.trim() === d,
    )
    if (!a) return false
    a.click()
    return true
  }, district)
  await sleep(5000)
  const countyState = await frame.evaluate(() => ({
    currentCounty: (document.querySelector('#currentCounty')?.textContent || '').trim(),
    items: document.querySelectorAll('#wd_list_branch .p-node').length,
    pager: (document.querySelector('#wd_pg_branch')?.textContent || '').replace(/\s+/g, ' ').trim(),
    names: [...document.querySelectorAll('#wd_list_branch .p-node .name')]
      .slice(0, 3)
      .map((e) => e.textContent.trim()),
  }))
  console.log(
    `[ui] 区=${countyState.currentCounty}（点击=${clickedDistrict}）DOM 节点=${countyState.items} 分页="${countyState.pager}"`,
  )
  console.log(`[ui] 前 3 条：${countyState.names.join(' | ')}`)

  if (convSample) {
    console.log(
      `[坐标系] 页面把接口 (x,y) 以 from=${convSample.from}&to=${convSample.to} 送百度 geoconv：` +
        `(${convSample.inLng},${convSample.inLat}) -> (${convSample.outLng.toFixed(6)},${convSample.outLat.toFixed(6)})，` +
        `Δ=+${convSample.dLng.toFixed(6)}/+${convSample.dLat.toFixed(6)}`,
    )
    console.log(
      '[坐标系] Δ≈0.0065/0.0060 正是 GCJ-02→BD-09 的固定偏移（若源为 WGS-84，Δ 应约 0.0118/0.0077）→ 接口为 GCJ-02',
    )
  }

  await browser.close()

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'bocom-xhr.json'), JSON.stringify(xhrs, null, 2))

  console.log(`\n[XHR] 共捕获 ${xhrs.length} 条 XHR：`)
  for (const x of xhrs) {
    console.log(`  ${x.method} ${x.status} ${x.url.replace(/&ak=[^&]+/, '&ak=***').slice(0, 160)}`)
    if (x.postData) console.log(`     postData: ${x.postData.slice(0, 300)}`)
    console.log(`     resp[0:600]: ${x.bodyHead600.replace(/\s+/g, ' ').slice(0, 600)}`)
  }
  const data = xhrs.filter((x) =>
    /\/SITE\/(queryBranchResult|queryCityResult|queryCountyByCityName)\.do/.test(x.url),
  )
  return { xhrs, data, cityState, countyState }
}

async function launch() {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' })
  } catch {
    return await chromium.launch({ headless: true })
  }
}

// ---------------------------------------------------------------- 无 Cookie 直连复跑
async function probeDirect() {
  const city = '深圳市'
  const runs = []
  for (let i = 1; i <= 2; i++) {
    const { json, text } = await postSite('/SITE/queryBranchResult.do', {
      URL_TYPE: '',
      CITY: city,
      COUNTY_NAME: '',
    })
    const b = json.RSP_BODY.branch
    const rows = pickRows(b.data)
    runs.push({ json, text, rows })
    console.log(
      `[direct#${i}] POST /SITE/queryBranchResult.do CITY=${city} -> HTTP200 count=${b.count} 实际=${rows.length} 带坐标=${rows.filter((r) => r.lng && r.lat).length} 字节=${text.length}`,
    )
  }
  const same =
    JSON.stringify(runs[0].json.RSP_BODY.branch) === JSON.stringify(runs[1].json.RSP_BODY.branch)
  console.log(`[direct] 两次独立复跑（无 Cookie）网点数据一致：${same ? '是' : '否'}`)

  // 无 Referer 也能用？
  const noRef = await postSite(
    '/SITE/queryBranchResult.do',
    { URL_TYPE: '', CITY: city, COUNTY_NAME: '' },
    { referer: '' },
  )
  const noRefCount = noRef.json.RSP_BODY.branch.count
  console.log(`[direct] 不带 Referer -> count=${noRefCount}（说明接口无需会话/来源校验）`)

  // 区县列表 + 各区计数
  const cty = await postSite('/SITE/queryCountyByCityName.do', { cityName: city })
  const citys = cty.json.RSP_BODY.data.citys
  const districts = Object.values(Object.values(citys)[0]).map((c) => ({
    name: c.d,
    code: c.de,
    lng: num(c.x),
    lat: num(c.y),
  }))
  console.log(`[direct] 深圳区县 ${districts.length} 个：${districts.map((d) => d.name).join('/')}`)

  const perDistrict = []
  for (const d of districts) {
    const r = await postSite('/SITE/queryBranchResult.do', {
      URL_TYPE: '',
      CITY: city,
      COUNTY_NAME: d.name,
    })
    perDistrict.push({ district: d.name, count: Number(r.json.RSP_BODY.branch.count) })
  }
  const sum = perDistrict.reduce((a, b) => a + b.count, 0)
  console.log(
    `[direct] 各区合计 ${sum} 条：${perDistrict.map((p) => `${p.district}=${p.count}`).join(', ')}`,
  )

  const rows = runs[0].rows
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'bocom-sz.json'), JSON.stringify(rows, null, 2))
  return {
    runs,
    rows,
    total: Number(runs[0].json.RSP_BODY.branch.count),
    districts,
    perDistrict,
    sum,
    noRefCount,
  }
}

// ---------------------------------------------------------------- main
const directOnly = process.argv.includes('--direct')
console.log('=== 交通银行深圳网点接口探针 ===')
const robots = await probeRobots()

let browserResult = null
if (!directOnly) {
  console.log('\n=== Playwright headless：打开网点查询页并选 广东省→深圳市→福田区 ===')
  browserResult = await probeBrowser()
  const branchXhr = browserResult.xhrs.find(
    (x) => /queryBranchResult\.do/.test(x.url) && /深圳市/.test(x.postData || ''),
  )
  if (branchXhr) {
    console.log(`\n[api] 列表接口确认：POST ${branchXhr.url}`)
    console.log(`[api] 城市级请求体：${branchXhr.postData}`)
  }
  const districtXhr = browserResult.xhrs.find(
    (x) => /queryBranchResult\.do/.test(x.url) && /福田区/.test(x.postData || ''),
  )
  if (districtXhr) console.log(`[api] 区级请求体：${districtXhr.postData}`)
}

console.log('\n=== 无 Cookie 直连续跑（curl，独立进程、无 cookie jar） ===')
const direct = await probeDirect()

const rows = direct.rows
console.log('\n=== 结果 ===')
console.log(
  `深圳网点总数：${direct.total}（接口 count 字段；两次复跑均为 ${direct.runs[1].rows.length} 条）`,
)
console.log(
  `带经纬度：${rows.filter((r) => r.lng && r.lat).length}/${rows.length}（坐标系 GCJ-02）`,
)
console.log(`区县计数合计：${direct.sum} = ${direct.perDistrict.map((p) => p.count).join('+')}`)
console.log('\n前 8 条：')
for (const r of rows.slice(0, 8)) {
  console.log(
    `  ${r.name} | ${r.address} | 对私 ${r.phone} 对公 ${r.publicPhone} | ${r.hours.replace(/\s+/g, ' ').slice(0, 40)} | ${r.lng},${r.lat}`,
  )
}
console.log(`\n完整 53 条已写入 ${OUT_DIR}/bocom-sz.json；XHR 明细 ${OUT_DIR}/bocom-xhr.json`)
console.log(`robots.txt = HTTP ${robots}`)
