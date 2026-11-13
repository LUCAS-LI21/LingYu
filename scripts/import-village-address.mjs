/**
 * 从「深圳市物业管理区域基础信息」（29200/01903550，1931 万行）补小区地址。
 *
 * 现实约束：该接口**不支持任何过滤参数**（传 VILLAGE_NAME/SECTION_NAME 都被忽略，total 恒为 19 314 974），
 * 只能按页顺序扫描，1000 行/页 → 全量要 1.9 万页，不现实。
 *
 * 策略：有上限的顺序扫描 + 边扫边存进度 + 只保留能匹配上的行。
 *   - 实测 1 万行样本里有 7688 个唯一小区，其中 1214 个能匹配本地小区
 *   - 每页 1000 行、间隔 ≥700ms，默认扫 300 页（30 万行，约 4~6 分钟）
 *   - 进度写 data/pm-scan-progress.json，下次从 lastPage+1 继续
 *
 * 用法：
 *   SZ_KEY=... node scripts/import-village-address.mjs                 # 扫 300 页并写库
 *   SZ_KEY=... node scripts/import-village-address.mjs --pages 900     # 多扫一些
 *   SZ_KEY=... node scripts/import-village-address.mjs --dry-run       # 只看匹配数
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { curlJson } from './lib/http.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const KEY = process.env.SZ_KEY
if (!KEY) throw new Error('缺少 SZ_KEY')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback
}
const PAGES = flag('pages', 300)
const DRY = args.includes('--dry-run')
const PROGRESS = 'data/pm-scan-progress.json'
const BASE = 'https://opendata.sz.gov.cn/api/29200_01903550/1/service.xhtml'
const ROWS = 1000

const norm = (s) =>
  String(s || '')
    .replace(/[\s\u3000（）()【】·\-—_、,，.。]/g, '')
    .replace(/^深圳市/, '')
    .replace(/^(罗湖区|福田区|南山区|宝安区|龙岗区|盐田区|龙华区|坪山区|光明区|大鹏新区)/, '')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 1) 本地小区索引
console.log('读取本地小区…')
const all = await (await fetch(`${API}/api/v1/pois?types=community&size=20000`)).json()
const communities = (all.data?.items || []).filter((c) => c.type === 'community')
const byName = new Map()
for (const c of communities) {
  const key = norm(c.name)
  if (!key) continue
  if (!byName.has(key)) byName.set(key, [])
  byName.get(key).push(c)
}
console.log(
  `本地小区 ${communities.length} 个（缺地址 ${communities.filter((c) => !c.address).length} 个）`,
)

// 2) 断点
let startPage = 1
if (existsSync(PROGRESS)) {
  try {
    const saved = JSON.parse(readFileSync(PROGRESS, 'utf8'))
    startPage = Number(saved.lastPage || 0) + 1
    console.log(
      `从第 ${startPage} 页继续（上次扫到 ${saved.lastPage}，累计匹配 ${saved.matched || 0}）`,
    )
  } catch {
    console.log('进度文件损坏，从头开始')
  }
}

// 3) 顺序扫描
const matched = new Map() // villageNum -> row
let scanned = 0
let lastPage = startPage - 1
for (let page = startPage; page < startPage + PAGES; page++) {
  const body = curlJson(`${BASE}?page=${page}&rows=${ROWS}&appKey=${KEY}`)
  const list = body.data || []
  if (list.length === 0) break
  scanned += list.length
  lastPage = page
  for (const row of list) {
    const hits = byName.get(norm(row.VILLAGE_NAME))
    if (!hits || hits.length !== 1) continue // 同名多义不写，避免张冠李戴
    if (!row.ADDRESS) continue
    // 只要街道级地址：样本里 4% 是「XX社区」这种社区级描述，写进小区等于降级
    if (!/[路街道巷号]/.test(row.ADDRESS)) continue
    matched.set(row.VILLAGE_NUM || `${row.VILLAGE_NAME}|${row.ADDRESS}`, row)
  }
  if (page % 25 === 0) {
    console.log(`  第 ${page} 页：已扫 ${scanned} 行，匹配 ${matched.size} 个小区`)
    mkdirSync('data', { recursive: true })
    writeFileSync(
      PROGRESS,
      JSON.stringify({ lastPage: page, scanned, matched: matched.size }),
      'utf8',
    )
  }
  await sleep(700)
}

console.log(`扫描完成：${scanned} 行 / ${PAGES} 页上限，匹配 ${matched.size} 个小区`)
writeFileSync(PROGRESS, JSON.stringify({ lastPage, scanned, matched: matched.size }), 'utf8')

// 4) 写库（只补空地址，enrich 默认不覆盖）
const rows = [...matched.values()]
  .map((row) => {
    const target = byName.get(norm(row.VILLAGE_NAME))[0]
    return {
      name: target.name,
      district: target.district || row.SECTION_NAME || '',
      address: row.ADDRESS,
    }
  })
  .filter((row) => row.address)

console.log(`待写库 ${rows.length} 条，样例：`, JSON.stringify(rows.slice(0, 2), null, 1))
if (DRY || rows.length === 0) {
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
for (let i = 0; i < rows.length; i += 500) {
  const batch = rows.slice(i, i + 500)
  const res = await fetch(`${API}/api/v1/admin/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      source: '深圳市政府数据开放平台-物业管理区域基础信息',
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
console.log(`完成：提交 ${rows.length}，实际更新 ${updated}`)
