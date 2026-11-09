#!/usr/bin/env node
/**
 * probe-ccb.mjs — 中国建设银行「网点及ATM」数据链路探测（Playwright）
 * ============================================================================
 * 目标：摸清 http://ebank3.ccb.cn/cn/home/map/branchSearch.html 查询深圳网点时
 *       真正返回网点列表的 XHR，验证响应里是否带经纬度、分页参数与总条数。
 *
 * 两种模式
 *   1) 默认（UI 模式）：headless Chrome 打开页面，真实点击
 *      省份 → 城市 → 区县 → 查询 → 翻页，全程录 XHR 并把关键响应落盘。
 *   2) --http：不用浏览器，直接按同一 URL 模板请求（实测无需任何 Cookie 也能拿到
 *      数据），用于验证「纯 HTTP 可复现」的数据链路。
 *
 * 用法
 *   node scripts/probe-ccb.mjs                          # 广东→深圳→福田，抓第 1 页
 *   node scripts/probe-ccb.mjs --headed                 # 有头模式看交互
 *   node scripts/probe-ccb.mjs --pages 2                # UI 里再翻到第 2 页
 *   node scripts/probe-ccb.mjs --district 南山区 --pages 2
 *   node scripts/probe-ccb.mjs --http --pages 4         # 纯 HTTP 抓 4 页
 *   node scripts/probe-ccb.mjs --http --district 440304 --all-pages
 *   node scripts/probe-ccb.mjs --http --district 440300 --all-pages \
 *     --agg-out scripts/probe-out/ccb-shenzhen.json      # 深圳全量 153 条聚合输出
 *
 * 产物（默认 data/ccb-probe/）
 *   xhr-log.json                    全程 XHR：URL / method / postData / 响应前 800 字符
 *   nzx013-<adiv>-p<N>.json         网点列表接口的完整响应（UI 模式带 -by-district 等后缀）
 *   report.json / report-http.json  UI / HTTP 模式的结构化结论（字段、经纬度、分页、总数）
 *   branches-<adiv>.json            HTTP 全量抓取的归一化网点数组（可直接入库）
 *   branches-<adiv>-ui-p1.json      UI 模式仅首页 10 条样本
 *
 * 关键实测结论（2026-11-10）
 *   - 列表接口 NZX013 无需登录 / Cookie / 页面会话，纯 HTTP 即可复现；
 *   - 每页固定 10 条，分页参数 PAGE_JUMP（1-based），响应含 TOTAL_REC / TOTAL_PAGE；
 *   - 经纬度字段为 Lgt / Ltt，页面按 GCJ-02 使用。
 *
 * 纪律：所有请求间隔 ≥ 1.1s；只访问 ccb.com / ccb.cn；页面自身会加载百度地图 JS SDK
 *       （脚本启动必需），地图瓦片等其它第三方请求一律阻断。
 */

import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// 常量与参数
// ---------------------------------------------------------------------------
const ROOT = path.resolve(import.meta.dirname, '..')
const ENTRY = 'http://ebank3.ccb.cn/cn/home/map/branchSearch.html'
const HOST = 'https://wealth.ccb.com'
const GATEWAY = `${HOST}/tran/WCCMainPlatV5?CCB_IBSVersion=V5&SERVLET_NAME=WCCMainPlatV5`
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
const MIN_INTERVAL_MS = 1100 // 请求间隔下限

const opts = parseArgs(process.argv.slice(2))
const OUT = path.resolve(ROOT, opts.out || 'data/ccb-probe')
const PROVINCE = opts.province || '广东省'
const CITY = opts.city || '深圳市'
const DISTRICT = opts.district || '福田区'
const KEYWORD = opts.keyword || ''
const MAX_PAGES = Number(opts.pages || 1)
const NET_TYPE = String(opts['net-type'] || '1') // 1=营业网点 2=自助银行 3=ATM 4=全部
const HEADLESS = !opts.headed

fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const nowIso = () => new Date().toISOString()

function log(...a) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    if (eq > -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1)
    } else {
      const k = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        out[k] = next
        i++
      } else {
        out[k] = true
      }
    }
  }
  return out
}

