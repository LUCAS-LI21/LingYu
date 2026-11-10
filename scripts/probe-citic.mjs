// 中信银行深圳网点接口探针
// 发现路径：https://etrade.citicbank.com/portalweb/html/map.html
//   切换城市 -> 省 广东 -> 市 深圳市 -> 查询
//   POST /portalweb/pq/branchSearch.htm
//     cpLng, cpLat, cityName=深圳市, pageFlag=0, tcstNo=, userId=, pwdControlFlag=0, responseFormat=JSON, random
// 用法：node scripts/probe-citic.mjs
// 限速：相邻主动请求 >= 1100ms
import {
  Pacer,
  saveJson,
  checkRobots,
  fetchText,
  launch,
  restrictToBank,
  recordXhr,
} from './lib/bank-probe.mjs'

const ORIGIN = 'https://etrade.citicbank.com'
const PAGE = `${ORIGIN}/portalweb/html/map.html`
const API = `${ORIGIN}/portalweb/pq/branchSearch.htm`
const pace = new Pacer(1100)

async function branchSearch(cityName, lng = '114.064552', lat = '22.548456') {
  await pace.wait()
  const body = new URLSearchParams({
    cpLng: lng,
    cpLat: lat,
    cityName,
    pageFlag: '0',
    tcstNo: '',
    userId: '',
    pwdControlFlag: '0',
    responseFormat: 'JSON',
    random: String(Math.floor(Math.random() * 9000) + 1000),
  }).toString()
  const text = await fetchText(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: PAGE,
    },
    body,
    referer: PAGE,
  })
  return JSON.parse(text)
}

async function discover() {
  const { browser, ctx, page, close } = await launch()
  await restrictToBank(ctx, 'citicbank.com', ['map.baidu.com'])
  const xhr = []
  recordXhr(page, (u) => /branchSearch|provinceCity/.test(u), xhr)
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)
  await page.locator('#bank_change_city').click()
  await page.waitForTimeout(600)
  await page.locator('#cityOne').click()
  await page.waitForTimeout(400)
  await page.locator('#province').getByText('广东').first().click()
  await page.waitForTimeout(1200)
  await page.locator('#cityTwo').click()
  await page.waitForTimeout(400)
  await page.locator('#city').getByText('深圳市').first().click()
  await page.waitForTimeout(800)
  await page.locator('#searchByCity').click()
  await page.waitForTimeout(4000)
  const shown = (
    await page
      .locator('#conMap')
      .innerText()
      .catch(() => '')
  ).slice(0, 200)
  await close()
  return { page: PAGE, shown, districtFilter: '无（仅省/市），无区级下拉', xhr }
}

function normalize(d) {
  return (d.content?.resultList || []).map((b) => ({
    branchNo: b.branchNo,
    name: b.branchName,
    address: b.branchAdd,
    phone: b.branchTel,
    hours: b.bsnTime,
    lng: b.branchLng,
    lat: b.branchLat,
  }))
}

// —— 主流程 ——
const robots = await checkRobots(ORIGIN, '/portalweb/pq')
console.log(
  `[robots] ${robots.url} -> ${robots.status}${robots.sample.trim().startsWith('<') ? '（返回 HTML，非 robots）' : ''}`,
)
const wwwRobots = await checkRobots('https://www.citicbank.com', '/')
console.log(`[robots] ${wwwRobots.url} -> ${wwwRobots.status}`)

const found = await discover()
const first = await branchSearch('深圳市')
const items = normalize(first)
const total = first.totalCount

console.log(`[发现] ${found.page}`)
console.log(`  捕获 XHR ${found.xhr.length} 条:`)
for (const x of found.xhr) {
  console.log(`   ${x.status} ${x.method} ${x.url.split('?')[0]}`)
  if (x.postData) console.log(`      post: ${x.postData}`)
  console.log(`      body: ${x.body.replace(/\s+/g, ' ').slice(0, 160)}`)
}

console.log(`[列表] POST ${API}`)
console.log(
  `  参数: ${JSON.stringify({ cpLng: '114.064552', cpLat: '22.548456', cityName: '深圳市', pageFlag: 0, responseFormat: 'JSON' })}`,
)
console.log(
  `  网点 ${total} 个，本次返回 ${items.length} 条（pageCount=${first.pageCount}，无服务端分页）`,
)
console.log(`  字段: branchNo, branchName, branchAdd, branchTel, bsnTime, branchLng, branchLat`)
const s = items[0]
console.log(
  `  示例: ${JSON.stringify({ name: s.name, address: s.address, phone: s.phone, hours: s.hours, lng: s.lng, lat: s.lat })}`,
)

// —— 独立复跑：无 Cookie 第二次请求 ——
const again = await branchSearch('深圳市')
console.log(
  `[复跑] 无 Cookie 重取: totalCount=${again.totalCount}，与首次 ${total} ${again.totalCount === total ? '一致' : '不一致'}`,
)

const file = saveJson('citic-shenzhen.json', {
  bank: '中信银行',
  city: '深圳',
  robots,
  discovered: found,
  listApi: {
    url: API.replace(ORIGIN, ''),
    method: 'POST application/x-www-form-urlencoded',
    params:
      'cpLng, cpLat, cityName=深圳市, pageFlag=0, tcstNo=, userId=, pwdControlFlag=0, responseFormat=JSON, random',
    fields: 'branchNo, branchName, branchAdd, branchTel, bsnTime, branchLng, branchLat',
    pagination: `无（一次返回全部 ${items.length} 条；pageCount=${first.pageCount}）`,
    total,
    lngLat: true,
    district: false,
  },
  branches: items,
})
console.log(`\n[结果] ${items.length} 条 -> ${file}`)
