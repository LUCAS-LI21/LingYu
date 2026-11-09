/**
 * 平安银行深圳网点适配器。
 *
 * 来源：bank.pingan.com 页脚「服务网点」→ b.pingan.com.cn 网点地图
 * 接口：GET rsb.pingan.com.cn/mkt/iclient-core/cust/ams-rbms-core/app/getBankShowListJsonp
 *   ?source=WEB&city=深圳&type=YYWD&callback=cb   （YYWD=营业网点，ATM=自助设备）
 * 返回：{ data: [ {name,address,tles[],workingTime,shopHour,lng,lat,...} ], responseCode, responseMsg }
 * 特点：一次返回全量（90 条），无分页、无 total。
 * 坐标：BD-09（页面用 BMap.Point），入库前 BD-09 → GCJ-02 → WGS-84。
 */
import { importRows, inShenzhen } from './lib/import-client.mjs'
import { toWgs84 } from './lib/coord.mjs'
import { curlText } from './lib/http.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const LIMIT = Number(flag('limit', '999'))
const DRY = args.includes('--dry-run')

const DISTRICTS = ['福田区', '南山区', '罗湖区', '宝安区', '龙岗区', '盐田区', '龙华区', '坪山区', '光明区', '大鹏新区']
const URL_BASE = 'https://rsb.pingan.com.cn/mkt/iclient-core/cust/ams-rbms-core/app/getBankShowListJsonp'

function districtOf(address) {
  for (const d of DISTRICTS) if ((address || '').includes(d)) return d
  return ''
}

/** workingTime 有重复片段，优先用 shopHour；否则去重后截断 */
function formatHours(item) {
  const shop = String(item.shopHour || '').replace(/\s+/g, ' ').trim()
  if (shop) return shop.slice(0, 120)
  const raw = String(item.workingTime || '')
  const parts = [...new Set(raw.split(';').map((s) => s.trim()).filter(Boolean))]
  return parts.join('；').slice(0, 120)
}

console.log('拉取平安银行深圳网点…')
const url = `${URL_BASE}?source=WEB&city=${encodeURIComponent('深圳')}&type=YYWD&callback=cb`
const text = await curlText(url)
const json = JSON.parse(text.slice(text.indexOf('(') + 1, text.lastIndexOf(')')))
const list = (json.data || []).slice(0, LIMIT)
console.log(`接口返回 ${(json.data || []).length} 条，本次处理 ${list.length}`)

const rows = []
let badCoords = 0
for (const item of list) {
  const [lng, lat] = toWgs84(Number(item.lng), Number(item.lat), 'bd09')
  if (!inShenzhen(lng, lat)) { badCoords++; continue }
  const rawAddress = item.address || ''
  // 源数据偶发「福田区深圳市福田区…」这类重复前缀，统一裁到第一个「深圳市」
  const cut = rawAddress.indexOf('深圳市')
  const address = cut >= 0 ? rawAddress.slice(cut) : `深圳市${rawAddress}`
  rows.push({
    name: (item.name || '').startsWith('平安银行') ? item.name : `平安银行${item.name || ''}`,
    address,
    phone: Array.isArray(item.tles) ? item.tles.join(' / ') : '',
    openingHours: formatHours(item),
    district: districtOf(address),
    lng,
    lat,
    brand: '平安银行',
    branchType: 'branch',
  })
}

console.log(`转换完成：${rows.length} 条（坐标越界 ${badCoords} 条）`)
console.log('样例：', JSON.stringify(rows.slice(0, 1), null, 1))

await importRows({
  source: '平安银行官网',
  license: '公开信息（官网网点地图）',
  type: 'bank',
  rows,
  dryRun: DRY,
})
