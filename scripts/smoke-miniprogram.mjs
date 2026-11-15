/**
 * 小程序端接口冒烟：模拟小程序会调用的公共接口，逐条打印状态与关键字段。
 *
 * 小程序没有 CORS 限制，但要求：JSON + UTF-8、统一的 {code,message,data} 信封、
 * 坐标用 gcjLng/gcjLat 上地图、列表分页不超过上限。
 *
 * 用法：node scripts/smoke-miniprogram.mjs [baseUrl]
 *   默认 http://127.0.0.1:8080，手机联调可用 http://<局域网IP>:8080
 */
const BASE = process.argv[2] || process.env.API_BASE || 'http://127.0.0.1:8080'

let pass = 0
let fail = 0

async function check(name, path, options = {}, assert) {
  const url = `${BASE}${path}`
  try {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    })
    const body = await res.json()
    const ok = res.ok && body.code === 0 && (assert ? assert(body.data) : true)
    console.log(`${ok ? '✓' : '✗'} ${name.padEnd(28)} ${res.status} ${path}`)
    if (!ok) {
      console.log('   返回：', JSON.stringify(body).slice(0, 200))
      fail++
    } else {
      pass++
    }
    return ok ? body.data : null
  } catch (err) {
    console.log(`✗ ${name.padEnd(28)} 异常 ${err.message}`)
    fail++
    return null
  }
}

console.log(`冒烟目标：${BASE}\n`)

const meta = await check('元信息', '/api/v1/meta', {}, (d) =>
  Boolean(d.coord && d.endpoints?.length),
)
if (meta) {
  const gcj = meta.coord.gcjFields.join(',')
  console.log(`  坐标约定：存储 ${meta.coord.storage} / 地图 ${meta.coord.chineseMap}（${gcj}）`)
  console.log(`  接口清单：${meta.endpoints.length} 条`)
}

await check('健康检查', '/api/v1/health', {}, (d) => d.status === 'ok')

const list = await check(
  '列表（首页）',
  '/api/v1/pois?types=bank,community&size=5',
  {},
  (d) => d.items?.length > 0,
)
if (list) {
  const sample = list.items.find((item) => item.gcjLng && item.gcjLat)
  console.log(
    `  样例：${sample?.name} → WGS(${sample?.lng},${sample?.lat}) / GCJ(${sample?.gcjLng},${sample?.gcjLat})`,
  )
}

// 单独取小区样本：默认排序下首屏可能全是银行，会导致小区详情类接口没被覆盖
const communityList = await check('小区列表', '/api/v1/pois?types=community&size=3', {}, (d) =>
  d.items?.some((item) => item.type === 'community'),
)
const community = communityList?.items?.find((item) => item.type === 'community')
const bank = list?.items?.find((item) => item.type === 'bank')

if (community) {
  await check(
    '详情（小区）',
    `/api/v1/pois/${encodeURIComponent(community.id)}`,
    {},
    (d) => d.name === community.name,
  )
  await check(
    '最近银行 Top3',
    `/api/v1/pois/${encodeURIComponent(community.id)}/nearest-banks?limit=3`,
    {},
    (d) => Array.isArray(d.items),
  )
  await check('字段级来源', `/api/v1/pois/${encodeURIComponent(community.id)}/sources`, {}, (d) =>
    Array.isArray(d),
  )
}

if (bank) {
  await check(
    '银行周边小区',
    `/api/v1/pois/${encodeURIComponent(bank.id)}/nearby-communities?radius=1000&limit=3`,
    {},
    (d) => Array.isArray(d.items),
  )
}

await check(
  '周边查询',
  '/api/v1/pois/nearby?lng=114.06&lat=22.54&radius=1000&limit=3',
  {},
  (d) => d.items?.length > 0,
)
await check('统计', '/api/v1/stats', {}, (d) => d.bank > 0 && d.community > 0)
await check(
  '区域维度',
  '/api/v1/stats',
  {},
  (d) => Array.isArray(d.byDistrict) && d.byDistrict.length > 0,
)

const pending = await check(
  '待定位小区',
  '/api/v1/community-pending?size=2',
  {},
  (d) => d.total > 0 && Array.isArray(d.items),
)

if (pending?.items?.[0]) {
  const target = pending.items[0]
  await check(
    '待定位小区地图中心',
    `/api/v1/community-pending/hint?district=${encodeURIComponent(target.district)}`,
    {},
    (d) => Number.isFinite(d.lng) && Number.isFinite(d.gcjLng),
  )
}

await check('存量住宅用地', '/api/v1/land-parcels?limit=2', {}, (d) => d.total > 0)

// 边界：非法坐标应被拒绝（小程序要能拿到明确错误）
const bad = await fetch(`${BASE}/api/v1/pois/nearby?lng=NaN&lat=22.5&radius=1000`)
await bad.json().catch(() => ({}))
const badOk = bad.status === 400
console.log(
  `${badOk ? '✓' : '✗'} ${'非法坐标被拒绝'.padEnd(28)} ${bad.status} /pois/nearby?lng=NaN`,
)
if (badOk) pass++
else fail++

console.log(`\n结果：通过 ${pass}，失败 ${fail}`)
process.exit(fail === 0 ? 0 : 1)
