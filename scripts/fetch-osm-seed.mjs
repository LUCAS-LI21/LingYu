// 从 OSM/Overpass 拉深圳中心区真实 POI 作为演示种子数据（ODbL 许可）
// 用法：node scripts/fetch-osm-seed.mjs
import fs from 'node:fs'
import path from 'node:path'

const UA = 'poi-intel-demo/0.1 (academic demo; contact 2396845790@qq.com)'
// 福田 + 罗湖 + 南山 主体
const BBOX = '22.49,113.90,22.57,114.10'

const QUERY = `[out:json][timeout:180];
(
  node["amenity"~"^(bank|atm)$"](${BBOX});
  way["landuse"="residential"](${BBOX});
);
out center tags;`

const t0 = Date.now()
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

async function query(endpoint, body, timeoutMs) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      Accept: 'application/json',
    },
    body: 'data=' + encodeURIComponent(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`${endpoint} -> ${res.status} ${(await res.text()).slice(0, 120)}`)
  return res.json()
}

let raw
for (const endpoint of ENDPOINTS) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`[fetch] ${endpoint} attempt ${attempt} ...`)
      raw = await query(endpoint, QUERY, 240000)
      console.log(`[fetch] ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
      break
    } catch (err) {
      console.warn('[fetch] failed:', err.message)
      await new Promise((r) => setTimeout(r, 3000 * attempt))
    }
  }
  if (raw) break
}

if (!raw) {
  console.error('[fetch] all endpoints failed')
  process.exit(1)
}

const pick = (t, k) => (t && t[k] ? String(t[k]).trim() : '')

function addressOf(tags) {
  const parts = [
    pick(tags, 'addr:province'),
    pick(tags, 'addr:city'),
    pick(tags, 'addr:district'),
    pick(tags, 'addr:street'),
    pick(tags, 'addr:housenumber'),
  ].filter(Boolean)
  return parts.length ? parts.join('') : pick(tags, 'addr:full')
}

const pois = []
for (const el of raw.elements) {
  const tags = el.tags || {}
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  if (typeof lat !== 'number' || typeof lon !== 'number') continue

  if (el.type === 'node' && (tags.amenity === 'bank' || tags.amenity === 'atm')) {
    const name = tags.name || tags.brand || tags.operator || ''
    if (!name) continue
    pois.push({
      id: `osm-${el.type}-${el.id}`,
      type: 'bank',
      name,
      brand: tags.brand || tags.operator || '',
      branchType: tags.amenity === 'atm' ? 'atm' : 'branch',
      address: addressOf(tags) || '',
      lng: Number(lon.toFixed(6)),
      lat: Number(lat.toFixed(6)),
      phone: tags.phone || tags['contact:phone'] || '',
      openingHours: tags.opening_hours || '',
      source: 'OpenStreetMap',
      license: 'ODbL',
      sourceLevel: 'L1',
    })
    continue
  }

  if (el.type === 'way' && tags.landuse === 'residential') {
    const name = tags.name || ''
    if (!name) continue // 无名称地块对业务无意义
    pois.push({
      id: `osm-${el.type}-${el.id}`,
      type: 'community',
      name,
      address: addressOf(tags) || '',
      lng: Number(lon.toFixed(6)),
      lat: Number(lat.toFixed(6)),
      builtYear: null,
      avgPrice: null,
      propertyFee: null,
      source: 'OpenStreetMap',
      license: 'ODbL',
      sourceLevel: 'L1',
    })
  }
}

const outDir = path.resolve('public/data')
fs.mkdirSync(outDir, { recursive: true })
const payload = {
  generatedAt: new Date().toISOString(),
  source: 'OpenStreetMap via Overpass API',
  license: 'ODbL 1.0',
  attribution: '© OpenStreetMap contributors',
  bbox: BBOX,
  count: {
    bank: pois.filter((p) => p.type === 'bank').length,
    community: pois.filter((p) => p.type === 'community').length,
  },
  pois,
}
fs.writeFileSync(path.join(outDir, 'pois.json'), JSON.stringify(payload), 'utf8')
console.log('[done]', payload.count, '->', path.join(outDir, 'pois.json'))
