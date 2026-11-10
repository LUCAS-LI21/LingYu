// 华夏银行深圳网点接口探针
// 发现路径：https://www.hxb.com.cn/hxb/clientServ/c234444/index.shtml
//   省 select#city_select -> 广东(p004) -> 市 select#branch_select -> 深圳(c0007)
//   GET /hxmap/get_bank.jsp?params.areaCode=p004&params.branchCode=c0007&...&page=1&params.status=1
// 用法：node scripts/probe-hxb.mjs
// 限速：相邻主动请求 >= 1100ms
import {
  Pacer,
  saveJson,
  checkRobots,
  parseJsonp,
  fetchText,
  launch,
  restrictToBank,
  recordXhr,
} from './lib/bank-probe.mjs'

const ORIGIN = 'https://www.hxb.com.cn'
const PAGE = `${ORIGIN}/hxb/clientServ/c234444/index.shtml`
const API = `${ORIGIN}/hxmap/get_bank.jsp`
const pace = new Pacer(1100)

const WEEKEND = { 0: '周六营业', 1: '周日营业', 2: '周六、周日都营业', 3: '周六、周日都不营业' }
const clean = (s) =>
  (s || '')
    .replace(/<br\s*\/?>/gi, '；')
    .replace(/\s+/g, ' ')
    .trim()

function buildUrl({ areaCode, branchCode, bankType, page }) {
  const q = new URLSearchParams({
    jsonpcallback: 'cb',
    'params.areaCode': areaCode,
    'params.branchCode': branchCode,
    'params.bankName': '',
    'params.bankType': String(bankType),
    'params.Lng': '114.06',
    'params.Lat': '22.55',
    page: String(page),
    'params.status': '1',
  })
  return `${API}?${q}`
}

async function fetchPage(args) {
  await pace.wait()
  const text = await fetchText(buildUrl(args), { headers: { Referer: PAGE } })
  return parseJsonp(text)
}

async function collect(bankType) {
  const first = await fetchPage({ areaCode: 'p004', branchCode: 'c0007', bankType, page: 1 })
  const items = []
  const push = (list) => {
    for (const b of list || []) {
      items.push({
        name: b.branchName,
        address: clean(b.branchAddress),
        phone: [b.branchPhone, b.branchPhone2]
          .map((x) => (x || '').trim())
          .filter(Boolean)
          .join(' / '),
        hours: clean(b.branchBusinessTime),
        weekend: WEEKEND[String(b.branchWeekendopen)] || '',
        type: String(b.bankType) === '0' ? '营业网点' : 'ATM',
        lng: Number(b.branchLongitude),
        lat: Number(b.branchDimension),
      })
    }
  }
  push(first.list)
  for (let p = 2; p <= (first.pageCount || 1); p++) {
    const d = await fetchPage({ areaCode: 'p004', branchCode: 'c0007', bankType, page: p })
    push(d.list)
  }
  return { total: first.rowCount, pageCount: first.pageCount, pageSize: first.rows, items }
}

async function discover() {
  const { browser, ctx, page, close } = await launch()
  await restrictToBank(ctx, 'hxb.com.cn', ['amap.com'])
  const xhr = []
  recordXhr(page, (u) => /\/hxmap\//.test(u), xhr)
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)
  const provinces = await page
    .locator('#city_select option')
    .evaluateAll((els) => els.map((o) => ({ v: o.value, t: o.text.trim() })))
  await page.selectOption('#city_select', { label: '广东' })
  await page.waitForTimeout(1800)
  const cities = await page
    .locator('#branch_select option')
    .evaluateAll((els) => els.map((o) => ({ v: o.value, t: o.text.trim() })))
  await page.selectOption('#branch_select', { label: '深圳' })
  await page.waitForTimeout(3000)
  const shown = (
    await page
      .locator('.cc_website_Lcontenttabmenu')
      .innerText()
      .catch(() => '')
  ).trim()
  const districtSelects = await page
    .locator('select')
    .evaluateAll((els) => els.map((e) => ({ id: e.id, options: e.options.length })))
  await close()
  return {
    page: PAGE,
    provinces: provinces.length,
    guangdong: provinces.find((p) => p.t === '广东'),
    cities: cities.slice(0, 8),
    shenzhen: cities.find((c) => c.t === '深圳'),
    shownCountText: shown,
    selects: districtSelects,
    districtFilter: '无（仅省/市/类型三个下拉）',
    xhr,
  }
}

// —— 主流程 ——
const robots = await checkRobots(ORIGIN, '/hxmap')
console.log(`[robots] ${robots.url} -> ${robots.status}, Disallow /: ${robots.disallowAll}`)

const found = await discover()
const branch = await collect(0)
const atm = await collect(1)
const totalAll = await collect(2)

console.log(`[发现] ${found.page}`)
console.log(
  `  省 ${found.provinces} 个，广东=${JSON.stringify(found.guangdong)}，深圳=${JSON.stringify(found.shenzhen)}`,
)
console.log(`  页面提示: ${found.shownCountText}`)
console.log(`  捕获 XHR ${found.xhr.length} 条（前 3 条）:`)
for (const x of found.xhr.slice(0, 3))
  console.log(
    `   ${x.status} ${x.method} ${x.url.slice(0, 150)}\n      post=${x.postData.slice(0, 120)}`,
  )

console.log(`[列表] ${API}`)
console.log(
  `  营业网点 ${branch.total} 个（${branch.pageCount} 页 x ${branch.pageSize} 条）；ATM ${atm.total}；合计 ${totalAll.total}`,
)
const s = branch.items[0]
console.log(`  字段: ${Object.keys(s).join(',')}`)
console.log(
  `  示例: ${JSON.stringify({ name: s.name, address: s.address, phone: s.phone, lng: s.lng, lat: s.lat })}`,
)

// —— 独立复跑：全新进程内不带任何 Cookie 再拉一次第一页 ——
const fresh = await fetchPage({ areaCode: 'p004', branchCode: 'c0007', bankType: 0, page: 1 })
console.log(
  `[复跑] 无 Cookie 重取: rowCount=${fresh.rowCount}，与首次 ${branch.total} ${fresh.rowCount === branch.total ? '一致' : '不一致'}`,
)

const file = saveJson('hxb-shenzhen.json', {
  bank: '华夏银行',
  city: '深圳',
  robots,
  discovered: found,
  listApi: {
    url: API.replace(ORIGIN, ''),
    method: 'GET (JSONP)',
    params:
      'params.areaCode=广东编码, params.branchCode=深圳编码, params.bankType(0网点/1ATM/2全部), page, params.status=1; jsonpcallback=回调名',
    fields:
      'branchName, branchAddress, branchPhone, branchPhone2, branchBusinessTime, branchWeekendopen, branchLongitude, branchDimension, bankType',
    pagination: `${branch.pageSize} 条/页，共 ${branch.pageCount} 页（营业网点）`,
    total: branch.total,
    lngLat: true,
    district: false,
  },
  branches: branch.items,
  atms: atm.items,
  totalAll: totalAll.total,
})
console.log(`\n[结果] 营业网点 ${branch.items.length} 条，ATM ${atm.items.length} 条 -> ${file}`)
