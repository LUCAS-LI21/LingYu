/**
 * 小区字段补全（离线源，不依赖网络）：
 *   1. 存量住宅用地（land_parcel）→ 建设单位（developer）、位置描述（address）
 *   2. 待定位小区库（community_pending）→ 地址（同一小区在两条链路里名称一致时）
 *
 * 匹配规则与其它脚本一致：去后缀 + 行政区一致 + 候选唯一，宁缺毋滥。
 *
 * 用法：node scripts/backfill-community-address.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const DRY = process.argv.includes('--dry-run')

const SUFFIX =
  /(花园|苑|大厦|公寓|小区|新村|家园|名苑|广场|社区|住宅楼|综合楼|宿舍楼|商住楼|大楼|雅居|豪庭|华庭|山庄|公馆)$/
const norm = (s) =>
  String(s || '')
    .replace(/[\s\u3000（）()【】·\-—_、,，.。]/g, '')
    .replace(/^(深圳市|广东省)/, '')
    .replace(/(罗湖区|福田区|南山区|宝安区|龙岗区|盐田区|龙华区|坪山区|光明区|大鹏新区)/g, '')
const key = (s) => norm(s).replace(SUFFIX, '')
const dshort = (s) => String(s || '').replace(/区$/, '')

const comms = []
for (let page = 1; page <= 10; page++) {
  const body = await (
    await fetch(`${API}/api/v1/pois?types=community&size=500&page=${page}`)
  ).json()
  const items = (body.data?.items || []).filter((c) => c.type === 'community')
  comms.push(...items)
  if (items.length < 500) break
}
console.log(`本地小区 ${comms.length}`)

const esc = (v) =>
  String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
const updates = []
const sources = []
const touched = new Set()

function plan(poi, setClauses, fields, source, sourceUrl) {
  if (setClauses.length === 0) return
  updates.push(
    `UPDATE poi_community SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = '${esc(poi.id)}';`,
  )
  for (const field of fields) {
    sources.push(
      `INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url) VALUES ('community', '${esc(poi.id)}', '${field}', '${esc(source)}', '${esc(sourceUrl)}') ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url), updated_at = NOW();`,
    )
  }
  touched.add(poi.id)
}

// ---- 1. 存量住宅用地 ----
let landDev = 0
let landAddr = 0
if (readFileSync && process.argv.length >= 0) {
  try {
    const parcels = JSON.parse(readFileSync('data/parcels.json', 'utf8'))
    const byKey = new Map()
    for (const c of comms) {
      const k = key(c.name)
      if (!k) continue
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(c)
    }
    for (const p of parcels) {
      if (!p.project) continue
      const cands = byKey.get(key(p.project)) || []
      if (cands.length !== 1) continue
      const c = cands[0]
      const sets = []
      const fields = []
      if (p.developer && !c.developer) {
        sets.push(`developer = '${esc(p.developer)}'`)
        fields.push('developer')
        landDev++
      }
      if (!c.address && p.street && p.location) {
        sets.push(`address = '${esc(`深圳市${p.street}${p.location}`)}'`)
        fields.push('address')
        landAddr++
      }
      plan(
        c,
        sets,
        fields,
        '深圳市政府数据开放平台-存量住宅用地',
        'https://opendata.sz.gov.cn/data/dataSet/toDataDetails/29200_01900198',
      )
    }
  } catch (err) {
    console.log('地块数据读取失败：', err.message)
  }
}
console.log(`存量用地：补建设单位 ${landDev}，补地址 ${landAddr}`)

// ---- 2. 待定位小区库 ----
const pending = []
for (let page = 1; page <= 60; page++) {
  const body = await (await fetch(`${API}/api/v1/community-pending?size=100&page=${page}`)).json()
  const items = body.data?.items || []
  pending.push(...items)
  if (items.length < 100) break
}
const byKey = new Map()
for (const p of pending) {
  const k = key(p.name)
  if (!k || !p.address) continue
  if (!byKey.has(k)) byKey.set(k, [])
  byKey.get(k).push(p)
}
let pendAddr = 0
for (const c of comms) {
  if (c.address) continue
  const d = dshort(c.district)
  const cands = (byKey.get(key(c.name)) || []).filter(
    (p) => !d || dshort(p.district).includes(d) || d.includes(dshort(p.district)),
  )
  if (cands.length !== 1) continue
  plan(
    c,
    [`address = '${esc(cands[0].address)}'`],
    ['address'],
    '深圳市政府数据开放平台-物业管理区域基础信息',
    'https://opendata.sz.gov.cn/data/dataSet/toDataDetails/29200_01903550',
  )
  pendAddr++
}
console.log(`待定位库：补地址 ${pendAddr}`)

console.log(`合计影响小区 ${touched.size} 个，SQL 语句 ${updates.length} 条`)

if (DRY || updates.length === 0) {
  console.log('[dry-run] 不写库')
  process.exit(0)
}
writeFileSync(
  'data/backfill-community.sql',
  updates.join('\n') + '\n' + sources.join('\n') + '\n',
  'utf8',
)
console.log('已写 data/backfill-community.sql')
