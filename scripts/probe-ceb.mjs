// 光大银行深圳网点接口探针
// 发现路径：https://www.cebbank.com/eportal/ui?pageId=484657（服务网点）
//   页面校验 UA 与内核版本，UA 不匹配会被瑞数 WAF 拦成 412；headless 下用真实版本 UA 可通过。
//   城市下拉 -> 广东 -> 深圳市 -> 查询
//   列表接口：POST /eportal/ui?struts.portlet.action=/portlet/emapFront!queryEmapDotList.action
//             &moduleId=12853&pageId=484657  data: keyword=, cityId=<深圳市 id>
//   注意：请求 URL 与 body 会被瑞数动态令牌加密（?7ibksfL8=... / vgL7Kuyn=...），无法脱离浏览器重放。
// 用法：node scripts/probe-ceb.mjs
// 限速：相邻主动请求 >= 1100ms
import {
  Pacer,
  saveJson,
  checkRobots,
  launch,
  restrictToBank,
  recordXhr,
} from './lib/bank-probe.mjs'

const ORIGIN = 'https://www.cebbank.com'
const PAGE = `${ORIGIN}/eportal/ui?pageId=484657`
const pace = new Pacer(1100)

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()

async function collectOnce(label) {
  const { browser, ctx, page, close } = await launch()
  await restrictToBank(ctx, 'cebbank.com', ['amap.com'])
  const xhr = []
  recordXhr(page, (u) => /\/eportal\/ui/.test(u), xhr)
  await pace.wait()
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(8000) // 等默认城市（北京）首查和 WAF 签名初始化完成

  let city = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    if (typeof window.queryCityList === 'function') window.queryCityList()
    await sleep(6000)
    const cr = window.cityResult
    if (!cr) return { err: 'cityResult 未加载' }
    const gd = cr.provinceList.find((p) => p.name.includes('广东'))
    const sz = cr.cityList[gd.id] && cr.cityList[gd.id].find((c) => c.name.includes('深圳'))
    return {
      province: gd && gd.name,
      city: sz && sz.name,
      cityId: sz && sz.id,
      provinces: cr.provinceList.length,
      cities: (cr.cityList[gd.id] || []).map((c) => c.name),
    }
  })
  if (!city.cityId) {
    // 兜底：点开城市选择器，让页面自己加载省市列表
    await page
      .locator('.select_box.city')
      .click()
      .catch(() => {})
    await page.waitForTimeout(4000)
    city = await page.evaluate(async () => {
      const cr = window.cityResult
      if (!cr) return { err: 'cityResult 未加载（点击兜底后）' }
      const gd = cr.provinceList.find((p) => p.name.includes('广东'))
      const sz = cr.cityList[gd.id] && cr.cityList[gd.id].find((c) => c.name.includes('深圳'))
      return {
        province: gd && gd.name,
        city: sz && sz.name,
        cityId: sz && sz.id,
        provinces: cr.provinceList.length,
        cities: (cr.cityList[gd.id] || []).map((c) => c.name),
      }
    })
  }
  if (!city.cityId) throw new Error(`未取到深圳市 id: ${JSON.stringify(city)}`)

  await new Promise((r) => setTimeout(r, 4000)) // 瑞数对连续签名请求敏感，切城市前至少留 4s
  await page.evaluate(
    ([p, c, id]) => window.searchDot(p, c, id),
    [city.province, city.city, city.cityId],
  )
  await page.waitForTimeout(7000)
  let cityLabel = await page
    .locator('.searchcity_name')
    .first()
    .innerText()
    .catch(() => '')
  if (!cityLabel.includes('深圳')) {
    // 偶发 400（动态令牌竞争）时，间隔更久重试一次
    await page.waitForTimeout(5000)
    await page.evaluate(
      ([p, c, id]) => window.searchDot(p, c, id),
      [city.province, city.city, city.cityId],
    )
    await page.waitForTimeout(8000)
    cityLabel = await page
      .locator('.searchcity_name')
      .first()
      .innerText()
      .catch(() => '')
  }
  if (!cityLabel.includes('深圳')) throw new Error(`切换深圳失败，当前城市=${cityLabel}`)

  const totalText = await page
    .locator('.result')
    .innerText()
    .catch(() => '')
  const total = Number((totalText.match(/\d+/) || [0])[0])
  const pageCount = Math.ceil(total / 10)
  const items = []
  for (let p = 1; p <= pageCount; p++) {
    await page.evaluate((n) => window.initDotPage(n), p)
    await page.waitForTimeout(400)
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.address_content')].map((el) => {
        const cl = (s) => (s || '').replace(/\s+/g, ' ').trim()
        const text = cl(el.innerText)
        const spans = [...el.querySelectorAll('.address_text')].map((x) => cl(x.innerText))
        const addr = spans.find((s) => s.startsWith('地址'))
        const tel = spans.find((s) => s.startsWith('电话'))
        const post = spans.find((s) => s.startsWith('邮编'))
        const latlon = (el.querySelector('[id^=latlon]')?.textContent || '').trim()
        const [lng, lat] = latlon.split(',').map(Number)
        return {
          name: cl(el.querySelector('.bank_name')?.innerText),
          address: addr ? cl(addr.replace(/^地址：?/, '')) : '',
          phone: tel ? cl(tel.replace(/^电话：?/, '')) : '',
          postcode: post ? cl(post.replace(/^邮编：?/, '')) : '',
          lng: Number.isFinite(lng) ? lng : null,
          lat: Number.isFinite(lat) ? lat : null,
          raw: text.slice(0, 40),
        }
      }),
    )
    items.push(...rows)
  }
  await close()
  return { label, city, total, totalText: clean(totalText), pageCount, items, xhr }
}

