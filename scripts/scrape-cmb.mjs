/**
 * 招商银行深圳网点适配器。
 *
 * 数据来源：map.cmbchina.com 网点地图（robots 200 / Allow: /，仅禁静态资源）
 * 接口：
 *   GET /api/map/getCmbData?cityName=深圳&type=B      网点列表（含经纬度）
 *   GET /api/map/getCmbBrnBusiInfo?branchNo=xxx       地址/电话/营业时间
 *
 * 坐标系：页面未标注，按国内惯例视为 GCJ-02，入库前转 WGS-84。
 *
 * 用法：
 *   node scripts/scrape-cmb.mjs --limit 5 --dry-run
 *   node scripts/scrape-cmb.mjs                # 全量 97 家
 */
import { importRows, inShenzhen } from './lib/import-client.mjs'
import { toWgs84 } from './lib/coord.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const LIMIT = Number(flag('limit', '999'))
const DRY = args.includes('--dry-run')
const DELAY = 1100

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
const REFERER = 'https://map.cmbchina.com/map'
const BASE = 'https://map.cmbchina.com/api/map'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DISTRICTS = ['福田区', '南山区', '罗湖区', '宝安区', '龙岗区', '盐田区', '龙华区', '坪山区', '光明区', '大鹏新区']

function districtOf(address) {
  for (const d of DISTRICTS) if ((address || '').includes(d)) return d
  return ''
}

function formatHours(openTime) {
  if (!Array.isArray(openTime) || openTime.length === 0) return ''
  const times = [...new Set(openTime.map((d) => (d.retailTime || '').replace(/[;\s]+/g, '')))]
  if (times.length === 1) return `周一至周日 ${times[0]}`
  return `周一至周日 ${times.slice(0, 2).join(' / ')}`
}

async function getJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Referer: REFERER } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.json()
}

console.log('拉取招行深圳网点列表…')
const listResp = await getJson(`${BASE}/getCmbData?cityName=${encodeURIComponent('深圳')}&type=B`)
const branches = (listResp.body || []).slice(0, LIMIT)
console.log(`列表返回 ${branches.length} 家（type=B 网点）`)

const rows = []
let skipped = 0
for (let i = 0; i < branches.length; i++) {
  const b = branches[i]
  try {
    await sleep(DELAY)
    const detail = (await getJson(`${BASE}/getCmbBrnBusiInfo?branchNo=${encodeURIComponent(b.branchNo)}`)).body || {}
    const [lng, lat] = toWgs84(Number(b.lng), Number(b.lat), 'gcj02')
    if (!inShenzhen(lng, lat)) { skipped++; continue }
    rows.push({
      name: `招商银行${b.name}`,
      address: detail.branchAddr || '',
      phone: detail.serviceTels || '',
      openingHours: formatHours(detail.branchOpenTime),
      district: districtOf(detail.branchAddr),
      lng, lat,
      brand: '招商银行',
      branchType: 'branch',
    })
    if ((i + 1) % 10 === 0) console.log(`  已处理 ${i + 1}/${branches.length}`)
  } catch (e) {
    skipped++
    console.log(`  [跳过] ${b.name}: ${e.message}`)
  }
}

console.log(`抓取完成：${rows.length} 条，跳过 ${skipped}`)
console.log('样例：', JSON.stringify(rows.slice(0, 2), null, 1))

await importRows({
  source: '招商银行官网',
  license: '公开信息（官网网点地图）',
  type: 'bank',
  rows,
  dryRun: DRY,
})
