/** 解析官方 PDF「深圳市住宅小区二手住房成交参考价格表」为 CSV（3595 条） */
import { readFileSync, writeFileSync } from 'node:fs'

const raw = readFileSync('data/ref-price-raw.txt', 'utf8')
const rows = []
for (const line of raw.split('\n')) {
  const m = line.match(/^(\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s+(\d{4,6})\s*$/)
  if (!m) continue
  const [, seq, district, street, name, price] = m
  const value = Number(price)
  if (!Number.isFinite(value) || value < 1000 || value > 300000) continue
  rows.push({ seq: Number(seq), district, street, name: name.trim(), price: value })
}
console.log('解析行数:', rows.length)
const districts = {}
for (const r of rows) districts[r.district] = (districts[r.district] || 0) + 1
console.log('行政区分布:', JSON.stringify(districts))
writeFileSync(
  'data/sz-reference-price-2021.csv',
  ['序号,行政区,街道,项目名称,参考价']
    .concat(rows.map((r) => `${r.seq},${r.district},${r.street},${r.name},${r.price}`))
    .join('\n'),
  'utf8',
)
console.log('已写 data/sz-reference-price-2021.csv')