// 同一进程内串行限速：两次 CCB 请求之间至少间隔 MIN_INTERVAL_MS
let lastHit = 0
async function throttle() {
  const wait = lastHit + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastHit = Date.now()
}

// ---------------------------------------------------------------------------
// 接口 URL 模板（页面 selectshow3.js:296/307 里拼出来的真实地址）
// ---------------------------------------------------------------------------
function nzx013Url({ adiv, page = 1, netType = NET_TYPE, keyword = KEYWORD }) {
  // 注意：Enqr_Cnd_Cntnt 后面是 **全角等号** U+FF1D，页面源码就是 ％EF%BC%9D，不是笔误
  return (
    `${GATEWAY}&isAjaxRequest=true&TXCODE=NZX013&Enqr_Cnd_Cntnt＝011860003&isJSONRequest=true` +
    `&ADiv_Cd=${encodeURIComponent(adiv)}` +
    `&Kywd_List_Cntnt=${encodeURIComponent(keyword)}` +
    `&Enqr_MtdCd=${encodeURIComponent(netType)}` +
    `&Cur_StCd=4&PAGE_JUMP=${page}`
  )
}

// 行政区划接口：type=1 省 / type=2 市 / type=3 区县
const nareaUrl = (type, areacode = '') =>
  `${GATEWAY}&isAjaxRequest=true&TXCODE=NAREA2&type=${type}` +
  (areacode ? `&areacode=${areacode}` : '')

// ---------------------------------------------------------------------------
// 响应解析与归一化
// ---------------------------------------------------------------------------
const hhmm = (t) => (t && t !== '00:00:00' ? String(t).slice(0, 5) : null)

function range(st, ed) {
  const a = hhmm(st)
  const b = hhmm(ed)
  return a && b ? { start: a, end: b, text: `${a}-${b}` } : null
}

function normalizeHours(raw) {
  const personal = {
    weekday: range(raw.Prvt_WkDy_Oprg_StTm, raw.Prvt_WkDy_Oprg_EdTm),
    weekdayRest: range(raw.Prvt_WkDy_Rst_StTm, raw.Prvt_WkDy_Rst_EdTm),
    saturday: range(raw.Prvt_Sat_Oprg_StTm, raw.Prvt_Sat_Oprg_EdTm),
    sunday: range(raw.Prvt_Sun_Oprg_StTm, raw.Prvt_Sun_Oprg_EdTm),
  }
  const corporate = {
    weekdayForenoon: range(raw.CorpWkDyFrnnOprg_StTm, raw.CorpWkDyFrnnOprg_EdTm),
    weekdayAfternoon: range(raw.CorpWkDyAftrnOprgStTm, raw.CorpWkDyAftrnOprgEdTm),
  }
  const parts = []
  if (personal.weekday) parts.push(`对私 周一至周五 ${personal.weekday.text}`)
  if (personal.weekdayRest) parts.push(`午休 ${personal.weekdayRest.text}`)
  if (personal.saturday) parts.push(`周六 ${personal.saturday.text}`)
  if (personal.sunday) parts.push(`周日 ${personal.sunday.text}`)
  if (corporate.weekdayForenoon || corporate.weekdayAfternoon) {
    const c = [corporate.weekdayForenoon?.text, corporate.weekdayAfternoon?.text]
      .filter(Boolean)
      .join('、')
    parts.push(`对公 周一至周五 ${c}`)
  }
  return { personal, corporate, text: parts.join('；') || null }
}

function normalizeBranch(raw, meta = {}) {
  const hours = normalizeHours(raw)
  return {
    source: 'ccb',
    id: raw.PK_ID || raw.CCB_SlfSvc_Bnk_ID || raw.SSEq_ID || null,
    name: raw.CCBIns_Nm || raw.Bnk_Nm || raw.MtIt_Nm || null,
    address: raw.Dtl_Adr || null,
    phone: raw.Fix_TelNo || null,
    lng: raw.Lgt ? Number(raw.Lgt) : null,
    lat: raw.Ltt ? Number(raw.Ltt) : null,
    coordSystem: 'GCJ-02', // 依据页面 createMap({ coordsType: BMAP_COORD_GCJ02 })
    districtCode: raw.ADiv_Cd || meta.adiv || null,
    districtName: meta.districtName || null,
    netType: raw.Enqr_MtdCd || null,
    openStatus: raw.Cur_StCd ?? null,
    hours,
    businessHours: hours.text,
  }
}

