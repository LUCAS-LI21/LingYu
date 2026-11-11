/**
 * 用政府「小区物业项目查询」补小区物业公司，带名称归一化的模糊匹配。
 *
 * 背景：精确「名称+区」匹配只能覆盖约 11%（政府库 12 569 个项目 vs OSM 小区名）。
 * 这里对名称做归一化（去空格/标点/「深圳市」前缀、去「小区/花园/公寓…」后缀），
 * 只在**归一化后对应唯一物业公司**时才写入，避免张冠李戴。
 *
 * 用法：SZ_KEY=... node scripts/match-property-company.mjs [--dry-run] [--limit N]
 */
import { curlJson } from './lib/http.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const KEY = process.env.SZ_KEY
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const LIMIT = Number(
  (() => {
    const i = args.indexOf('--limit')
    return i >= 0 && args[i + 1] ? args[i + 1] : '99999'
  })(),
)

if (!KEY) throw new Error('缺少 SZ_KEY 环境变量')

const SRC = `https://opendata.sz.gov.cn/api/1514671018/1/service.xhtml?page=%d&rows=500&appKey=${KEY}`

/** 归一化：只保留名字主干，用于跨库对齐 */
function norm(name) {
  return String(name || '')
    .replace(/[\s\u3000（）()【】[\]·・_—、,，.。-]/g, '')
    .replace(/^深圳市/, '')
    .replace(/^(罗湖区|福田区|南山区|宝安区|龙岗区|盐田区|龙华区|坪山区|光明区|大鹏新区)/, '')
    .replace(/(小区|花园|公寓|大厦|新村|家园|名苑|广场|新村|社区|苑|庭|阁|居|里|城|府|湾)$/, '')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('拉取政府小区物业项目…')
const companies = new Map() // normName -> Set(company)
let page = 1
let fetched = 0
for (;;) {
  const body = curlJson(SRC.replace('%d', String(page)))
  const rows = body.data || []
  if (rows.length === 0) break
  for (const row of rows) {
    const key = norm(row.PROJECT_NAME)
    const company = String(row.CSP_NAME || '').trim()
    if (!key || !company) continue
    if (!companies.has(key)) companies.set(key, new Set())
    companies.get(key).add(company)
  }
  fetched += rows.length
  if (page % 5 === 0) console.log(`  已拉 ${fetched} 条`)
  if (rows.length < 500) break
  page++
  await sleep(600)
}
console.log(`政府项目 ${fetched} 条，归一化后 ${companies.size} 个键`)

console.log('读取小区列表…')
const all = await (await fetch(`${API}/api/v1/pois?types=community&size=20000`)).json()
const communities = (all.data?.items || []).filter(
  (c) => c.type === 'community' && !c.propertyCompany && c.name,
)
console.log(`缺物业公司的小区 ${communities.length} 个`)

const matched = []
for (const c of communities) {
  const set = companies.get(norm(c.name))
  if (!set || set.size !== 1) continue // 只接受唯一对应，宁缺毋滥
  matched.push({ name: c.name, district: c.district || '', propertyCompany: [...set][0] })
  if (matched.length >= LIMIT) break
}
console.log(`模糊匹配命中 ${matched.length} 个（唯一对应）`)
console.log('样例：', JSON.stringify(matched.slice(0, 3), null, 1))

if (DRY || matched.length === 0) {
  console.log('[dry-run] 不写库')
  process.exit(0)
}

const login = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: process.env.OPERATOR_USERNAME || 'operator',
    password: process.env.OPERATOR_PASSWORD || 'operator123',
  }),
})
const token = (await login.json()).data.token
let written = 0
for (let i = 0; i < matched.length; i += 500) {
  const rows = matched.slice(i, i + 500)
  const res = await fetch(`${API}/api/v1/admin/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      source: '深圳市政府数据开放平台-小区物业项目查询',
      license: '政府公开信息（署名）',
      type: 'community',
      enrich: true,
      rows,
    }),
  })
  const body = await res.json()
  if (body.code !== 0) throw new Error(`导入失败：${body.message}`)
  written += body.data.updated || 0
  console.log(`  批次 ${i / 500 + 1}：更新 ${body.data.updated} / 未变 ${body.data.unchanged}`)
}
console.log(`完成：提交 ${matched.length} 条，实际更新 ${written}`)
