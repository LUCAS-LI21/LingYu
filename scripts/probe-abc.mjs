// 农业银行深圳网点抓取（最小复现，Playwright headless Chrome）
// 页面：https://app.abchina.com.cn/branch/  选「广东省 → 深圳市 → 营业网点」点搜索：
//   POST https://app.abchina.com.cn/branch/Branch   (表单)
//        provinceId=440000&cityId=440300&boroughId=-1&keyWord=&tplType=1&bizType=0&pageIndex=0
// 区划：GET /branch/District（省）；POST /branch/District/440000（市）；POST /branch/District/Any/440300（区）
// 返回：data.responseBody.totalCount / listSearchResultCollectionVo[].BranchBankVo
// 字段：Name FullAddress PhoneNumber Longitude Latitude Code BranchLevel ...（无营业时间）
// 坐标系：GCJ-02（页面用 coordtransform.gcj02tobd09 转百度坐标）；20 条/页，pageIndex 从 0 开始。
// robots：www.abchina.com 与 app.abchina.com.cn 的 /robots.txt 均返回 404（无 robots 限制）。
// 用法：node scripts/probe-abc.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'

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
await page.goto('https://app.abchina.com.cn/branch/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await page.waitForTimeout(2000)

async function search(form) {
  const data = await page.evaluate(async (body) => {
    const r = await fetch('/branch/Branch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams(body),
    })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return r.json()
  }, form)
  await sleep(1100) // 限速 ≥1 秒/请求
  return data
}

const rows = []
for (let pageIndex = 0; ; pageIndex++) {
  const data = await search({
    provinceId: '440000', // 广东省（经 /branch/District 与 /branch/District/440000 核实）
    cityId: '440300', // 深圳市
    boroughId: '-1', // -1 = 全部区县
    keyWord: '',
    tplType: '1', // 1=营业网点（2=自助银行 3=自助设备）
    bizType: '0', // 0=全部
    pageIndex,
  })
  const body = data?.data?.responseBody
  if (!body) throw new Error('业务返回异常: ' + JSON.stringify(data).slice(0, 200))
  const list = body.listSearchResultCollectionVo || []
  for (const { BranchBankVo: b } of list) {
    rows.push({
      name: b.Name,
      address: b.FullAddress || b.Address,
      phone: b.PhoneNumber,
      hours: null, // 该接口不提供营业时间
      lng: Number(b.Longitude),
      lat: Number(b.Latitude),
      coordSys: 'GCJ-02',
      code: b.Code,
      level: b.BranchLevel,
      city: b.City,
    })
  }
  const total = Number(body.totalCount || 0)
  console.log(`pageIndex=${pageIndex}：累计 ${rows.length}/${total}`)
  if (!list.length || rows.length >= total) break
}
await browser.close()

fs.mkdirSync('scripts/_recon-out', { recursive: true })
fs.writeFileSync('scripts/_recon-out/abc-sz.json', JSON.stringify(rows, null, 2))
console.log(`农行深圳网点 ${rows.length} 条，已写入 scripts/_recon-out/abc-sz.json`)
console.log(rows[0])