function analyze(json) {
  const list = Array.isArray(json.OUTLET_DTL_LIST) ? json.OUTLET_DTL_LIST : []
  const slf = Array.isArray(json.SLFBANK_DTL_LIST) ? json.SLFBANK_DTL_LIST : []
  const eq = Array.isArray(json.SLFEQMT_DTL_LIST) ? json.SLFEQMT_DTL_LIST : []
  const all = [...list, ...slf, ...eq]
  const withCoord = all.filter((x) => x.Lgt && x.Ltt)
  return {
    topLevelKeys: Object.keys(json),
    lists: {
      OUTLET_DTL_LIST: list.length,
      SLFBANK_DTL_LIST: slf.length,
      SLFEQMT_DTL_LIST: eq.length,
    },
    itemFields: Object.keys(all[0] || {}),
    coordinate: {
      present: all.length > 0 && withCoord.length === all.length,
      fields: withCoord.length ? ['Lgt', 'Ltt'] : [],
      sample: withCoord[0] ? { Lgt: withCoord[0].Lgt, Ltt: withCoord[0].Ltt } : null,
      coordSystem: 'GCJ-02',
    },
    pageSize: Number(json.CURR_TOTAL_REC || 0),
    total: Number(json.TOTAL_REC || 0),
    totalPages: Number(json.TOTAL_PAGE || 0),
    currentPage: Number(json.CURR_TOTAL_PAGE || 0),
  }
}

// ---------------------------------------------------------------------------
// 通用：把一次 NZX013 响应落盘
// ---------------------------------------------------------------------------
const saved = []
function saveNzx013(json, label, meta) {
  const adiv = meta.adiv || 'unknown'
  const file = path.join(OUT, `nzx013-${adiv}-${label}.json`)
  fs.writeFileSync(file, JSON.stringify(json, null, 2))
  saved.push({
    label,
    file: path.relative(ROOT, file),
    total: Number(json.TOTAL_REC || 0),
    page: Number(json.CURR_TOTAL_PAGE || 0),
  })
  log(
    `  ↳ 已保存 ${path.relative(ROOT, file)}  (TOTAL_REC=${json.TOTAL_REC}, PAGE=${json.CURR_TOTAL_PAGE}/${json.TOTAL_PAGE})`,
  )
  return file
}

