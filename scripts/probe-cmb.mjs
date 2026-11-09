// 招商银行深圳网点接口探针
// 发现路径：https://map.cmbchina.com/map → 选择 广东 / 深圳 / 福田区 → 点击网点
//   GET https://map.cmbchina.com/api/map/getCmbData?cityName=深圳&type=B
//   GET https://map.cmbchina.com/api/map/getCmbBrnBusiInfo?branchNo=755546
// 用法：node scripts/probe-cmb.mjs [--limit=5]   // 默认拉全部 97 个网点，约 2 分钟
// 限速：每次主动 HTTP 请求间隔 >= 1100ms
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const BASE = 'https://map.cmbchina.com'
const OUT_DIR = path.resolve('scripts/probe-out')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity

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

async function get(url, init = {}) {
  const r = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': UA,
      Referer: BASE + '/map',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  return JSON.parse(text)
}

async function robots() {
  const r = await fetch(BASE + '/robots.txt', { headers: { 'User-Agent': UA } })
  const t = await r.text()
  const api = /Disallow:\s*\/api/i.test(t)
  console.log(`[robots] ${BASE}/robots.txt -> ${r.status}, Disallow /api: ${api ? 'YES' : 'NO'}`)
  await sleep(1100)
  return { status: r.status, disallowApi: api, text: t }
}

// —— 第 1 步：浏览器渲染 + 交互，捕获真正在用的 XHR ——
async function discover() {
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() })
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    userAgent: UA,
  })
  const page = await ctx.newPage()
  const api = []
  page.on('response', async (res) => {
    const u = res.url()
    if (!u.includes('/api/map/')) return
    try {
      api.push({ status: res.status(), url: u, body: await res.text() })
    } catch {}
  })
  const t0 = Date.now()
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(4000)
  const sels = page.locator('select')
  await sels.nth(0).selectOption('广东')
  await page.waitForTimeout(1200)
  await sels.nth(1).selectOption('深圳')
  await page.waitForTimeout(1200)
  await sels.nth(2).selectOption('福田区')
  await page.waitForTimeout(1500)
  const first = page.locator('text=深圳红岭支行').first()
  if (await first.count()) {
    await first.click()
    await page.waitForTimeout(2000)
  }
  await browser.close()
  console.log(
    `[发现] 页面交互 ${((Date.now() - t0) / 1000).toFixed(1)}s，捕获 /api/map 响应 ${api.length} 条`,
  )
  for (const a of api) console.log('  ', a.status, a.url.replace(BASE, ''), a.body.length + 'B')
  return api
}

// —— 第 2 步：直接调用接口拉全量 ——
async function collect() {
  const listUrl = `${BASE}/api/map/getCmbData?cityName=${encodeURIComponent('深圳')}&type=B`
  const list = await get(listUrl)
  if (list.returnCode !== 'SUC0000') throw new Error('getCmbData 返回 ' + list.returnCode)
  const branches = list.body
  console.log(
    `[列表] ${listUrl}\n        网点 ${branches.length} 条，字段 ${Object.keys(branches[0]).join(',')}`,
  )
  const out = []
  for (const b of branches.slice(0, LIMIT)) {
    await sleep(1100)
    const detail = await get(`${BASE}/api/map/getCmbBrnBusiInfo?branchNo=${b.branchNo}`)
    const d = detail.body || {}
    out.push({
      branchNo: b.branchNo,
      name: b.name,
      address: d.branchAddr || '',
      phone: d.serviceTels || '',
      hours: (d.branchOpenTime || []).map(
        (x) => `${x.weekDayLabel} 对私:${x.retailTime || '-'} 对公:${x.publicTime || '-'}`,
      ),
      status: d.status || '',
      lng: b.lng,
      lat: b.lat,
    })
    process.stdout.write(`\r[详情] ${out.length}/${Math.min(LIMIT, branches.length)}`)
  }
  process.stdout.write('\n')
  return { listUrl, count: branches.length, items: out }
}

const robotsInfo = await robots()
const discovered = await discover()
const data = await collect()
fs.mkdirSync(OUT_DIR, { recursive: true })
const file = path.join(OUT_DIR, 'cmb-shenzhen.json')
fs.writeFileSync(
  file,
  JSON.stringify(
    { bank: '招商银行', city: '深圳', robots: robotsInfo, discoveredApi: discovered, ...data },
    null,
    2,
  ),
)
console.log(`\n[结果] ${data.count} 个网点，已取详情 ${data.items.length} 条 -> ${file}`)
const s = data.items[0]
if (s)
  console.log(
    '示例:',
    JSON.stringify(
      { name: s.name, address: s.address, phone: s.phone, lng: s.lng, lat: s.lat },
      null,
      1,
    ),
  )
