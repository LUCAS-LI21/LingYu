/**
 * 政府开放数据 CSV 导入器。
 *
 * 为什么是"人工下载 + 脚本导入"：深圳市政府数据开放平台的文件下载需要登录
 * （未登录返回 {"result":"false","message":"请登陆后再试"}），
 * 因此由用户登录下载官方文件后，用本脚本按列映射导入。
 *
 * 平台服务条款允许存储与使用，但要求署名、禁止转让/再分发，故导入时写入
 * source=深圳市政府数据开放平台 与 license=政府公开信息（署名）。
 *
 * 用法：
 *   node scripts/import-opendata.mjs --file 小区物业.csv --type community \
 *        --map "小区名称=name,地址=address,经度=lng,纬度=lat"
 *
 * 可选：--source / --license / --batch / --overwrite / --dry-run
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
function flag(name, fallback = '') {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const hasFlag = (name) => args.includes(`--${name}`)

const file = flag('file')
const type = flag('type', 'bank')
const source = flag('source', '深圳市政府数据开放平台')
const license = flag('license', '政府公开信息（署名）')
const batchSize = Number(flag('batch', '200'))
const mappingArg = flag('map')
const apiBase = flag('api', 'http://127.0.0.1:8080')
const overwrite = hasFlag('overwrite')
const dryRun = hasFlag('dry-run')

if (!file || !mappingArg) {
  console.error(
    '缺少参数。示例：--file x.csv --type community --map "小区名称=name,地址=address,经度=lng,纬度=lat"',
  )
  process.exit(1)
}

const mapping = mappingArg.split(',').map((pair) => {
  const [column, field] = pair.split('=')
  return { column: (column ?? '').trim(), field: (field ?? '').trim() }
})

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') cell += ch
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''))

if (table.length === 0) {
  console.error('CSV 是空的，没有表头')
  process.exit(1)
}

const header = table[0].map((h) => h.trim())
console.log(`表头：${header.join(' | ')}`)

const index = {}
for (const { column, field } of mapping) {
  const idx = header.indexOf(column)
  if (idx < 0) {
    console.error(`表头里找不到列「${column}」`)
    process.exit(1)
  }
  index[field] = idx
}

const numeric = new Set(['lng', 'lat', 'builtYear', 'avgPrice', 'propertyFee'])
const rows = []
let badNumbers = 0

for (const raw of table.slice(1)) {
  const item = {}
  for (const [field, position] of Object.entries(index)) {
    const value = (raw[position] ?? '').trim()
    if (!value) continue
    if (numeric.has(field)) {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) {
        badNumbers++
        continue
      }
      item[field] = parsed
    } else {
      item[field] = value
    }
  }
  if (Object.keys(item).length) rows.push(item)
}

console.log(`解析出 ${rows.length} 行${badNumbers ? `（${badNumbers} 个数值无法解析已忽略）` : ''}`)

if (dryRun) {
  console.log('前 3 行预览：', JSON.stringify(rows.slice(0, 3), null, 2))
  process.exit(0)
}

const login = await fetch(`${apiBase}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: process.env.OPERATOR_USERNAME || 'operator',
    password: process.env.OPERATOR_PASSWORD || 'operator123',
  }),
})
const token = (await login.json()).data?.token
if (!token) {
  console.error('登录失败，请检查 OPERATOR_USERNAME / OPERATOR_PASSWORD')
  process.exit(1)
}

let inserted = 0
let updated = 0
let skipped = 0
let unchanged = 0

for (let i = 0; i < rows.length; i += batchSize) {
  const chunk = rows.slice(i, i + batchSize)
  const response = await fetch(`${apiBase}/api/v1/admin/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ source, license, type, overwrite, rows: chunk }),
  })
  const body = await response.json()
  if (body.code !== 0) {
    console.error(`第 ${i / batchSize + 1} 批失败：`, body.message)
    process.exit(1)
  }
  inserted += body.data.inserted
  updated += body.data.updated
  skipped += body.data.skipped
  unchanged += body.data.unchanged ?? 0
  console.log(
    `第 ${i / batchSize + 1} 批：新增 ${body.data.inserted} / 更新 ${body.data.updated} / 未变 ${body.data.unchanged ?? 0} / 跳过 ${body.data.skipped}`,
  )
  if (body.data.errors?.length) console.log('  样例错误：', body.data.errors.slice(0, 3).join('；'))
}

console.log(`\n完成：新增 ${inserted}，更新 ${updated}，未变 ${unchanged}，跳过 ${skipped}`)
console.log('提醒：对外展示时须注明「数据来源：深圳市政府数据开放平台」，且不得转让数据。')