// —— 主流程（先采集，后查 robots，避免 robots 请求触发 WAF 限速） ——
const first = await collectOnce('首次')
const second = await collectOnce('复跑')
const same = second.total === first.total && second.items.length === first.items.length
const robots = await checkRobots(ORIGIN, '/eportal')
const robotsStatic = await checkRobots('https://static.cebbank.com', '/site')
console.log(
  `[robots] ${robots.url} -> ${robots.status}${robots.sample.trim().startsWith('<') ? '（返回 HTML 错误页，非 robots）' : ''}`,
)
console.log(
  `[robots] ${robotsStatic.url} -> ${robotsStatic.status}, Disallow /: ${robotsStatic.disallowAll}（静态站点）`,
)
console.log(
  `[复跑] 全新上下文无 Cookie: 共有 ${second.total} 个 / ${second.items.length} 条，与首次 ${same ? '一致' : '不一致'}`,
)
console.log(`[发现] ${PAGE}`)
console.log(
  `  城市: 广东/深圳市 id=${first.city.cityId}（省 ${first.city.provinces} 个，广东 ${first.city.cities.length} 市，无区级）`,
)
console.log(`  捕获 /eportal/ui XHR ${first.xhr.length} 条，查询请求示例:`)
const q = first.xhr.filter((x) => x.method === 'POST' && x.postData.length > 50).slice(-2)
for (const x of q) {
  console.log(`   ${x.status} ${x.method} ${x.url.slice(0, 150)}`)
  console.log(`      post: ${x.postData.slice(0, 120)}`)
  console.log(`      body: ${x.body.replace(/\s+/g, ' ').slice(0, 160)}`)
}
console.log(
  `[列表] 共有 ${first.total} 个网点；抓取 ${first.items.length} 条（${first.pageCount} 页 x 10）`,
)
console.log(`  字段: name, address, phone, postcode, lng, lat；营业时间：接口未提供`)
const s = first.items[0]
console.log(
  `  示例: ${JSON.stringify({ name: s.name, address: s.address, phone: s.phone, lng: s.lng, lat: s.lat })}`,
)

// —— 独立复跑：全新浏览器上下文（无任何 Cookie），数据见上方复跑行 ——

const file = saveJson('ceb-shenzhen.json', {
  bank: '中国光大银行',
  city: '深圳',
  robots,
  robotsStatic,
  discovered: {
    page: PAGE,
    cityListApi:
      '/eportal/ui?struts.portlet.action=/portlet/emapFront!getCityList.action&moduleId=12853',
    xhr: first.xhr,
  },
  listApi: {
    url: '/eportal/ui?struts.portlet.action=/portlet/emapFront!queryEmapDotList.action&moduleId=12853&pageId=484657',
    method: 'POST x-www-form-urlencoded（URL/body 经瑞数动态令牌加密）',
    params: 'keyword=, cityId=<城市 GUID>',
    fields: 'name, address, phone, postcode, pointX, pointY',
    pagination: '接口一次返回全部；前端每页 10 条（共 5 页）',
    total: first.total,
    lngLat: true,
    hours: false,
    district: false,
    note: '瑞数 WAF：headless 必须使用与内核版本一致的 UA，否则 412；参数无法在浏览器外重放',
  },
  branches: first.items,
  verify: { total: second.total, count: second.items.length, consistent: same },
})
console.log(`\n[结果] ${first.items.length} 条 -> ${file}`)
