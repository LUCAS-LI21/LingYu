/**
 * 导入「深圳市小区租赁参考价格」（29200/01903546，4 319 条，无条件开放）。
 *
 * 为什么重要：这是目前找到的**唯一同时带地址与坐标的官方小区级数据**。
 * 字段（来自平台数据项）：
 *   PARK_NAME 小区名称 / QU_NAME 行政区 / STREET 街道 / ADDRESS 地址
 *   DC_PRICE 多层租金 / GC_PRICE 高层租金 / DMD_PRICE 低密度租金
 *   GEOM 地理坐标（2000 国家大地坐标系 CGCS2000，与 WGS-84 差 <1m，可直接用）
 *
 * 用途（按优先级）：
 *   1. 给匹配上的小区补**真实租金**（不是均价，但至少是真实价格信号）
 *   2. 给地址为空的小区补地址
 *   3. 给缺坐标的小区补坐标（来自政府数据，可合法存储）
 *
 * 前提：接口需要订阅（错误码 10001）。
 *   https://opendata.sz.gov.cn/data/api/toApiDetails/29200_01903546
 *
 * 用法：SZ_KEY=... node scripts/import-rent-reference.mjs [--dry-run]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { curlJson } from './lib/http.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const KEY = process.env.SZ_KEY
if (!KEY) throw new Error('缺少 SZ_KEY')

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const BASE = 'https://opendata.sz.gov.cn/api/29200_01903546/1/service.xhtml'
const ROWS = 500

const norm = (s) =>
  String(s || '')
    .replace(/[\s\u3000（）()【】·\-—_、,，.。]/g, '')
    .replace(/^深圳市/, '')
    .replace(/^(罗湖区|福田区|南山区|宝安区|龙岗区|盐田区|龙华区|坪山区|光明区|大鹏新区)/, '')
    .replace(/(小区|花园|公寓|大厦|新村|家园|名苑|广场|社区|苑|庭|阁|居|里|城|府|湾)$/, '')

/** GEOM 形如 POINT(113.9 22.5) 或 WKT；解析出经纬度 */
function parseGeom(geom) {
  if (!geom) return null
  const m = String(geom).match(/POINT\s*\(\s*([\d.]+)\s+([\d.]+)\s*\)/i)
  if (!m) return null
  const lng = Number(m[1])
  const lat = Number(m[2])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return { lng, lat }
}

console.log('读取本地小区…')
const all = []
for (let page = 1; page <= 40; page++) {
  const body = await (
    await fetch(`${API}/api/v1/pois?types=community&size=500&page=${page}`)
  ).json()
  const items = body.data?.items || []
  all.push(...items)
  if (items.length < 500) break
}
const communities = all.filter((c) => c.type === 'community')
const byKey = new Map()
for (const c of communities) {
  const key = `${norm(c.name)}|${c.district || ''}`
  if (!byKey.has(key)) byKey.set(key, c)
}
console.log(
  `本地小区 ${communities.length} 个，缺地址 ${communities.filter((c) => !c.address).length} 个`,
)

console.log('拉取租赁参考价格…')
const rows = []
for (let page = 1; page <= 20; page++) {
  const body = curlJson(`${BASE}?page=${page}&rows=${ROWS}&appKey=${KEY}`)
  const list = body.data || []
  rows.push(...list)
  if (list.length < ROWS) break
  await new Promise((r) => setTimeout(r, 600))
}
console.log(`拿到 ${rows.length} 条`)

const matched = []
let hitRent = 0
let hitAddress = 0
let hitCoord = 0
for (const row of rows) {
  const key = `${norm(row.PARK_NAME)}|${(row.QU_NAME || '').trim()}`
  const target = byKey.get(key)
  if (!target) continue
  const geom = parseGeom(row.GEOM)
  const rent = {
    dc: Number(row.DC_PRICE) || null,
    gc: Number(row.GC_PRICE) || null,
    dmd: Number(row.DMD_PRICE) || null,
  }
  if (!rent.dc && !rent.gc && !rent.dmd && !geom) continue
  matched.push({ target, row, geom, rent })
  if (rent.dc || rent.gc || rent.dmd) hitRent++
  if (!target.address && row.ADDRESS) hitAddress++
  if (!target.lng && geom) hitCoord++
}

console.log(
  `匹配 ${matched.length} 个小区（租金 ${hitRent} / 补地址 ${hitAddress} / 补坐标 ${hitCoord}）`,
)
console.log(
  '样例：',
  JSON.stringify(
    matched.slice(0, 2).map((m) => ({
      name: m.target.name,
      rent: m.rent,
      geom: m.geom,
      address: m.row.ADDRESS,
    })),
    null,
    1,
  ),
)

if (DRY || matched.length === 0) {
  console.log('[dry-run] 不写库')
  process.exit(0)
}

// 生成 SQL：只补空字段，不覆盖已有值
const esc = (v) =>
  String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
const lines = matched
  .map(({ target, row, geom, rent }) => {
    const sets = []
    if (rent.dc) sets.push(`rent_dc = ${rent.dc}`)
    if (rent.gc) sets.push(`rent_gc = ${rent.gc}`)
    if (rent.dmd) sets.push(`rent_dmd = ${rent.dmd}`)
    if (!target.address && row.ADDRESS) sets.push(`address = '${esc(row.ADDRESS)}'`)
    if (!target.lng && geom) {
      sets.push(`lng = ${geom.lng}`)
      sets.push(`lat = ${geom.lat}`)
    }
    if (sets.length === 0) return null
    sets.push('updated_at = NOW()')
    return `UPDATE poi_community SET ${sets.join(', ')} WHERE id = '${esc(target.id)}';`
  })
  .filter(Boolean)

// 字段来源留痕
const fieldLines = []
for (const { target, row, geom, rent } of matched) {
  const fields = []
  if (rent.dc || rent.gc || rent.dmd) fields.push('rent_reference')
  if (!target.address && row.ADDRESS) fields.push('address')
  if (!target.lng && geom) fields.push('lng', 'lat')
  for (const field of fields) {
    fieldLines.push(
      `INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url) ` +
        `VALUES ('community', '${esc(target.id)}', '${field}', '深圳市政府数据开放平台-小区租赁参考价格', ` +
        `'https://opendata.sz.gov.cn/data/dataSet/toDataDetails/29200_01903546') ` +
        `ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url), updated_at = NOW();`,
    )
  }
}

mkdirSync('data', { recursive: true })
const sql = `-- 小区租赁参考价格导入（来源：深圳市政府数据开放平台 29200/01903546）\n${lines.join('\n')}\n${fieldLines.join('\n')}\n`
writeFileSync('data/rent-reference.sql', sql, 'utf8')
console.log(
  `已生成 data/rent-reference.sql：${lines.length} 条更新、${fieldLines.length} 条来源记录`,
)
console.log('执行：mysql -u root -proot poi_intel < data/rent-reference.sql')
