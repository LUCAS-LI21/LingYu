/**
 * 用 OSM 地址标签给待定位小区补坐标（方案 A 的轻量版，不需要自建 Nominatim）。
 *
 * 原理：政府数据给了「街道 + 门牌」，OSM 里若存在带 addr:street / addr:housenumber 的建筑或节点，
 * 就能拿到它的坐标。OSM 数据是 ODbL，可存储（需署名）。
 *
 * 流程：
 *   1. 从 /community-pending 取地址含「XX路/街/道 + 数字号」的小区
 *   2. 按街道分组，整条街一次 Overpass 查询（减少请求数）
 *   3. 命中后写入 coordinate_submission（source=osm），走**人工审核**再转正
 *
 * 用法：
 *   node scripts/geocode-pending-osm.mjs --limit 200 --dry-run
 *   node scripts/geocode-pending-osm.mjs --limit 5000
 *
 * 注意：公共 Overpass 实例限流严格（本项目曾被打回 HTML），脚本默认 3 秒/请求并带退避；
 * 若持续失败，改用自建 Overpass/Nominatim（见 docs/research/coordinate-system-research.md）。
 */

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback
}
const LIMIT = flag('limit', 200)
const DRY = args.includes('--dry-run')
const DELAY = flag('delay', 3000)

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
const BBOX = '22.40,113.70,22.90,114.70'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 从「南山区南头街道学府路58号愉康花园」里抽 street / number */
function parseAddress(address) {
  if (!address) return null
  const m = address.match(/([\u4e00-\u9fa5]{2,10}(?:路|街|大道|道))(\d+)号/)
  if (!m) return null
  return { street: m[1], number: m[2] }
}

async function overpass(query) {
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'poi-intel/0.1 (research; contact: local)',
        },
        body: 'data=' + encodeURIComponent(query),
      })
      const text = await res.text()
      if (!text.trim().startsWith('{')) {
        console.log(`  ! ${endpoint.split('/')[2]} 返回非 JSON（${res.status}），换下一个`)
        continue
      }
      return JSON.parse(text)
    } catch (err) {
      console.log(`  ! ${endpoint.split('/')[2]} 失败：${err.message.slice(0, 60)}`)
    }
    await sleep(1500)
  }
  return null
}

console.log('读取待定位小区…')
const all = []
for (let page = 1; page <= 40; page++) {
  const body = await (await fetch(`${API}/api/v1/community-pending?size=100&page=${page}`)).json()
  const items = body.data?.items || []
  all.push(...items)
  if (items.length < 100 || all.length >= 6000) break
}
const candidates = all
  .map((item) => ({ ...item, parsed: parseAddress(item.address) }))
  .filter((i) => i.parsed)
console.log(`待定位 ${all.length} 个，其中可解析出门牌号 ${candidates.length} 个`)

// 按街道聚合
const byStreet = new Map()
for (const item of candidates.slice(0, LIMIT)) {
  if (!byStreet.has(item.parsed.street)) byStreet.set(item.parsed.street, [])
  byStreet.get(item.parsed.street).push(item)
}
console.log(`涉及 ${byStreet.size} 条街道，准备逐条查询`)

let hits = 0
let queries = 0
const results = []
for (const [street, items] of byStreet) {
  const numbers = [...new Set(items.map((i) => i.parsed.number))]
  const numberFilter = numbers
    .slice(0, 40)
    .map((n) => `["addr:housenumber"="${n}"]`)
    .join('')
  const query = `[out:json][timeout:25];(nwr["addr:street"="${street}"]${numberFilter}(${BBOX}););out center tags;`
  queries++
  const body = await overpass(query)
  if (!body) {
    console.log(`  ✗ ${street} 查询失败，跳过`)
    await sleep(DELAY * 2)
    continue
  }
  const elements = body.elements || []
  for (const el of elements) {
    const coord = el.center ?? { lat: el.lat, lon: el.lon }
    if (!coord || coord.lat === undefined) continue
    const number = el.tags?.['addr:housenumber']
    const matches = items.filter((i) => i.parsed.number === number)
    for (const item of matches) {
      results.push({
        pendingId: item.id,
        name: item.name,
        street,
        number,
        lng: Number(coord.lon.toFixed(6)),
        lat: Number(coord.lat.toFixed(6)),
      })
      hits++
    }
  }
  console.log(`  ${street}: ${items.length} 个小区 → 匹配 ${elements.length} 个 OSM 要素`)
  await sleep(DELAY)
}

console.log(`\n扫描完成：${queries} 条街道查询，命中 ${hits} 个小区`)
console.log('样例：', JSON.stringify(results.slice(0, 3), null, 1))
if (DRY || results.length === 0) {
  console.log('[dry-run] 不写库')
  process.exit(0)
}

// 写入待审队列，由管理员在后台确认后转正
// 注意：/community-pending/{id}/locate 是公开接口，不需要 token
let submitted = 0
for (const row of results) {
  try {
    const res = await fetch(
      `${API}/api/v1/community-pending/${encodeURIComponent(row.pendingId)}/locate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lng: row.lng,
          lat: row.lat,
          note: `OSM 地址匹配：${row.street}${row.number}号`,
        }),
      },
    )
    const body = await res.json()
    if (body.code === 0) submitted++
  } catch {
    // 单条失败不影响整体
  }
}

console.log(
  `已提交 ${submitted} / ${results.length} 条到待审队列（管理员在后台「待定位小区」通过后转正）`,
)
if (submitted < results.length) {
  console.log('未提交的部分多为同名多义或已被标注过，属正常跳过。')
}
