/**
 * ATM / 自助设备专项采集。
 *
 * 背景：数据库里 ATM 只有 43 台（全部来自 OSM），而深圳实际是万台量级；
 * 赛题明确要求「小区周边 1 公里内的所有 ATM」，43 台不足以支撑演示。
 *
 * 已确认可用的官方来源（2026-11-19 实测）：
 *   - 平安银行：type=ATM 返回 232 条自助设备（BD-09）
 *   - 招商银行：type=A 返回 113 条 ATM（GCJ-02）
 *
 * 已排除：
 *   - 华夏银行 bankType=1：实测返回的是营业网点（13 个与现有网点同名、4 个坐标完全重合），
 *     不是 ATM，误导入会造成"网点伪装成 ATM"，故不采集。
 *   - 建设银行 Enqr_MtdCd=3（ATM）：TOTAL_REC=0；=2（自助银行）只返回数量不返回明细。
 *   - OSM amenity=atm：中国区数据为空（overpass.osm.ch 实测 0 条）。
 *
 * 用法：
 *   node scripts/scrape-atm.mjs --dry-run     # 只看数量，不写库
 *   node scripts/scrape-atm.mjs               # 导入
 *   node scripts/scrape-atm.mjs --only=pab    # 只跑某一家（pab/cmb）
 */
import { toWgs84 } from './lib/coord.mjs'
import { importRows } from './lib/import-client.mjs'

const API_LABEL = 'ATM 自助设备'
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || ''
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36 poi-intel-demo/0.1'

