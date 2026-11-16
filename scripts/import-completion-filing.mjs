/**
 * 导入「深圳市竣工验收备案信息」（29200/01900874，5,603 条，无条件开放）。
 *
 * 这份数据解决的是此前认为「找不到」的字段：
 *   ITEM_NAME     项目名称      → 匹配本地小区
 *   PRJ_LOCATION  工程地址      → 补全缺失地址
 *   LOG_DATE      备案日期      → 取年份作为**建成年份**（竣工备案年份）
 *   CONST_NAME    建设单位      → 开发商/建设方（写入 developer）
 *   MEASURE       建筑面积      → 仅记录，不入表
 *
 * 注意：备案日期是「竣工验收备案」日期，通常比实际竣工晚数月，
 * 作为建成年份属于可接受的近似，界面标注「按竣工备案年份」。
 *
 * 前提：接口需订阅 https://opendata.sz.gov.cn/data/api/toApiDetails/29200_01900874
 *
 * 用法：SZ_KEY=... node scripts/import-completion-filing.mjs [--dry-run]
 */
import { writeFileSync } from 'node:fs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const KEY = process.env.SZ_KEY
if (!KEY) throw new Error('缺少 SZ_KEY')

const DRY = process.argv.includes('--dry-run')
const BASE = 'https://opendata.sz.gov.cn/api/1643888517/1/service.xhtml'
const ROWS = 500
const SOURCE = '深圳市政府数据开放平台-竣工验收备案信息'
const SOURCE_URL = 'https://opendata.sz.gov.cn/data/dataSet/toDataDetails/29200_01900874'

const norm = (s) =>
  String(s || '')
    .replace(/[\s\u3000（）()【】·\-—_、,，.。]/g, '')
    .replace(/^(深圳市|广东省)/, '')
    .replace(/^(南山区|福田区|罗湖区|宝安区|龙岗区|盐田区|龙华区|坪山区|光明区|大鹏新区)/, '')
    .replace(/\(.*?\)|（.*?）/g, '')
    .replace(/项目$/, '')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('拉取竣工验收备案…')
const rows = []
for (let page = 1; page <= 20; page++) {
  const res = await fetch(`${BASE}?page=${page}&rows=${ROWS}&appKey=${KEY}`)
  const body = await res.json()
  const list = body.data || []
  rows.push(...list)
  if (list.length < ROWS) break
  await sleep(400)
}
console.log(`拿到 ${rows.length} 条`)

// 同一项目可能有多期/多栋备案：取最早的备案年份作为小区建成年份
const byProject = new Map()
for (const row of rows) {
  const name = (row.ITEM_NAME || '').trim()
  if (!name) continue
  const date = String(row.LOG_DATE || '').slice(0, 4)
  const year = Number(date)
  if (!Number.isFinite(year) || year < 1900 || year > 2030) continue
  const key = norm(name)
  const prev = byProject.get(key)
  if (!prev) {
    byProject.set(key, {
      name,
      year,
      address: (row.PRJ_LOCATION || '').trim(),
      developer: (row.CONST_NAME || '').trim(),
    })
  } else {
    if (year < prev.year) prev.year = year
    if (!prev.address && row.PRJ_LOCATION) prev.address = String(row.PRJ_LOCATION).trim()
    if (!prev.developer && row.CONST_NAME) prev.developer = String(row.CONST_NAME).trim()
  }
}
console.log(`按项目去重后 ${byProject.size} 个`)

// 匹配本地小区
const comms = []
for (let page = 1; page <= 10; page++) {
  const body = await (
    await fetch(`${API}/api/v1/pois?types=community&size=500&page=${page}`)
  ).json()
  const items = (body.data?.items || []).filter((c) => c.type === 'community')
  comms.push(...items)
  if (items.length < 500) break
}
const exact = new Map()
for (const c of comms) if (!exact.has(norm(c.name))) exact.set(norm(c.name), c)

const fuzzyList = comms.map((c) => ({ key: norm(c.name), poi: c }))
function find(projectKey) {
  if (exact.has(projectKey)) return { target: exact.get(projectKey), how: 'exact' }
  if (projectKey.length < 3) return null
  const cands = fuzzyList.filter(
    (item) =>
      item.key &&
      (item.key.includes(projectKey) || projectKey.includes(item.key)) &&
      Math.abs(item.key.length - projectKey.length) <= 6,
  )
  return cands.length === 1 ? { target: cands[0].poi, how: 'fuzzy' } : null
}

const matched = []
let exactCount = 0
let fuzzyCount = 0
for (const [key, rec] of byProject) {
  const found = find(key)
  if (!found) continue
  if (found.how === 'exact') exactCount++
  else fuzzyCount++
  matched.push({ rec, target: found.target, how: found.how })
}
console.log(
  `本地小区 ${comms.length} 个，匹配 ${matched.length} 个（精确 ${exactCount} / 模糊 ${fuzzyCount}）`,
)
console.log(
  '样例：',
  JSON.stringify(
    matched.slice(0, 5).map((m) => ({ db: m.target.name, year: m.rec.year, dev: m.rec.developer })),
    null,
    1,
  ),
)

if (DRY || matched.length === 0) {
  console.log('[dry-run] 不写库')
  process.exit(0)
}

const esc = (v) =>
  String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
const updates = []
const sources = []
for (const { rec, target } of matched) {
  const sets = [`built_year = ${rec.year}`]
  if (rec.developer && !target.developer) sets.push(`developer = '${esc(rec.developer)}'`)
  if (!target.address && rec.address) sets.push(`address = '${esc(rec.address)}'`)
  sets.push('updated_at = NOW()')
  updates.push(`UPDATE poi_community SET ${sets.join(', ')} WHERE id = '${esc(target.id)}';`)
  sources.push(
    `INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url) VALUES ('community', '${esc(target.id)}', 'built_year', '${esc(SOURCE)}', '${esc(SOURCE_URL)}') ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url), updated_at = NOW();`,
  )
  if (rec.developer && !target.developer) {
    sources.push(
      `INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url) VALUES ('community', '${esc(target.id)}', 'developer', '${esc(SOURCE)}', '${esc(SOURCE_URL)}') ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url), updated_at = NOW();`,
    )
  }
}

writeFileSync(
  'data/completion-filing.sql',
  `-- 建成年份 / 建设单位（来源：${SOURCE}）\n${updates.join('\n')}\n${sources.join('\n')}\n`,
  'utf8',
)
console.log(`已生成 data/completion-filing.sql：${updates.length} 条更新、${sources.length} 条来源`)