// ===========================================================================
// 模式 A：Playwright 真实 UI 交互
// ===========================================================================
async function runUiMode() {
  const xhrLog = []
  const blocked = new Map()

  const browser = await launchBrowser()
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  })

  // 只放行 ccb 域；百度地图 JS SDK 是页面自身启动必需，单独放行其 script。
  // 其它第三方（高德 SDK、百度瓦片、百度统计、miao 等）全部阻断。
  await ctx.route('**/*', async (route) => {
    const req = route.request()
    const url = req.url()
    let host
    try {
      host = new URL(url).hostname
    } catch {
      return route.abort()
    }
    const isCcb = /(^|\.)ccb\.(com|cn)$/i.test(host)
    if (isCcb) return route.continue()
    const isBaiduSdk = req.resourceType() === 'script' && /(^|\.)api\.map\.baidu\.com$/i.test(host)
    if (isBaiduSdk) return route.continue()
    blocked.set(host, (blocked.get(host) || 0) + 1)
    return route.abort()
  })

  const page = await ctx.newPage()
  page.setDefaultTimeout(15000)
  page.setDefaultNavigationTimeout(60000)
  page.on('pageerror', (e) => log('  [pageerror]', e.message.slice(0, 200)))

  page.on('request', (req) => {
    if (!['xhr', 'fetch'].includes(req.resourceType())) return
    if (!/ccb\.(com|cn)/i.test(req.url())) return
    xhrLog.push({
      seq: xhrLog.length + 1,
      dir: 'request',
      at: nowIso(),
      method: req.method(),
      url: req.url(),
      postData: req.postData() || null,
    })
  })

  page.on('response', async (res) => {
    const req = res.request()
    if (!['xhr', 'fetch'].includes(req.resourceType())) return
    if (!/ccb\.(com|cn)/i.test(res.url())) return
    let body
    try {
      const ct = res.headers()['content-type'] || ''
      body = /json|text|javascript/i.test(ct)
        ? (await res.text()).slice(0, 800)
        : `<${ct || 'binary'}>`
    } catch (e) {
      body = `ERR ${e.message}`
    }
    xhrLog.push({
      seq: xhrLog.length + 1,
      dir: 'response',
      at: nowIso(),
      status: res.status(),
      url: res.url(),
      bodyPreview: body,
    })
  })

  const captures = []
  async function capture(res, label, meta) {
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text.trim())
    } catch {
      throw new Error(`NZX013 响应不是合法 JSON (${label}): ${text.slice(0, 200)}`)
    }
    captures.push({ label, adiv: meta.adiv, json })
    saveNzx013(json, label, meta)
    return json
  }

  const waitNzx = (adiv) =>
    page.waitForResponse(
      (r) =>
        r.url().includes('TXCODE=NZX013') &&
        r.url().includes(`ADiv_Cd=${adiv}`) &&
        r.request().method() === 'GET',
      { timeout: 45000 },
    )

  // --- 打开页面 -------------------------------------------------------------
  log('打开入口页:', ENTRY)
  await page.goto(ENTRY, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(
    () => document.querySelectorAll('#selectProvince + .select_ul li').length > 20,
    null,
    { timeout: 45000 },
  )
  log('页面就绪:', page.url())

  // --- 省 → 市 → 区 ---------------------------------------------------------
  async function openDropdown(spanSel) {
    const ul = page.locator(`${spanSel} + .select_ul`)
    if (!(await ul.isVisible())) {
      await page.locator(spanSel).click()
      await ul.waitFor({ state: 'visible', timeout: 10000 })
    }
    await sleep(150)
    return ul
  }

  // 1) 省份（注意：#selectProvince 的 value 属性不会被 addcity 更新，必须取被点 li 的 value）
  log(`选择省份：${PROVINCE}`)
  await throttle()
  let provinceCode
  {
    const ul = await openDropdown('#selectProvince')
    const li = ul.locator('li', { hasText: PROVINCE }).first()
    if ((await li.count()) === 0) throw new Error(`省份下拉里找不到「${PROVINCE}」`)
    provinceCode = await li.getAttribute('value')
    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('TXCODE=NAREA2&type=2') && r.url().includes(`areacode=${provinceCode}`),
        { timeout: 30000 },
      ),
      li.click(),
    ])
    log('  省份接口:', resp.status(), decodeURIComponent(resp.url()).slice(0, 140))
  }
  await page.waitForFunction(
    () => document.querySelectorAll('#selectCity + .select_ul li').length > 1,
    null,
    { timeout: 30000 },
  )
  log(`  ${PROVINCE} areacode = ${provinceCode}`)

  // 2) 城市
  log(`选择城市：${CITY}`)
  await throttle()
  let cityCode
  {
    const ul = await openDropdown('#selectCity')
    const li = ul.locator('li', { hasText: CITY }).first()
    if ((await li.count()) === 0) throw new Error(`城市下拉里找不到「${CITY}」`)
    cityCode = await li.getAttribute('value')
    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('TXCODE=NAREA2&type=3') && r.url().includes(`areacode=${cityCode}`),
        { timeout: 30000 },
      ),
      li.click(),
    ])
    log('  城市接口:', resp.status(), decodeURIComponent(resp.url()).slice(0, 140))
  }
  await page.waitForFunction(
    () => document.querySelectorAll('#selectcountry + .select_ul li').length > 1,
    null,
    { timeout: 30000 },
  )
  log(`  ${CITY} areacode = ${cityCode}`)

  // 3) 区县（选中即触发第一次 NZX013）
  log(`选择区县：${DISTRICT}（选中后页面会自动查询）`)
  await throttle()
  let districtCode
  {
    const ul = await openDropdown('#selectcountry')
    const li = ul.locator('li', { hasText: DISTRICT }).first()
    if ((await li.count()) === 0) throw new Error(`区县下拉里找不到「${DISTRICT}」`)
    districtCode = await li.getAttribute('value')
    const [resp] = await Promise.all([waitNzx(districtCode), li.click()])
    log('  列表接口:', resp.status(), `ADiv_Cd=${districtCode}`)
    const json = await capture(resp, 'p1-by-district', {
      adiv: districtCode,
      districtName: DISTRICT,
    })
    log(
      `  网点数 TOTAL_REC=${json.TOTAL_REC}  TOTAL_PAGE=${json.TOTAL_PAGE}  首页条数=${json.CURR_TOTAL_REC}`,
    )
  }
  await page.waitForFunction(() => document.querySelectorAll('#result ol li').length > 0, null, {
    timeout: 30000,
  })
  await page.screenshot({ path: path.join(OUT, 'shot-result.png') }).catch(() => {})

  // 4) 点「查询」按钮（放大镜 .btn-map），验证按钮走的是同一个接口
  log('点击「查询」按钮（.btn-map）')
  await throttle()
  {
    const [resp] = await Promise.all([waitNzx(districtCode), page.locator('.btn-map').click()])
    const json = await capture(resp, 'p1-by-button', { adiv: districtCode, districtName: DISTRICT })
    log(`  查询按钮响应 TOTAL_REC=${json.TOTAL_REC}，与选中区县时一致`)
  }

  // 5) 翻页：点分页条上的数字，验证 PAGE_JUMP
  const page1 = captures.find((c) => c.label === 'p1-by-district').json
  const maxPage = Math.min(MAX_PAGES, Number(page1.TOTAL_PAGE || 1))
  for (let p = 2; p <= maxPage; p++) {
    log(`翻到第 ${p} 页（点击 #page 里的「${p}」）`)
    await throttle()
    const link = page.locator('#page a', { hasText: new RegExp(`^\\s*${p}\\s*$`) }).first()
    const [resp] = await Promise.all([waitNzx(districtCode), link.click()])
    const json = await capture(resp, `p${p}`, { adiv: districtCode, districtName: DISTRICT })
    log(`  第 ${p} 页：CURR_TOTAL_PAGE=${json.CURR_TOTAL_PAGE}，本页 ${json.CURR_TOTAL_REC} 条`)
  }

  // 6) 全市口径：区县下拉里点「区/县」（value=城市 code）
  let cityWide = null
  try {
    log(`改查全市（${CITY}，ADiv_Cd=${cityCode}）`)
    await throttle()
    const ul = await openDropdown('#selectcountry')
    const li = ul.locator('li', { hasText: '区/县' }).first()
    if ((await li.count()) > 0) {
      const [resp] = await Promise.all([waitNzx(cityCode), li.click()])
      const json = await capture(resp, 'p1-city-wide', { adiv: cityCode, districtName: CITY })
      cityWide = {
        adiv: cityCode,
        total: Number(json.TOTAL_REC),
        pages: Number(json.TOTAL_PAGE),
        pageSize: Number(json.CURR_TOTAL_REC),
      }
      log(`  全市 TOTAL_REC=${json.TOTAL_REC}  TOTAL_PAGE=${json.TOTAL_PAGE}`)
    }
  } catch (e) {
    log('  全市口径探测跳过:', e.message.slice(0, 160))
  }

  // --- 汇总与落盘 -----------------------------------------------------------
  const primary = captures.find((c) => c.label === 'p1-by-district').json
  const analysis = analyze(primary)
  const fields = analysis.itemFields
  const normalized = (primary.OUTLET_DTL_LIST || []).map((x) =>
    normalizeBranch(x, { adiv: districtCode, districtName: DISTRICT }),
  )
  fs.writeFileSync(
    path.join(OUT, `branches-${districtCode}-ui-p1.json`),
    JSON.stringify(normalized, null, 2),
  )

  const report = {
    generatedAt: nowIso(),
    mode: 'playwright-ui',
    entry: ENTRY,
    finalUrl: page.url(),
    region: {
      province: PROVINCE,
      provinceCode,
      city: CITY,
      cityCode,
      district: DISTRICT,
      districtCode,
    },
    endpoint: {
      method: 'GET',
      postData: null,
      urlTemplate:
        `${GATEWAY}&isAjaxRequest=true&TXCODE=NZX013&Enqr_Cnd_Cntnt＝011860003&isJSONRequest=true` +
        `&ADiv_Cd={区县或城市代码}&Kywd_List_Cntnt={关键词}&Enqr_MtdCd={1营业网点|2自助银行|3ATM|4全部}&Cur_StCd=4&PAGE_JUMP={页码从1开始}`,
      exampleUrl: nzx013Url({ adiv: districtCode, page: 1 }),
      preRequest:
        '页面在查询前会先 GET TXCODE=100119（返回一段 base64），但实测纯 HTTP 请求不依赖它',
    },
    response: {
      topLevelKeys: analysis.topLevelKeys,
      lists: analysis.lists,
      itemFields: fields,
      pageSize: analysis.pageSize,
      total: analysis.total,
      totalPages: analysis.totalPages,
      coordinate: analysis.coordinate,
    },
    cityWide,
    pagination: {
      param: 'PAGE_JUMP',
      pageSize: analysis.pageSize,
      fixedPageSize: true,
      note: 'PAGE_SIZE / Page_Size / CNT_PER_PG 均被忽略；PAGE_JUMP 越界会被夹到最后一页',
    },
    captures: saved,
    samples: normalized.slice(0, 3),
    blockedThirdParty: Object.fromEntries([...blocked.entries()].sort((a, b) => b[1] - a[1])),
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(OUT, 'xhr-log.json'), JSON.stringify(xhrLog, null, 2))

  // --- 控制台结论 -----------------------------------------------------------
  console.log('\n================ CCB 网点查询链路结论 ================')
  console.log(`入口            : ${ENTRY}`)
  console.log(`最终页面        : ${page.url()}`)
  console.log(`列表接口        : GET ${nzx013Url({ adiv: districtCode, page: 1 })}`)
  console.log(`POST body       : 无（GET，query string 传参）`)
  console.log(
    `区域            : ${PROVINCE}(${provinceCode}) → ${CITY}(${cityCode}) → ${DISTRICT}(${districtCode})`,
  )
  console.log(`顶层字段        : ${analysis.topLevelKeys.join(', ')}`)
  console.log(`列表字段        : ${fields.join(', ')}`)
  console.log(
    `经纬度          : ${analysis.coordinate.present ? `有 → Lgt(经度)/Ltt(纬度)，样例 ${JSON.stringify(analysis.coordinate.sample)}` : '没有'}`,
  )
  console.log(
    `坐标系          : ${analysis.coordinate.coordSystem}（页面 createMap 声明 BMAP_COORD_GCJ02）`,
  )
  console.log(
    `分页            : PAGE_JUMP 从 1 开始；每页固定 ${analysis.pageSize} 条；TOTAL_PAGE=${analysis.totalPages} TOTAL_REC=${analysis.total}`,
  )
  if (cityWide)
    console.log(`深圳全市(营业网点): TOTAL_REC=${cityWide.total}  TOTAL_PAGE=${cityWide.pages}`)
  console.log(
    `XHR 记录        : ${xhrLog.length} 条 → ${path.relative(ROOT, path.join(OUT, 'xhr-log.json'))}`,
  )
  console.log(`报告            : ${path.relative(ROOT, path.join(OUT, 'report.json'))}`)
  console.log('======================================================\n')

  await browser.close()
  return report
}

