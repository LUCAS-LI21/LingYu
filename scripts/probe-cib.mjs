// 兴业银行深圳网点探针
// 发现路径：https://branch.cib.com.cn/index.html（全行营业网点）→ 深圳分行 → 营业网点
//   实际数据来自静态 HTML：https://branch.cib.com.cn/ShenZhen/outlets/index.html
//   无 JSON 接口、无经纬度；仅 www.cib.com.cn/search/tts/query1.do（搜索 token）与埋点会被触发。
// 另：服务预约地图 https://e.cib.com.cn/pc/queue 的 POST /service/queue/queue/queryOrgList
//     请求/响应均为 SM2 加密（{"encrypt":"...","signature":"..."}），字段不可读，故未纳入。
// 用法：node scripts/probe-cib.mjs
// 限速：每次主动 HTTP 请求间隔 >= 1100ms
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const HOSTS = ['https://www.cib.com.cn', 'https://branch.cib.com.cn', 'https://e.cib.com.cn']
const OUT_DIR = path.resolve('scripts/probe-out')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findChrome() {
  try {
    const p = chromium.executablePath()
    if (p && fs.existsSync(p)) return p
  } catch {}
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
  if (!fs.existsSync(base)) return undefined
  for (const d of fs.readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const p = path.join(base, d, 'chrome-win64', 'chrome.exe')
    if (fs.existsSync(p)) return p
  }
  return undefined
}

async function robots() {
  const res = []
  for (const h of HOSTS) {
    try {
      const r = await fetch(h + '/robots.txt', { headers: { 'User-Agent': UA, Accept: 'text/plain' } })
      const t = await r.text()
      const isRobots = /^\s*(User-agent|Sitemap|Disallow|Allow)/im.test(t) && !/<html/i.test(t)
      res.push({ host: h, status: r.status, isRobots, head: t.slice(0, 120).replace(/\s+/g, ' ') })
      console.log(`[robots] ${h}/robots.txt -> ${r.status} ${isRobots ? 'robots 文件' : '非 robots（软 404）'}`)
    } catch (e) {
      res.push({ host: h, status: 'ERR', error: e.message })
      console.log(`[robots] ${h}/robots.txt -> ERR ${e.message}`)
    }
    await sleep(1100)
  }
  return res
}

const browser = await chromium.launch({ headless: true, executablePath: findChrome() })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', userAgent: UA })
const page = await ctx.newPage()
const xhr = []
page.on('response', async (res) => {
  const req = res.request()
  if (req.resourceType() !== 'xhr' && req.resourceType() !== 'fetch') return
  try {
    xhr.push({ method: req.method(), status: res.status(), url: res.url(), body: (await res.text()).slice(0, 200) })
  } catch {}
})

const robotsInfo = await robots()

// 全行营业网点 → 深圳分行 → 营业网点
await page.goto('https://branch.cib.com.cn/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForTimeout(1500)
await sleep(1100)
await page.locator('a[href$="/ShenZhen/outlets/index.html"]').first().click()
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1500)

const data = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('tr')]
  const items = []
  const seen = new Set()
  for (const tr of rows) {
    const cells = [...tr.querySelectorAll('td .cell')].map((c) => c.innerText.replace(/\s+\n/g, '\n').trim())
    if (cells.length < 4) continue
    const [name, address, phone, hours] = cells
    if (!/^0\d{2,3}-/.test(phone) || seen.has(name)) continue
    seen.add(name)
    items.push({ name, address, phone, hours })
  }
  const html = document.documentElement.outerHTML
  const hasCoord = /"(lng|lat|longitude|latitude)"\s*:/.test(html) || /经度|纬度/.test(html)
  return { items, hasCoord, title: document.title, url: location.href }
})

fs.mkdirSync(OUT_DIR, { recursive: true })
const file = path.join(OUT_DIR, 'cib-shenzhen.json')
fs.writeFileSync(
  file,
  JSON.stringify(
    { bank: '兴业银行', city: '深圳', robots: robotsInfo, page: { url: data.url, title: data.title }, xhr, hasCoordinate: data.hasCoord, count: data.items.length, items: data.items },
    null,
    2,
  ),
)
console.log(`\n[结果] ${data.url} 抓取 ${data.items.length} 个营业网点，页面坐标字段：${data.hasCoord ? '有' : '无'} -> ${file}`)
console.log('[XHR]', xhr.length ? xhr.map((x) => `${x.method} ${x.url}`).join('\n       ') : '无业务 XHR')
console.log('示例:', JSON.stringify(data.items[0], null, 1))
await browser.close()
