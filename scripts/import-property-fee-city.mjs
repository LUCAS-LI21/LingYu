/**
 * 从「深圳公共资源交易中心 · 阳光物业招投标平台」提取**真实物业费**。
 *
 * 平台：https://wy.szggzy.com（深圳交易集团，政府背景的公共资源交易平台）
 * 数据：962 条物业招投标公告，涉及全市各区小区
 * 价值：公告正文明确写各业态收费标准，例如
 *   「多层住宅：0.9 元/平方米·月」「高层住宅：2.5 元/平方米·月」「商业：6 元/平方米·月」
 *   中标结果公示里还有中标人（物业公司）
 *
 * 合规：政府公共资源交易平台的公开公示信息，可引用并署名。
 *
 * 用法：
 *   node scripts/import-property-fee-city.mjs --dry-run   # 先看匹配率
 *   node scripts/import-property-fee-city.mjs             # 生成 data/property-fee-city.sql
 */
import { writeFileSync } from 'node:fs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const DRY = process.argv.includes('--dry-run')
const PLATFORM = 'https://wy.szggzy.com'
const SOURCE = '深圳公共资源交易中心-阳光物业招投标平台'
const SOURCE_URL = `${PLATFORM}/jygg/index.html`

const norm = (s) =>
  String(s || '')
    .replace(/[\s\u3000（）()【】·\-—_、,，.。]/g, '')
    .replace(/^(深圳市|广东省)/, '')
    .replace(/^(南山区|福田区|罗湖区|宝安区|龙岗区|盐田区|龙华区|坪山区|光明区|大鹏新区)/, '')
    .replace(/\(.*?\)|（.*?）/g, '')
    .replace(/项目$/, '')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 拉公告列表（分页） */
