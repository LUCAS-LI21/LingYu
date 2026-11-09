// 邮储银行深圳网点抓取（最小复现，Playwright headless Chrome）
// 页面：https://www.psbc.com/cn/common/fwwd/  选「广东省 → 深圳市」触发 JSONP：
//   GET https://s.psbc.com/portal/PsbcService/dotMap/businesslonglatitude
//       ?longtitude=116.315185&latitude=39.98727&areaType=1&bankName=&pageIndex=1
//       &searchType=1&regionId=440300&isLocateFlag=0&callback=<jsonp>
// 返回：resultList[0].totalSize / resultList[0].resultList[].InformationInq
// 字段：organName organAddr phone bus_tm|stdBusTm longitude latitude organCode ...
// 坐标系：接口未标注（直接交给邮储自家地图）；10 条/页，pageIndex 从 1 开始。
// robots：www.psbc.com 200（Disallow /grfw/、/PsbcService/）；接口域 s.psbc.com/robots.txt 404。
// 用法：node scripts/probe-psbc.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'https://s.psbc.com/portal/PsbcService/dotMap'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launch() {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' })
  } catch {
    return await chromium.launch({ headless: true }) // 需先 pnpm exec playwright install chromium
  }
}

const browser = await launch()
const page = await browser
  .newContext({ locale: 'zh-CN', ignoreHTTPSErrors: true })
  .then((c) => c.newPage())
await page.goto('https://www.psbc.com/cn/common/fwwd/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await page.waitForTimeout(2500)

async function jsonp(path, params) {
  const url = new URL(BASE + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const data = await page.evaluate(
    (src) =>
      new Promise((resolve, reject) => {
        const name = '__cb_' + Math.random().toString(36).slice(2)
        const timer = setTimeout(() => reject(new Error('jsonp timeout')), 20000)
        window[name] = (d) => {
          clearTimeout(timer)
          resolve(d)
        }
        const s = document.createElement('script')
        s.src = src + (src.includes('?') ? '&' : '?') + 'callback=' + name
        s.onerror = () => reject(new Error('jsonp script error'))
        document.head.appendChild(s)
      }),
    url.toString(),
  )
  await sleep(1100) // 限速 ≥1 秒/请求
  return data
}

// 1. 省 → 市（深圳市 440300）
const provinces = await jsonp('/provinceNames', {})
const gd = provinces.resultList.find((p) => p.RGLM_NAME === '广东省')
const cities = await jsonp('/regionalism', { provRglmName: gd.RGLM_NAME })
const sz = cities.resultList.find((c) => c.CITY_RGLM_NAME === '深圳市')

// 2. 按市分页
const rows = []
for (let pageIndex = 1; ; pageIndex++) {
  const data = await jsonp('/businesslonglatitude', {
    longtitude: 114.057868,
    latitude: 22.543099,
    areaType: 1,
    bankName: '',
    pageIndex,
    searchType: 1,
    regionId: sz.CITY_RGLM_CODE,
    isLocateFlag: 0,
  })
  const outer = data.resultList?.[0]
  const list = outer?.resultList || []
  for (const { InformationInq: b } of list) {
    rows.push({
      name: b.organName,
      address: b.organAddr,
      phone: b.phone,
      hours: b.bus_tm || b.stdBusTm || '',
      lng: Number(b.longitude),
      lat: Number(b.latitude),
      code: b.organCode,
      regionId: b.regionId,
    })
  }
  const total = Number(outer?.totalSize || 0)
  console.log(`第 ${pageIndex} 页：累计 ${rows.length}/${total}`)
  if (!list.length || rows.length >= total) break
}
await browser.close()

fs.mkdirSync('scripts/_recon-out', { recursive: true })
fs.writeFileSync('scripts/_recon-out/psbc-sz.json', JSON.stringify(rows, null, 2))
console.log(`邮储深圳网点 ${rows.length} 条，已写入 scripts/_recon-out/psbc-sz.json`)
console.log(rows[0])
