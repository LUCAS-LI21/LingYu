/** 把官方成交参考价挂到待定位小区上（转正时自动带入） */
import { readFileSync, writeFileSync } from 'node:fs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const csv = readFileSync('data/sz-reference-price-2021.csv', 'utf8')
  .split('\n')
  .slice(1)
  .filter(Boolean)
const refs = csv
  .map((l) => {
    const p = l.split(',')
    return { district: p[1], name: (p[3] || '').trim(), price: Number(p[4]) }
  })
  .filter((r) => r.name && Number.isFinite(r.price))

const pending = []
for (let page = 1; page <= 60; page++) {
  const body = await (await fetch(`${API}/api/v1/community-pending?size=100&page=${page}`)).json()
  const items = body.data?.items || []
  pending.push(...items)
  if (items.length < 100) break
}

const SUFFIX =
  /(花园|苑|大厦|公寓|小区|新村|家园|名苑|广场|社区|住宅楼|综合楼|宿舍楼|商住楼|大楼|雅居|豪庭|华庭|山庄|公馆)$/
const norm = (s) =>
  String(s || '')
    .replace(/[\s\u3000（）()【】·\-—_、,，.。]/g, '')
    .replace(/^(深圳市|广东省)/, '')
    .replace(/(罗湖区|福田区|南山区|宝安区|龙岗区|盐田区|龙华区|坪山区|光明区|大鹏新区)/g, '')
const key = (s) => norm(s).replace(SUFFIX, '')

const byKey = new Map()
for (const r of refs) {
  const k = key(r.name)
  if (!k) continue
  if (!byKey.has(k)) byKey.set(k, [])
  byKey.get(k).push(r)
}

const esc = (v) =>
  String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
const lines = []
for (const p of pending) {
  if (p.avg_price) continue
  const d = String(p.district || '').replace(/区$/, '')
  const cands = (byKey.get(key(p.name)) || []).filter(
    (r) => !d || String(r.district).includes(d) || d.includes(r.district),
  )
  if (cands.length !== 1) continue
  lines.push(
    `UPDATE community_pending SET avg_price = ${cands[0].price}, avg_price_source = 'gov_reference' WHERE id = '${esc(p.id)}';`,
  )
}
writeFileSync('data/pending-price.sql', lines.join('\n') + '\n', 'utf8')
console.log(`待定位 ${pending.length} | 挂上参考价 ${lines.length}`)
