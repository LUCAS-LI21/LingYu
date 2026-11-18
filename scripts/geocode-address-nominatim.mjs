/**
 * 用 Nominatim 反向地理编码补全小区地址。
 *
 * 为什么用 Nominatim：Overpass 主站网络不稳/限流，镜像又不含中国数据；
 * Nominatim 实测稳定（~0.8s/次）。
 *
 * 合规与礼貌（Nominatim Usage Policy）：
 *   - 1 请求/秒，带可识别 UA
 *   - 分批跑（--limit 控制），不做无上限的系统性抓取
 *   - 结果缓存到 data/nominatim-cache.json，重跑不重复请求
 *   - OSM 数据 ODbL，入库时署名
 *
 * 用法：node scripts/geocode-address-nominatim.mjs --limit 400 [--dry-run]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback
}
const LIMIT = flag('limit', 400)
const DRY = args.includes('--dry-run')
const UA = 'poi-intel-demo/0.1 (academic demo; contact poi-intel@example.com)'
const CACHE = 'data/nominatim-cache.json'

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Nominatim 的 display_name 拆成中文地址 */
function composeAddress(name) {
  if (!name) return ''
  const parts = name
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^\d{5,6}$/.test(s) && s !== '中国' && s !== '广东省' && s !== '深圳市')
  if (parts.length === 0) return ''
  return `深圳市${parts.reverse().join('')}`
}

const comms = []
for (let page = 1; page <= 10; page++) {
  const body = await (
    await fetch(`${API}/api/v1/pois?types=community&size=500&page=${page}`)
  ).json()
  const items = (body.data?.items || []).filter((c) => c.type === 'community')
  comms.push(...items)
  if (items.length < 500) break
}
const targets = comms.filter((c) => !c.address).slice(0, LIMIT)
console.log(
  `小区 ${comms.length} | 缺地址 ${comms.filter((c) => !c.address).length} | 本次处理 ${targets.length}`,
)

let filled = 0
let failed = 0
const rows = []
for (const [index, c] of targets.entries()) {
  const cached = cache[c.id]
  let name = cached?.name
  if (!cached) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${c.lat}&lon=${c.lng}&accept-language=zh`
    let ok = false
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(25000),
        })
        if (res.status === 429) {
          console.log('被限流（429），暂停 60s')
          await sleep(60000)
          continue
        }
        const j = await res.json()
        name = j.display_name || ''
        cache[c.id] = { name, at: new Date().toISOString() }
        ok = true
        await sleep(1100)
      } catch (err) {
        if (attempt === 2) {
          failed++
          console.log(`失败 ${c.name}: ${String(err.message).slice(0, 50)}`)
          await sleep(2500)
        } else {
          await sleep(3000)
        }
      }
    }
    if (!ok) continue
  }
  const address = composeAddress(name)
  if (address && address.length >= 8) {
    rows.push({ id: c.id, address })
    filled++
  }
  if ((index + 1) % 50 === 0) console.log(`进度 ${index + 1}/${targets.length}，已得 ${filled}`)
}

writeFileSync(CACHE, JSON.stringify(cache, null, 1), 'utf8')
console.log(`拿到地址 ${filled} / ${targets.length}（失败 ${failed}）`)

if (DRY || rows.length === 0) {
  console.log('[dry-run] 不写库')
  process.exit(0)
}

const esc = (v) =>
  String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
const updates = rows.map(
  (r) =>
    `UPDATE poi_community SET address = '${esc(r.address)}', updated_at = NOW() WHERE id = '${esc(r.id)}';`,
)
const sources = rows.map(
  (r) =>
    `INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url) VALUES ('community', '${esc(r.id)}', 'address', 'OpenStreetMap Nominatim（ODbL）', 'https://www.openstreetmap.org/') ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url), updated_at = NOW();`,
)
writeFileSync(
  'data/nominatim-address.sql',
  updates.join('\n') + '\n' + sources.join('\n') + '\n',
  'utf8',
)
console.log('已写 data/nominatim-address.sql')
