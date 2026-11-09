// 广发银行深圳网点抓取（最小复现，Playwright headless Chrome）
// 页面：https://www.cgbchina.com.cn/Channel/185652  切换到深圳市后页面加载时请求：
//   POST https://www.cgbchina.com.cn/mobile/jsp/common/getRtpTrade.jsp
//        interfaceType=nearBank&cityCode=440300&keyWords=&beginNum=0&pageNums=20
// 城市列表：同接口 interfaceType=cityList（深圳市 cityCode=440300）
// 返回：{ totalNum, markInfoOList:[{ markName, markAdress, tel, bussTime, longitude, latitude, markId, ... }] }
// 分页：beginNum 为偏移量（0 起），pageNums 每页条数。
// 坐标系：接口未标注（页面直接传给百度地图/自有地图脚本）。
// robots：www.cgbchina.com.cn 200，Allow /；仅禁 *.php/*.asp/*.aspx/*.sql/*.txt/*.xml/*.pdf，.jsp 不在禁止项。
// 用法：node scripts/probe-cgb.mjs
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
await page.goto('https://www.cgbchina.com.cn/Channel/185652', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
})
await page.waitForTimeout(2000)

async function nearBank(form) {
  const data = await page.evaluate(async (body) => {
    const r = await fetch('/mobile/jsp/common/getRtpTrade.jsp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return r.json()
  }, form)
  await sleep(1100) // 限速 ≥1 秒/请求
  return data
}

const rows = []
const pageNums = 20
for (let beginNum = 0; ; beginNum += pageNums) {
  const data = await nearBank({
    interfaceType: 'nearBank',
    cityCode: '440300', // 深圳市
    keyWords: '',
    beginNum,
    pageNums,
  })
  const list = data.markInfoOList || []
  for (const b of list) {
    rows.push({
      name: b.markName,
      address: b.markAdress, // 官方字段名就是 markAdress
      phone: b.tel,
      hours: b.bussTime,
      lng: Number(b.longitude),
      lat: Number(b.latitude),
      id: b.markId,
      city: b.cityName,
    })
  }
  const total = Number(data.totalNum || 0)
  console.log(`beginNum=${beginNum}：累计 ${rows.length}/${total}`)
  if (!list.length || rows.length >= total) break
}
await browser.close()

fs.mkdirSync('scripts/_recon-out', { recursive: true })
fs.writeFileSync('scripts/_recon-out/cgb-sz.json', JSON.stringify(rows, null, 2))
console.log(`广发深圳网点 ${rows.length} 条，已写入 scripts/_recon-out/cgb-sz.json`)
console.log(rows[0])
