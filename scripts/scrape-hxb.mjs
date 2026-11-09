/**
 * 华夏银行深圳网点适配器。
 *
 * 来源：www.hxb.com.cn 网点地图（robots 404）
 * 接口：GET /hxmap/get_bank.jsp（JSONP）
 *   params.areaCode=p004（广东）、params.branchCode=c0007（深圳）、
 *   params.bankType=0（营业网点）/1（ATM）/2（全部）、page（1 起）、params.status=1
 * 返回：JSONP，内含 list；字段 branchName/branchAddress/branchPhone/branchBusinessTime/
 *       branchLongitude/branchDimension(纬度)
 * 注意：返回体有尾逗号（非法 JSON），需先清洗再 parse。
 * 坐标：未标注，按国内惯例视为 GCJ-02。
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
const DELAY = 1100

const BASE = 'https://www.hxb.com.cn/hxmap/get_bank.jsp'
const DISTRICTS = [
  '福田区',
  '南山区',
  '罗湖区',
  '宝安区',
  '龙岗区',
  '盐田区',
  '龙华区',
  '坪山区',
  '光明区',
  '大鹏新区',
]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function districtOf(address) {
  for (const d of DISTRICTS) if ((address || '').includes(d)) return d
  return ''
}

function parseJsonp(text) {
  const body = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'))
  // 去掉尾逗号（华夏返回体不规范）
  const cleaned = body.replace(/,\s*([\]}])/g, '$1')
  return JSON.parse(cleaned)
}

console.log('拉取华夏银行深圳网点…')
const rows = []
let page = 1
let total = null

while (rows.length < LIMIT) {
  const url = `${BASE}?params.areaCode=p004&params.branchCode=c0007&params.bankType=0&page=${page}&params.status=1&jsonpcallback=cb`
  const text = await curlText(url, { referer: 'https://www.hxb.com.cn/' })
  const json = parseJsonp(text)
  const list = json.list || json.data || []
  total = json.total ?? json.count ?? total
  if (list.length === 0) break
  for (const item of list) {
    const [lng, lat] = toWgs84(Number(item.branchLongitude), Number(item.branchDimension), 'gcj02')
    if (!inShenzhen(lng, lat)) continue
    const hours = [item.branchBusinessTime, item.branchWeekendopen].filter(Boolean).join('；')
    rows.push({
      name: (item.branchName || '').startsWith('华夏银行')
        ? item.branchName
        : `华夏银行${item.branchName || ''}`,
      address: item.branchAddress || '',
      phone: [item.branchPhone, item.branchPhone2].filter(Boolean).join(' / '),
      openingHours: String(hours)
        .replace(/<br\s*\/?>/gi, '；')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 120),
      district: districtOf(item.branchAddress),
      lng,
      lat,
      brand: '华夏银行',
      branchType: 'branch',
    })
  }
  console.log(`  第 ${page} 页：累计 ${rows.length}`)
  if (total && rows.length >= Number(total)) break
  if (list.length === 0) break
  page++
  await sleep(DELAY)
}

console.log(`抓取完成：${rows.length} 条`)
console.log('样例：', JSON.stringify(rows.slice(0, 1), null, 1))

await importRows({
  source: '华夏银行官网',
  license: '公开信息（官网网点地图）',
  type: 'bank',
  rows,
  dryRun: DRY,
})