async function listAll() {
  const out = []
  for (let page = 0; page < 20; page++) {
    const res = await fetch(`${PLATFORM}/cms/api/v1/trade/content/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: 3517,
        fields: [],
        title: null,
        releaseTimeBegin: null,
        releaseTimeEnd: null,
        page,
        size: 100,
        modelId: 1378,
      }),
    })
    const j = await res.json()
    const rows = j.data?.content || []
    out.push(...rows)
    // 接口单页上限 50：用「本页为空」判断结束，不能用 < size
    if (rows.length === 0) break
    await sleep(300)
  }
  return out
}

/** 拉公告详情并返回正文 HTML 字符串 */
async function detail(row) {
  const url = `${PLATFORM}/cms/api/v1/trade/content/ygwy/notice-detail?contentId=${row.id}&projectCode=${encodeURIComponent(row.projectCode || '')}`
  const res = await fetch(url)
  const j = await res.json()
  return JSON.stringify(j.data || {})
}

/** 从正文里抽「业态：X 元/平方米·月」，返回 { 住宅价, 业态明细 } */
function parseFees(html) {
  const text = html.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  const fees = {}
  // 形如：多层住宅：0.9元/平方米·月 / 高层住宅 2.5 元/平方米·月 / 商业：6元/平方米·月
  const re =
    /([\u4e00-\u9fa5A-Za-z0-9（）()]{2,12})\s*[:：]?\s*([\d.]+)\s*元\s*\/?\s*(?:平方米|㎡|m2|平米)[·\s]*月/g
  let m
  while ((m = re.exec(text))) {
    const kind = m[1].replace(/[<>"']/g, '').trim()
    const value = Number(m[2])
    if (!Number.isFinite(value) || value <= 0) continue
    if (!(kind in fees)) fees[kind] = value
  }
  // 只取住宅口径，优先高层
  const pick = (keyword) => {
    for (const [kind, value] of Object.entries(fees)) {
      if (kind.includes(keyword) && kind.includes('住宅')) return value
    }
    return null
  }
  const residential = pick('高层') ?? pick('多层') ?? pick('小高层') ?? pick('住宅')
  return { residential, fees }
}

/** 从正文抽中标人（物业公司） */
function parseCompany(html) {
  const text = html.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  const m = text.match(
    /中标人[^：:]{0,6}[：:]\s*([\u4e00-\u9fa5（）()]{4,40}?(?:公司|中心|事务所))/,
  )
  return m ? m[1].trim() : ''
}

console.log('拉取公告列表…')
const rows = await listAll()
console.log(`公告 ${rows.length} 条`)

// 同一小区的多条公告：中标结果优先于招标公告，后发布的优先
// 评标/开标/补充公告同样带收费表，全部参与解析；中标结果优先级最高
const rank = (r) =>
  /中标结果/.test(r.title) ? 3 : /招标公告/.test(r.title) ? 2 : /评标|开标/.test(r.title) ? 1 : 0
const byProject = new Map()
for (const row of rows) {
  if (!/中标结果|招标公告|评标|开标|补充/.test(row.title)) continue
  const key = norm(row.projectName || row.title)
  const prev = byProject.get(key)
  const score = rank(row) * 1e13 + Number(row.id)
  if (!prev || score > prev.score) byProject.set(key, { row, score })
}
console.log(`按项目去重后 ${byProject.size} 个`)

const records = []
let withFee = 0
for (const { row } of byProject.values()) {
  try {
    const html = await detail(row)
    const { residential, fees } = parseFees(html)
    const company = parseCompany(html)
    if (!residential && !company) continue
    records.push({
      project: (row.projectName || row.title).trim(),
      residential,
      fees,
      company,
      notice: row.title,
      url: `${PLATFORM}/jygg/GGdetails.html?contentId=${row.id}`,
    })
    if (residential) withFee++
  } catch {
    // 单条失败跳过
  }
  await sleep(250)
}
console.log(`解析完成：${records.length} 个项目，其中 ${withFee} 个有住宅物业费`)

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
const byName = new Map()
for (const c of comms) if (!byName.has(norm(c.name))) byName.set(norm(c.name), c)

/**
 * 先精确匹配；失败再模糊兜底：项目名与小区名互相包含、且长度接近、且候选唯一。
 * 例：「恒大成二期花园」↔「恒大成二期」、「南国丽城花园」↔「南国丽城」
 */
const fuzzyList = comms.map((c) => ({ key: norm(c.name), poi: c }))
function findCommunity(project) {
  const key = norm(project)
  const exact = byName.get(key)
  if (exact) return { target: exact, how: 'exact' }
  if (key.length < 3) return null
  const candidates = fuzzyList.filter(
    (item) =>
      item.key &&
      (item.key.includes(key) || key.includes(item.key)) &&
      Math.abs(item.key.length - key.length) <= 6,
  )
  if (candidates.length === 1) return { target: candidates[0].poi, how: 'fuzzy' }
  return null
}

const matched = []
let exactCount = 0
let fuzzyCount = 0
for (const rec of records) {
  const found = findCommunity(rec.project)
  if (!found) continue
  if (!rec.residential && !rec.company) continue
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
    matched
      .slice(0, 4)
      .map((m) => ({ db: m.target.name, fee: m.rec.residential, company: m.rec.company })),
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
  const sets = []
  if (rec.residential) sets.push(`property_fee = ${rec.residential}`)
  if (rec.company && !target.propertyCompany) sets.push(`property_company = '${esc(rec.company)}'`)
  if (sets.length === 0) continue
  sets.push('updated_at = NOW()')
  updates.push(`UPDATE poi_community SET ${sets.join(', ')} WHERE id = '${esc(target.id)}';`)
  const fields = []
  if (rec.residential) fields.push('property_fee')
  if (rec.company && !target.propertyCompany) fields.push('property_company')
  for (const field of fields) {
    sources.push(
      `INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url) VALUES ('community', '${esc(target.id)}', '${field}', '${esc(SOURCE)}', '${esc(rec.url)}') ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url), updated_at = NOW();`,
    )
  }
}

writeFileSync(
  'data/property-fee-city.sql',
  `-- 物业费（来源：${SOURCE} ${SOURCE_URL}）\n${updates.join('\n')}\n${sources.join('\n')}\n`,
  'utf8',
)
console.log(`已生成 data/property-fee-city.sql：${updates.length} 条更新、${sources.length} 条来源`)