const DISTRICTS = [
  '福田区',
  '罗湖区',
  '南山区',
  '盐田区',
  '宝安区',
  '龙岗区',
  '龙华区',
  '坪山区',
  '光明区',
  '大鹏新区',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function districtOf(address) {
  const text = address || ''
  for (const d of DISTRICTS) if (text.includes(d)) return d
  return ''
}

/** 深圳范围粗筛，挡掉外地坐标 */
function inShenzhen(lng, lat) {
  return lng > 113.6 && lng < 114.8 && lat > 22.3 && lat < 22.95
}

function uniqName(name, fallback) {
  const text = String(name || '').trim()
  if (text) return text
  return fallback
}

/**
 * 平安接口所有设备的 name 都是「平安银行ATM自助设备」，直接用会让列表里 200 行长得一模一样。
 * 用地址后缀拼一个可区分的名字：平安银行ATM（福田区深南中路1099号…）
 */
function pabDisplayName(address, fallback) {
  const text = String(address || '')
    .replace(/^广东省/, '')
    .replace(/^深圳市?/, '')
    .trim()
  if (!text) return fallback
  const clipped = text.length > 22 ? text.slice(0, 22) + '…' : text
  return `平安银行ATM（${clipped}）`
}

// ---------------- 平安银行：type=ATM ----------------
async function fetchPab() {
  const url =
    'https://rsb.pingan.com.cn/mkt/iclient-core/cust/ams-rbms-core/app/getBankShowListJsonp' +
    `?source=WEB&city=${encodeURIComponent('深圳')}&type=ATM&callback=cb`
  const response = await fetch(url, { headers: { 'User-Agent': UA } })
  const text = (await response.text()).trim()
  const json = JSON.parse(text.replace(/^cb\(/, '').replace(/\);?\s*$/, ''))
  const list = json.data || []
  const rows = []
  for (const item of list) {
    const lng = Number(item.lng)
    const lat = Number(item.lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    // 平安返回 BD-09（页面用 BMap.Point）
    const [wgsLng, wgsLat] = toWgs84(lng, lat, 'bd09')
    if (!inShenzhen(wgsLng, wgsLat)) continue
    const address = item.address || ''
    rows.push({
      name: pabDisplayName(address, uniqName(item.name, '平安银行ATM')),
      address,
      phone: item.tles?.[0] || '',
      openingHours: [item.workingTime, item.shopHour].filter(Boolean).join('；').slice(0, 120),
      district: districtOf(address),
      lng: wgsLng,
      lat: wgsLat,
      brand: '平安银行',
      branchType: 'atm',
    })
  }
  return rows
}

// ---------------- 招商银行：type=A（ATM） ----------------
async function fetchCmb() {
  const url = `https://map.cmbchina.com/api/map/getCmbData?cityName=${encodeURIComponent('深圳')}&type=A`
  const response = await fetch(url, { headers: { 'User-Agent': UA } })
  const json = JSON.parse(await response.text())
  const list = json.body || []
  const rows = []
  for (const item of list) {
    const lng = Number(item.lng)
    const lat = Number(item.lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    // 招行地图接口为 GCJ-02
    const [wgsLng, wgsLat] = toWgs84(lng, lat, 'gcj02')
    if (!inShenzhen(wgsLng, wgsLat)) continue
    const address = item.address || ''
    rows.push({
      name: uniqName(item.name, '招商银行ATM'),
      address,
      phone: item.number ? String(item.number).slice(0, 32) : '',
      openingHours: [item.openTime, item.closeTime].filter(Boolean).join('-').slice(0, 120),
      district: districtOf(address),
      lng: wgsLng,
      lat: wgsLat,
      brand: '招商银行',
      branchType: 'atm',
    })
  }
  return rows
}

// ---------------- 华夏银行：bankType=1（ATM） ----------------
function parseJsonp(text) {
  return JSON.parse(
    text
      .replace(/^[^(]*\(/, '')
      .replace(/\);?\s*$/, '')
      .replace(/,\s*([\]}])/g, '$1'),
  )
}

async function fetchHxb() {
  const rows = []
  for (let page = 1; page <= 30; page += 1) {
    const url =
      'https://www.hxb.com.cn/hxmap/get_bank.jsp' +
      `?params.areaCode=p004&params.branchCode=c0007&params.bankType=1&page=${page}&params.status=1&jsonpcallback=cb`
    const response = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://www.hxb.com.cn/' },
    })
    if (!response.ok) break
    const json = parseJsonp((await response.text()).trim())
    const list = json.list || []
    if (!list.length) break
    for (const item of list) {
      const lng = Number(item.branchLongitude)
      const lat = Number(item.branchDimension)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      const [wgsLng, wgsLat] = toWgs84(lng, lat, 'gcj02')
      if (!inShenzhen(wgsLng, wgsLat)) continue
      const address = item.branchAddress || ''
      rows.push({
        name: uniqName(item.branchName, '华夏银行ATM'),
        address,
        phone: [item.branchPhone, item.branchPhone2].filter(Boolean).join(' / ').slice(0, 64),
        openingHours: String(item.branchBusinessTime || '')
          .replace(/<br\s*\/?>/gi, '；')
          .replace(/<[^>]+>/g, '')
          .slice(0, 120),
        district: districtOf(address),
        lng: wgsLng,
        lat: wgsLat,
        brand: '华夏银行',
        branchType: 'atm',
      })
    }
    if (rows.length >= Number(json.rowCount || 0)) break
    await sleep(1100)
  }
  return rows
}

// ---------------- 主流程 ----------------
const sources = [
  { key: 'pab', label: '平安银行官网', source: '平安银行官网（ATM）', run: fetchPab },
  { key: 'cmb', label: '招商银行官网', source: '招商银行官网（ATM）', run: fetchCmb },
].filter((s) => !ONLY || s.key === ONLY)

let grand = 0
for (const item of sources) {
  console.log(`\n[${item.label}] 抓取 ${API_LABEL}…`)
  try {
    const rows = await item.run()
    console.log(`  抓到 ${rows.length} 条；样例：${JSON.stringify(rows[0] || null).slice(0, 200)}`)
    if (!rows.length) continue
    grand += rows.length
    await importRows({
      source: item.source,
      license: '公开信息（官网自助设备查询）',
      type: 'bank',
      rows,
      dryRun: DRY,
    })
  } catch (err) {
    console.log(`  [失败] ${item.label}: ${err.message.slice(0, 120)}（跳过，不影响其他来源）`)
  }
  await sleep(1200)
}

console.log(`\n合计抓到 ${grand} 条 ATM${DRY ? '（dry-run，未写库）' : ''}`)
