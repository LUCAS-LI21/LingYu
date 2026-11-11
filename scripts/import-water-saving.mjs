/**
 * 导入「节水型小区信息」（政府开放数据 29200/01400401，794 条）。
 *
 * 字段：XQMC 小区名称 / DZ 地址（794 条里 223 条有）/ HPND 获评年度
 * 用途：
 *   1) 给已有小区补「节水型小区获评年度」（新字段 water_saving_year）
 *   2) 若小区地址为空且政府库有地址，顺便补地址（enrich 默认只填空字段）
 *
 * 匹配：名称归一化后与本地小区唯一对应才写（同物业公司匹配策略）。
 * 用法：SZ_KEY=... node scripts/import-water-saving.mjs [--dry-run]
 */
import { curlJson } from './lib/http.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const KEY = process.env.SZ_KEY
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
if (!KEY) throw new Error('缺少 SZ_KEY')

const norm = (s) =>
  String(s || '')
    .replace(/[\s\u3000（）()【】·・\-—_、,，.。]/g, '')
    .replace(/^深圳市/, '')
    .replace(/^(罗湖区|福田区|南山区|宝安区|龙岗区|盐田区|龙华区|坪山区|光明区|大鹏新区)/, '')
    .replace(/(小区|花园|公寓|大厦|新村|家园|名苑|广场|社区|苑|庭|阁|居|里|城|府|湾)$/, '')

console.log('拉取节水型小区…')
const rows = []
for (let page = 1; page <= 4; page++) {
  const body = curlJson(
    `https://opendata.sz.gov.cn/api/1997018756/1/service.xhtml?page=${page}&rows=300&appKey=${KEY}`,
  )
  const list = body.data || []
  rows.push(...list)
  if (list.length < 300) break
  await new Promise((r) => setTimeout(r, 700))
}
console.log(
  `拿到 ${rows.length} 条，其中带地址 ${rows.filter((r) => r.DZ && r.DZ.trim()).length} 条`,
)

console.log('读取本地小区…')
const all = await (await fetch(`${API}/api/v1/pois?types=community&size=20000`)).json()
const communities = (all.data.items || []).filter((c) => c.type === 'community')
const byName = new Map()
for (const c of communities) {
  const k = norm(c.name)
  if (!byName.has(k)) byName.set(k, [])
  byName.get(k).push(c)
}

const payload = []
let withAddress = 0
for (const row of rows) {
  const key = norm(row.XQMC)
  const hits = byName.get(key)
  if (!hits || hits.length !== 1) continue // 同名多义不写
  const c = hits[0]
  const year = Number(row.HPND) || null
  const address = (row.DZ || '').trim()
  if (!year && !address) continue
  const item = { name: c.name, district: c.district || '', waterSavingYear: year }
  // 只在本地地址为空时带地址，避免覆盖已有数据
  if (address && !c.address) {
    item.address = address
    withAddress++
  }
  payload.push(item)
}

console.log(`匹配到 ${payload.length} 个小区（唯一对应），其中补地址 ${withAddress} 个`)
console.log('样例：', JSON.stringify(payload.slice(0, 3), null, 1))
if (DRY || payload.length === 0) {
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
let updated = 0
for (let i = 0; i < payload.length; i += 500) {
  const batch = payload.slice(i, i + 500)
  const res = await fetch(`${API}/api/v1/admin/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      source: '深圳市政府数据开放平台-节水型小区信息',
      license: '政府公开信息（署名）',
      type: 'community',
      enrich: true,
      rows: batch,
    }),
  })
  const body = await res.json()
  if (body.code !== 0) throw new Error(`导入失败：${body.message}`)
  updated += body.data.updated || 0
  console.log(`  批次 ${i / 500 + 1}：更新 ${body.data.updated} / 未变 ${body.data.unchanged}`)
}
console.log(`完成：提交 ${payload.length}，实际更新 ${updated}`)
