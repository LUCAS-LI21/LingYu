/**
 * 全量扫描「深圳市物业管理区域基础信息」（29200/01903550，19 314 974 行）。
 *
 * 为什么这样写：
 * - 接口不支持任何过滤参数（total 恒为 1931 万），只能按页顺序翻
 * - 1000 行/页 → 约 19 315 页；按 700ms 间隔约 4~5 小时
 * - 必须可断点续扫：进度写 data/pm-scan-progress.json，每 100 页落盘一次
 *
 * 每轮 flush 做两件事：
 *   1) 把命中本地小区的地址写库（只补空地址）
 *   2) 把**新的住宅类小区**追加到 data/pm-scan/new-villages.jsonl（去重后），留给下一阶段导入
 *
 * 住宅判定：ATTRIBUTE_NAME 含 住宅/商住/商写/自然村/保障
 *
 * 用法：
 *   SZ_KEY=... node scripts/scan-village-full.mjs                 # 续扫到最后一页
 *   SZ_KEY=... node scripts/scan-village-full.mjs --max-pages 500 # 只扫 500 页
 *   SZ_KEY=... node scripts/scan-village-full.mjs --dry-run       # 只扫不写库
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { curlJson } from './lib/http.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const KEY = process.env.SZ_KEY
if (!KEY) throw new Error('缺少 SZ_KEY')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback
}
const MAX_PAGES = flag('max-pages', 99999)
const DRY = args.includes('--dry-run')

const BASE = 'https://opendata.sz.gov.cn/api/29200_01903550/1/service.xhtml'
const ROWS = 1000
const TOTAL_PAGES = Math.ceil(19314974 / ROWS)
const PROGRESS = 'data/pm-scan-progress.json'
const OUT_DIR = 'data/pm-scan'
const NEW_FILE = `${OUT_DIR}/new-villages.jsonl`
const RESIDENTIAL = /住宅|商住|商写|自然村|保障/

const norm = (s) =>
  String(s || '')
    .replace(/[\s\u3000（）()【】·\-—_、,，.。]/g, '')
    .replace(/^深圳市/, '')
    .replace(/^(罗湖区|福田区|南山区|宝安区|龙岗区|盐田区|龙华区|坪山区|光明区|大鹏新区)/, '')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }), ...a)

mkdirSync(OUT_DIR, { recursive: true })

// 本地小区索引
log('读取本地小区…')
const all = await (await fetch(`${API}/api/v1/pois?types=community&size=20000`)).json()
const communities = (all.data?.items || []).filter((c) => c.type === 'community')
const byName = new Map()
for (const c of communities) {
  const key = norm(c.name)
  if (!key) continue
  if (!byName.has(key)) byName.set(key, [])
  byName.get(key).push(c)
}
log(`本地小区 ${communities.length} 个，缺地址 ${communities.filter((c) => !c.address).length} 个`)

// 断点
let startPage = 1
let scanned = 0
let matchedTotal = 0
let newTotal = 0
if (existsSync(PROGRESS)) {
  try {
    const saved = JSON.parse(readFileSync(PROGRESS, 'utf8'))
    startPage = Number(saved.lastPage || 0) + 1
    scanned = Number(saved.scanned || 0)
    matchedTotal = Number(saved.matchedTotal || 0)
    newTotal = Number(saved.newTotal || 0)
    log(
      `续扫：从第 ${startPage} 页开始（已扫 ${scanned} 行，累计匹配 ${matchedTotal}，新小区 ${newTotal}）`,
    )
  } catch {
    log('进度文件损坏，从头开始')
  }
}

let token = ''
async function login() {
  if (token) return token
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.OPERATOR_USERNAME || 'operator',
      password: process.env.OPERATOR_PASSWORD || 'operator123',
    }),
  })
  token = (await res.json()).data.token
  return token
}

// 全量 1931 万行的唯一编码可能上千万，不能全量去重（内存会爆）。
// 只对「要保留的东西」做到量去重：匹配到的小区按编码去重；新小区按名称去重且设上限。
const matchedKeys = new Set()
const newNames = new Set()
const CAP_NEW = 50000
let pendingMatched = new Map()
let pendingNew = new Map()

async function flush(page) {
  // 1) 地址写库
  if (!DRY && pendingMatched.size > 0) {
    const rows = [...pendingMatched.values()]
    await login()
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
      if (body.code !== 0) {
        log(`  ✗ 导入失败：${body.message}`)
        break
      }
      updated += body.data.updated || 0
    }
    matchedTotal += updated
    log(`  ✓ 地址写库 ${updated} 条（累计 ${matchedTotal}）`)
    pendingMatched = new Map()
  }

  // 2) 新小区落盘
  if (pendingNew.size > 0) {
    const lines = [...pendingNew.values()].map((v) => JSON.stringify(v)).join('\n') + '\n'
    appendFileSync(NEW_FILE, lines, 'utf8')
    newTotal += pendingNew.size
    pendingNew = new Map()
  }

  writeFileSync(
    PROGRESS,
    JSON.stringify({ lastPage: page, scanned, matchedTotal, newTotal, totalPages: TOTAL_PAGES }),
    'utf8',
  )
}

log(
  `开始扫描：${startPage} → ${Math.min(TOTAL_PAGES, startPage + MAX_PAGES - 1)}（共 ${TOTAL_PAGES} 页）`,
)
const startedAt = Date.now()
let pagesDone = 0

for (let page = startPage; page <= Math.min(TOTAL_PAGES, startPage + MAX_PAGES - 1); page++) {
  let body
  try {
    body = curlJson(`${BASE}?page=${page}&rows=${ROWS}&appKey=${KEY}`)
  } catch (e) {
    log(`  ! 第 ${page} 页失败（${e.message.slice(0, 60)}），5s 后重试`)
    await sleep(5000)
    page--
    continue
  }
  const list = body.data || []
  if (list.length === 0) {
    log('返回空页，视为结束')
    break
  }
  scanned += list.length
  pagesDone++

  for (const row of list) {
    const key = row.VILLAGE_NUM || `${row.VILLAGE_NAME}|${row.ADDRESS}`

    const hits = byName.get(norm(row.VILLAGE_NAME))
    if (hits && hits.length === 1) {
      if (!matchedKeys.has(key) && row.ADDRESS && /[路街道巷号]/.test(row.ADDRESS)) {
        matchedKeys.add(key)
        pendingMatched.set(key, {
          name: hits[0].name,
          district: hits[0].district || row.SECTION_NAME || '',
          address: row.ADDRESS,
        })
      }
      continue
    }
    // 新小区：只要住宅类，按名称去重，超过上限就不再收
    const nameKey = norm(row.VILLAGE_NAME)
    if (
      newTotal + pendingNew.size < CAP_NEW &&
      nameKey &&
      !newNames.has(nameKey) &&
      RESIDENTIAL.test(row.ATTRIBUTE_NAME || '')
    ) {
      newNames.add(nameKey)
      pendingNew.set(key, {
        name: row.VILLAGE_NAME,
        address: row.ADDRESS || '',
        district: row.SECTION_NAME || '',
        street: row.STREET_NAME || '',
        villageNum: row.VILLAGE_NUM || '',
        attribute: row.ATTRIBUTE_NAME || '',
      })
    }
  }

  if (pagesDone % 100 === 0) {
    await flush(page)
    const elapsed = (Date.now() - startedAt) / 1000
    const rate = pagesDone / Math.max(1, elapsed)
    const remain = Math.max(0, Math.min(TOTAL_PAGES, startPage + MAX_PAGES - 1) - page)
    log(
      `page=${page} 扫=${scanned} 已匹配=${matchedTotal} 新小区=${newTotal} ` +
        `速度=${rate.toFixed(1)}页/s 预计剩余=${Math.round(remain / Math.max(0.1, rate) / 60)}分钟`,
    )
  }
  await sleep(700)
}

await flush(Math.min(TOTAL_PAGES, startPage + MAX_PAGES - 1))
log(`扫描结束：已扫 ${scanned} 行，匹配写库 ${matchedTotal}，新小区 ${newTotal}`)
