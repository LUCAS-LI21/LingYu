/**
 * 用 OpenStreetMap 补全小区地址（以及顺带补坐标）。
 *
 * 背景：OSM 网络此前不可达，现已恢复。Nominatim 逐个反查 1,139 个点属于"系统性批量"
 * 不合规；改用 Overpass **按区**取「带 addr 标签且有 name 的要素」，一个区一次请求，
 * 既能补地址也能补坐标，请求量只有 10 次。
 *
 * 合规：OSM 数据 ODbL 1.0，可存储，需署名「© OpenStreetMap contributors」。
 * 频率：每区一次，间隔 60s（公共实例限速严格，实测单次 45s）。
 *
 * 用法：
 *   node scripts/fetch-osm-addresses.mjs            # 抓取并缓存到 data/osm-<district>.json
 *   node scripts/fetch-osm-addresses.mjs --match    # 用缓存匹配并生成 SQL
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const UA = 'poi-intel-demo/0.1 (academic demo; contact poi-intel@example.com)'
// 主站被限流（406/超时），osm.ch 实测 2s 响应，作为主用镜像
const ENDPOINTS = ['https://overpass.osm.ch', 'https://overpass-api.de']
let endpoint = ENDPOINTS[0]
const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const MATCH_ONLY = process.argv.includes('--match')
mkdirSync('data', { recursive: true })

const DISTRICTS = {
  福田区: '22.49,113.98,22.58,114.11',
  罗湖区: '22.52,114.08,22.61,114.21',
  南山区: '22.46,113.85,22.61,114.00',
  盐田区: '22.54,114.19,22.64,114.33',
  宝安区: '22.49,113.74,22.72,113.95',
  龙岗区: '22.58,114.12,22.79,114.36',
  龙华区: '22.58,113.96,22.72,114.09',
  坪山区: '22.64,114.29,22.79,114.43',
  光明区: '22.68,113.84,22.81,113.99',
  大鹏新区: '22.50,114.38,22.66,114.60',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function composeAddress(tags) {
  if (!tags) return ''
  if (tags['addr:full']) return String(tags['addr:full']).trim()
  const parts = []
  const city = tags['addr:city'] || ''
  const district = tags['addr:district'] || tags['addr:subdistrict'] || ''
  const street = tags['addr:street'] || ''
  const house = tags['addr:housenumber'] || ''
  if (city) parts.push(city.startsWith('深圳') ? city : '深圳市')
  else parts.push('深圳市')
  if (district && !district.includes('深圳')) parts.push(district)
  if (street) parts.push(street)
  if (house) parts.push(house)
  return parts.length > 1 ? parts.join('') : ''
}

if (!MATCH_ONLY) {
  for (const [district, bbox] of Object.entries(DISTRICTS)) {
    const file = `data/osm-${district}.json`
    if (existsSync(file)) {
      console.log(`${district} 已有缓存，跳过`)
      continue
    }
    const query = `[out:json][timeout:90];nwr["name"]["addr:street"](${bbox});out center tags;`
    const started = Date.now()
    try {
      const res = await fetch(`${endpoint}/api/interpreter`, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      })
      const text = await res.text()
      if (!text.trim().startsWith('{')) {
        console.log(`${district} 返回非 JSON（${res.status}），跳过`)
        await sleep(30_000)
        continue
      }
      const body = JSON.parse(text)
      const elements = body.elements || []
      writeFileSync(file, JSON.stringify(elements), 'utf8')
      console.log(
        `${district} 抓到 ${elements.length} 个要素（${Math.round((Date.now() - started) / 1000)}s）`,
      )
    } catch (err) {
      console.log(`${district} 失败：${err.message.slice(0, 60)}`)
    }
    await sleep(60_000)
  }
}

// ---- 匹配并生成 SQL ----
const norm = (s) =>
  String(s || '')
    .replace(/[\s\u3000（）()【】·\-—_、,，.。]/g, '')
    .replace(/^(深圳市|广东省)/, '')
    .replace(/(罗湖区|福田区|南山区|宝安区|龙岗区|盐田区|龙华区|坪山区|光明区|大鹏新区)/g, '')

const osmByName = new Map()
for (const district of Object.keys(DISTRICTS)) {
  const file = `data/osm-${district}.json`
  if (!existsSync(file)) continue
  const elements = JSON.parse(readFileSync(file, 'utf8'))
  for (const el of elements) {
    const name = el.tags?.name
    if (!name) continue
    const addr = composeAddress(el.tags)
    const lat = el.center?.lat ?? el.lat
    const lon = el.center?.lon ?? el.lon
    if (!addr && !lat) continue
    const key = norm(name)
    if (!key) continue
    const prev = osmByName.get(key)
    // 同一名字可能多处（同名小区不同区），保留第一个有地址的
    if (!prev || (!prev.addr && addr)) osmByName.set(key, { name, addr, lat, lon })
  }
}
console.log(`OSM 要素去重后 ${osmByName.size} 个名字`)

const comms = []
for (let page = 1; page <= 10; page++) {
  const body = await (
    await fetch(`${API}/api/v1/pois?types=community&size=500&page=${page}`)
  ).json()
  const items = (body.data?.items || []).filter((c) => c.type === 'community')
  comms.push(...items)
  if (items.length < 500) break
}
console.log(`本地小区 ${comms.length}`)

const esc = (v) =>
  String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
const updates = []
const sources = []
for (const c of comms) {
  const hit = osmByName.get(norm(c.name))
  if (!hit || !hit.addr) continue
  if (c.address) continue
  updates.push(
    `UPDATE poi_community SET address = '${esc(hit.addr)}', updated_at = NOW() WHERE id = '${esc(c.id)}';`,
  )
  sources.push(
    `INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url) VALUES ('community', '${esc(c.id)}', 'address', 'OpenStreetMap（ODbL）', 'https://www.openstreetmap.org/') ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url), updated_at = NOW();`,
  )
}
writeFileSync('data/osm-address.sql', updates.join('\n') + '\n' + sources.join('\n') + '\n', 'utf8')
console.log(`可补地址 ${updates.length} 条，已写 data/osm-address.sql`)
