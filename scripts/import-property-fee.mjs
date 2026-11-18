/**
 * 从「深圳市南山区物业管理协会」的中标结果公示里提取**真实物业费**。
 *
 * 为什么可行：住宅小区换物业必须公开招投标，中标公示里明确写
 *   「住宅物业管理费：3.4元/月/平方米」+ 中标人（物业公司）
 * 这是公开公示信息，可引用（署名：深圳市南山区物业管理协会）。
 *
 * 覆盖：南山区 61 条公告（2023 至今），能匹配本地库 13 个小区——
 * 数量不大，但物业费是**真实值**，比哈希生成的演示值强。
 *
 * 用法：node scripts/import-property-fee.mjs [--dry-run]
 */
import { writeFileSync } from 'node:fs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const UA = 'Mozilla/5.0 (compatible; poi-intel-research/0.1)'
const BASE = 'https://sznspa.com'
const DRY = process.argv.includes('--dry-run')
const SOURCE = '深圳市南山区物业管理协会-中标结果公示'
const SOURCE_URL = 'https://sznspa.com/e/action/ListInfo/?classid=17'

const norm = (s) =>
  String(s || '')
    .replace(/[\s\u3000（）()【】·\-—_、,，.。]/g, '')
    .replace(/^(深圳市|广东省)/, '')
    .replace(/^(南山区|福田区|罗湖区|宝安区|龙岗区|盐田区|龙华区|坪山区|光明区|大鹏新区)/, '')
    .replace(/项目$/, '')

async function text(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  return res.text()
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
}

console.log('抓取公告列表…')
const items = []
for (const cls of [14, 17]) {
  for (let page = 1; page <= 3; page++) {
    const html = await text(`${BASE}/e/action/ListInfo/?classid=${cls}&page=${page}`)
    const re = new RegExp(`ShowInfo\\.php\\?classid=${cls}[^"']*id=(\\d+)[^>]*>([^<]{4,80})<`, 'g')
    let m
    while ((m = re.exec(html))) {
      items.push({ id: m[1], cls, title: m[2].trim() })
    }
    await new Promise((r) => setTimeout(r, 400))
  }
}
const uniq = new Map()
for (const it of items) uniq.set(`${it.cls}:${it.id}`, it)
console.log(`列表 ${uniq.size} 条`)

const records = []
for (const it of uniq.values()) {
  if (!/中标结果公示/.test(it.title)) continue
  const html = await text(`${BASE}/e/action/ShowInfo.php?classid=${it.cls}&id=${it.id}`)
  const text2 = stripHtml(html)
  const nameMatch = text2.match(/项目名称\s*([^\s]{4,60}?)(?:招标公告|物业管理|$)/)
  const feeMatch = text2.match(/中标价\s*([^附]{2,200})/)
  const companyMatch = text2.match(/中标人\s*([^\s中]{2,40}(?:公司|中心|事务所))/)
  if (!feeMatch) continue
  const feeText = feeMatch[1].trim()
  // 只取「住宅」口径：商业/幼儿园收费不同，不能混用
  const residential = feeText.match(/住宅[^；;，,。]*?([\d.]+)\s*元/)
  records.push({
    id: it.id,
    title: it.title,
    project: nameMatch ? nameMatch[1] : it.title,
    company: companyMatch ? companyMatch[1] : '',
    fee: residential ? Number(residential[1]) : null,
    feeText,
    url: `${BASE}/e/action/ShowInfo.php?classid=${it.cls}&id=${it.id}`,
  })
  await new Promise((r) => setTimeout(r, 400))
}
console.log(`解析出带收费标准的公告 ${records.length} 条`)
console.log('样例:', JSON.stringify(records.slice(0, 2), null, 1))

// 匹配本地小区
const comms = []
for (let page = 1; page <= 10; page++) {
  const body = await (
    await fetch(`${API}/api/v1/pois?types=community&size=500&page=${page}`)
  ).json()
  const rows = (body.data?.items || []).filter((c) => c.type === 'community')
  comms.push(...rows)
  if (rows.length < 500) break
}
const byName = new Map()
for (const c of comms) byName.set(norm(c.name), c)

const matched = []
for (const rec of records) {
  if (!rec.fee) continue
  const core = rec.project
    .replace(/^深圳市/, '')
    .replace(/^南山区/, '')
    .replace(/项目$/, '')
    .replace(/(物业管理|物业服务).*$/, '')
  const target = byName.get(norm(core))
  if (target) matched.push({ rec, target })
}

console.log(`匹配小区 ${matched.length} 个（本地 ${comms.length}）`)
console.log(
  '样例:',
  JSON.stringify(
    matched.slice(0, 3).map((m) => ({ db: m.target.name, fee: m.rec.fee, company: m.rec.company })),
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
  const sets = [`property_fee = ${rec.fee}`, 'updated_at = NOW()']
  if (rec.company && !target.propertyCompany) sets.push(`property_company = '${esc(rec.company)}'`)
  updates.push(`UPDATE poi_community SET ${sets.join(', ')} WHERE id = '${esc(target.id)}';`)
  sources.push(
    `INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url) VALUES ('community', '${esc(target.id)}', 'property_fee', '${esc(SOURCE)}', '${esc(rec.url)}') ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url), updated_at = NOW();`,
  )
  if (rec.company && !target.propertyCompany) {
    sources.push(
      `INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url) VALUES ('community', '${esc(target.id)}', 'property_company', '${esc(SOURCE)}', '${esc(rec.url)}') ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url), updated_at = NOW();`,
    )
  }
}

writeFileSync(
  'data/property-fee.sql',
  `-- 物业费（来源：${SOURCE}，${SOURCE_URL}）\n${updates.join('\n')}\n${sources.join('\n')}\n`,
  'utf8',
)
console.log(`已生成 data/property-fee.sql：${updates.length} 条更新、${sources.length} 条来源`)