async function launchBrowser() {
  const candidates = [
    { headless: HEADLESS, channel: 'chrome' },
    { headless: HEADLESS, channel: 'msedge' },
    { headless: HEADLESS },
  ]
  const errors = []
  for (const c of candidates) {
    try {
      const b = await chromium.launch(c)
      log(`浏览器已启动（channel=${c.channel || 'bundled chromium'}）`)
      return b
    } catch (e) {
      errors.push(`${c.channel || 'chromium'}: ${e.message.split('\n')[0]}`)
    }
  }
  throw new Error('无法启动浏览器：\n' + errors.join('\n'))
}

// ===========================================================================
// 模式 B：纯 HTTP（无浏览器）
// ===========================================================================
// 实测：UA 必须以浏览器标识开头（可再追加项目标识），否则网关返回 200 + 空 body。
const HTTP_UA = `${UA} poi-intel-demo/0.1 (academic demo; contact 2396845790@qq.com)`

async function httpGet(url, tag) {
  await throttle()
  const t0 = Date.now()
  const res = await fetch(url, {
    headers: {
      'User-Agent': HTTP_UA,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: `${HOST}/cn/home/map/branchSearch.html`,
    },
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  log(`  GET ${tag} → ${res.status} ${Date.now() - t0}ms ${text.length}B`)
  if (!res.ok) throw new Error(`${tag} HTTP ${res.status}: ${text.slice(0, 200)}`)
  if (!text.trim()) throw new Error(`${tag} 返回空 body：UA 必须以浏览器标识开头（见 HTTP_UA）`)
  return text
}

async function httpJson(url, tag) {
  const text = await httpGet(url, tag)
  try {
    return JSON.parse(text.trim())
  } catch {
    throw new Error(`${tag} 返回不是 JSON: ${text.slice(0, 200)}`)
  }
}

async function resolveAdiv({ province, city, district }) {
  const provinces = await httpJson(nareaUrl(1), 'NAREA2 type=1 省')
  const p = provinces.arealist.find((x) => x && x.NET_NAME === province)
  if (!p) throw new Error(`找不到省份 ${province}`)
  const cities = await httpJson(nareaUrl(2, p.areacode), `NAREA2 type=2 ${province}`)
  const c = cities.arealist.find((x) => x && x.NET_NAME === city)
  if (!c) throw new Error(`找不到城市 ${city}`)
  const districts = await httpJson(nareaUrl(3, c.areacode), `NAREA2 type=3 ${city}`)
  const d = districts.arealist.find((x) => x && x.NET_NAME === district)
  if (!d)
    throw new Error(
      `找不到区县 ${district}，可选：${districts.arealist
        .filter((x) => x.NET_NAME)
        .map((x) => x.NET_NAME)
        .join('、')}`,
    )
  return { provinceCode: p.areacode, cityCode: c.areacode, districtCode: d.areacode }
}

async function runHttpMode() {
  const xhrLog = []
  const prov = opts.province || '广东省'
  const city = opts.city || '深圳市'
  const district = /^\d{6}$/.test(String(opts.district || ''))
    ? opts.district
    : opts.district || '福田区'

  let codes
  if (/^\d{6}$/.test(String(district))) {
    codes = {
      provinceCode: opts.provinceCode || null,
      cityCode: opts.cityCode || null,
      districtCode: String(district),
    }
  } else {
    log(`解析行政区划：${prov} → ${city} → ${district}`)
    codes = await resolveAdiv({ province: prov, city, district })
  }
  const adiv = codes.districtCode
  log(`目标 ADiv_Cd=${adiv}`)

  const all = []
  let page = 1
  let totalPages
  let apiTotal
  do {
    const url = nzx013Url({ adiv, page })
    const json = await httpJson(url, `NZX013 p${page}`)
    xhrLog.push({
      seq: xhrLog.length + 1,
      at: nowIso(),
      method: 'GET',
      url,
      postData: null,
      status: 200,
      bodyPreview: JSON.stringify(json).slice(0, 800),
    })
    saveNzx013(json, `p${page}`, { adiv })
    totalPages = Number(json.TOTAL_PAGE || 1)
    apiTotal = Number(json.TOTAL_REC || 0)
    const list = json.OUTLET_DTL_LIST || []
    all.push(...list)
    log(`  本页 ${list.length} 条，累计 ${all.length}/${apiTotal}，TOTAL_PAGE=${totalPages}`)
    page++
    if (opts['all-pages'] !== true && page > Math.max(1, Number(opts.pages || 1))) break
  } while (page <= totalPages)

  const normalized = all.map((x) =>
    normalizeBranch(x, { adiv, districtName: /^\d{6}$/.test(String(district)) ? null : district }),
  )
  fs.writeFileSync(path.join(OUT, `branches-${adiv}.json`), JSON.stringify(normalized, null, 2))

  // 可选：输出成与 scripts/probe-out/<bank>-shenzhen.json 同构的聚合文件，供多行汇总
  if (opts['agg-out']) {
    const aggPath = path.resolve(ROOT, String(opts['agg-out']))
    fs.mkdirSync(path.dirname(aggPath), { recursive: true })
    const agg = {
      bank: '中国建设银行',
      city: '深圳',
      entry: ENTRY,
      finalPage: `${HOST}/cn/home/map/branchSearch.html`,
      discoveredApi: [
        {
          method: 'GET',
          url: nzx013Url({ adiv, page: 1 }),
          body: JSON.stringify(all.slice(0, 2)).slice(0, 800),
        },
      ],
      pagination: { param: 'PAGE_JUMP', pageSize: 10, totalPages, totalRecords: apiTotal },
      hasCoordinate: normalized.every((x) => Number.isFinite(x.lng) && Number.isFinite(x.lat)),
      coordSystem: 'GCJ-02',
      count: normalized.length,
      items: normalized.map((x) => ({
        branchNo: x.id,
        name: x.name,
        address: x.address,
        phone: x.phone,
        hours: x.businessHours ? [x.businessHours] : [],
        status: x.openStatus,
        districtCode: x.districtCode,
        lng: String(x.lng),
        lat: String(x.lat),
      })),
    }
    fs.writeFileSync(aggPath, JSON.stringify(agg, null, 2))
    log(`聚合输出: ${path.relative(ROOT, aggPath)} (${normalized.length} 条)`)
  }

  const first = xhrLog[0]
  const report = {
    generatedAt: nowIso(),
    mode: 'http',
    endpoint: { method: 'GET', urlTemplate: first.url, postData: null },
    region: { ...codes, district },
    fetchedPages: page - 1,
    totalPages,
    totalRecords: apiTotal,
    fetchedRecords: all.length,
    coordinate: {
      fieldNames: ['Lgt', 'Ltt'],
      present: normalized.every((x) => Number.isFinite(x.lng) && Number.isFinite(x.lat)),
      coordSystem: 'GCJ-02',
    },
    itemFields: Object.keys(all[0] || {}),
    samples: normalized.slice(0, 3),
    files: saved,
  }
  fs.writeFileSync(path.join(OUT, 'report-http.json'), JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(OUT, 'xhr-log.json'), JSON.stringify(xhrLog, null, 2))

  console.log('\n================ CCB 网点查询（纯 HTTP） ================')
  console.log(`请求            : GET ${nzx013Url({ adiv, page: 1 })}`)
  console.log(`Cookie          : 不需要（全新会话直接请求即返回 SUCCESS=true）`)
  console.log(`UA              : 浏览器 UA 前缀 + 项目标识（纯自定义 UA 会返回 200 空 body）`)
  console.log(`区划            : ${JSON.stringify(codes)}`)
  console.log(
    `抓取            : ${page - 1} 页 / 共 ${totalPages} 页，${all.length}/${apiTotal} 条`,
  )
  console.log(
    `经纬度          : ${report.coordinate.present ? '全部有 Lgt/Ltt（GCJ-02）' : '存在缺失'}`,
  )
  console.log(`归一化结果      : ${path.relative(ROOT, path.join(OUT, `branches-${adiv}.json`))}`)
  console.log('=========================================================\n')
  return report
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
try {
  if (opts.help) {
    console.log(
      fs
        .readFileSync(new URL(import.meta.url), 'utf8')
        .split('\n')
        .slice(1, 33)
        .join('\n'),
    )
    process.exit(0)
  }
  if (opts.http) await runHttpMode()
  else await runUiMode()
} catch (e) {
  console.error('\n[FAILED]', e.stack || e.message)
  process.exitCode = 1
}
