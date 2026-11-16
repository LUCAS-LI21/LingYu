/**
 * 导入官方「深圳市住宅小区二手住房成交参考价格表」（3,595 个小区）。
 *
 * 来源：深圳市房地产和城市建设发展研究中心 2021-02-08 通告附件
 *   页面 https://zjj.sz.gov.cn/gkmlpt/content/8/8545/mpost_8545737.html
 *   PDF  https://zjj.sz.gov.cn/attachment/0/749/749839/8545737.pdf
 *
 * 这是**官方、全市、小区级**的成交参考价——此前以为「只有罗湖 463 条」是错的：
 * 开放平台上那份是节选，完整表在住建局的通告附件里。
 *
 * 匹配策略（保守，宁缺毋滥）：
 *   1. 精确匹配（名称归一化后完全相同）
 *   2. 模糊：仅允许「多/少一个常见后缀」（花园/苑/大厦/公寓/小区/新村/家园/名苑/广场/城/府/湾/庭/阁/居/里/住宅楼）
 *      遇到「别墅 / 一期 / 二期 / 栋 / 号」这类子区域差异一律跳过——同一小区不同分片价格不同
 *   3. 一个本地小区若命中多个参考价（价格不同）→ 跳过，避免张冠李戴
 *
 * 用法：node scripts/import-ref-price-official.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const DRY = process.argv.includes('--dry-run')
const SOURCE = '深圳市住宅小区二手住房成交参考价格表（2021）'
const SOURCE_URL = 'https://zjj.sz.gov.cn/gkmlpt/content/8/8545/mpost_8545737.html'

const SUFFIXES = [
  '花园',
  '苑',
  '大厦',
  '公寓',
  '小区',
  '新村',
  '家园',
  '名苑',
  '广场',
  '城',
  '府',
  '湾',
  '庭',
  '阁',
  '居',
  '里',
  '住宅楼',
]
const RISKY = /别墅|一期|二期|三期|四期|\d+栋|号楼|片区|分片/

const norm = (s) =>
  String(s || '')
    .replace(/[\s\u3000（）()【】·\-—_、,，.。]/g, '')
    .replace(/^(深圳市|广东省)/, '')
    .replace(/^(罗湖区|福田区|南山区|宝安区|龙岗区|盐田区|龙华区|坪山区|光明区|大鹏新区)/, '')
    .replace(/\(.*?\)|（.*?）/g, '')

const csv = readFileSync('data/sz-reference-price-2021.csv', 'utf8')
  .split('\n')
  .slice(1)
  .filter(Boolean)
const refs = csv
  .map((line) => {
    const parts = line.split(',')
    return {
      district: parts[1],
      street: parts[2],
      name: (parts[3] || '').trim(),
      price: Number(parts[4]),
    }
  })
  .filter((r) => r.name && Number.isFinite(r.price) && r.price > 1000)
console.log(`参考价 ${refs.length} 条`)

const comms = []
for (let page = 1; page <= 10; page++) {
  const body = await (
    await fetch(`${API}/api/v1/pois?types=community&size=500&page=${page}`)
  ).json()
  const items = (body.data?.items || []).filter((c) => c.type === 'community')
  comms.push(...items)
  if (items.length < 500) break
}
console.log(`本地小区 ${comms.length} 个`)

const exact = new Map()
for (const c of comms) if (!exact.has(norm(c.name))) exact.set(norm(c.name), c)
const byKey = comms.map((c) => ({ key: norm(c.name), poi: c }))

/** 返回 {poi, how} 或 null */
function match(ref) {
  const key = norm(ref.name)
  if (exact.has(key)) return { poi: exact.get(key), how: 'exact' }
  if (RISKY.test(ref.name) || key.length < 3) return null
  const cands = byKey.filter((item) => {
    if (!item.key) return false
    const diff = item.key.length - key.length
    if (Math.abs(diff) > 4 || Math.abs(diff) === 0) return false
    const short = diff > 0 ? key : item.key
    const long = diff > 0 ? item.key : key
    if (!long.startsWith(short)) return false
    return SUFFIXES.includes(long.slice(short.length))
  })
  return cands.length === 1 ? { poi: cands[0].poi, how: 'fuzzy' } : null
}

const proposals = new Map()
let exactCount = 0
let fuzzyCount = 0
for (const ref of refs) {
  const found = match(ref)
  if (!found) continue
  if (found.how === 'exact') exactCount++
  else fuzzyCount++
  const id = found.poi.id
  if (!proposals.has(id)) proposals.set(id, { poi: found.poi, refs: [] })
  proposals.get(id).refs.push(ref)
}

// 同一小区命中多个参考价：价格一致才用，否则跳过（子区域价差大）
const chosen = []
let ambiguous = 0
for (const { poi, refs: list } of proposals.values()) {
  const prices = [...new Set(list.map((r) => r.price))]
  if (prices.length > 1) {
    ambiguous++
    continue
  }
  chosen.push({ poi, ref: list[0] })
}
console.log(
  `候选 ${proposals.size} 个（精确 ${exactCount} / 模糊 ${fuzzyCount}），价格冲突跳过 ${ambiguous}，最终 ${chosen.length}`,
)
console.log(
  '样例：',
  JSON.stringify(
    chosen.slice(0, 5).map((c) => ({ db: c.poi.name, ref: c.ref.name, price: c.ref.price })),
    null,
    1,
  ),
)

if (DRY || chosen.length === 0) {
  console.log('[dry-run] 不写库')
  process.exit(0)
}

const esc = (v) =>
  String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
const updates = []
const sources = []
for (const { poi, ref } of chosen) {
  updates.push(
    `UPDATE poi_community SET avg_price = ${ref.price}, avg_price_source = 'gov_reference', updated_at = NOW() WHERE id = '${esc(poi.id)}';`,
  )
  sources.push(
    `INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url) VALUES ('community', '${esc(poi.id)}', 'avg_price', '${esc(SOURCE)}', '${esc(SOURCE_URL)}') ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url), updated_at = NOW();`,
  )
}
writeFileSync(
  'data/ref-price-official.sql',
  `-- 成交参考价（来源：${SOURCE}）\n${updates.join('\n')}\n${sources.join('\n')}\n`,
  'utf8',
)
console.log(`已生成 data/ref-price-official.sql：${updates.length} 条更新`)
