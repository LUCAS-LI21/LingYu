/**
 * 中国邮政储蓄银行深圳网点适配器。
 *
 * 来源：www.psbc.com 网点查询 → 接口 s.psbc.com/portal/PsbcService/dotMap/businesslonglatitude（JSONP）
 *
 * 合规说明（重要）：
 * - www.psbc.com/robots.txt 为 200，其中 Disallow /PsbcService/，但**接口不在 www 域**
 * - 接口所在 s.psbc.com/robots.txt 返回 404，即该 origin 未声明限制
 * - robots 按 origin 生效（RFC 9309），因此本适配器只访问 s.psbc.com，并按 ≥1.1 秒/次限速
 * - 如后续该站补充 robots 规则，应立即停用
 *
 * 坐标：未标注，按国内惯例视为 GCJ-02，入库前转 WGS-84。
 * 证据：原始响应落盘到 data/raw/psbc-<时间戳>.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
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

const BASE = 'https://s.psbc.com/portal/PsbcService/dotMap/businesslonglatitude'
const REFERER = 'https://www.psbc.com/cn/common/fwwd/'
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

/** 把「个人业务 工作时间:周一,...09:00:00--17:00:00」压成「周一、周二 09:00-17:00」 */
function formatHours(busTm) {
  const first =
    String(busTm || '')
      .split(';')
      .filter(Boolean)[0] || ''
  const seg = first.replace(/个人业务\s*工作时间[:：]?/, '').replace(/\s+/g, '')
  const times = [...seg.matchAll(/(\d{2}:\d{2})/g)].map((m) => m[1])
  const days = (seg.split(/\d/)[0] || '').replace(/[、,，]$/, '')
  if (times.length === 0) return ''
  return `${days}${times[0]}-${times[1] || times[0]}`.slice(0, 120)
}

async function fetchPage(pageIndex) {
  const url = `${BASE}?regionId=440300&isLocateFlag=0&pageIndex=${pageIndex}&searchType=1&areaType=1&longtitude=114.06&latitude=22.54&callback=cb`
  const text = await curlText(url, { referer: REFERER })
  const json = JSON.parse(text.replace(/^cb\(/, '').replace(/\)\s*$/, ''))
  return json
}

console.log('拉取邮储深圳网点…')
const rows = []
const rawPages = []
let pageIndex = 1
let totalSize = null

while (rows.length < LIMIT) {
  const json = await fetchPage(pageIndex)
  rawPages.push(json)
  const head = json.resultList?.[0] || {}
  totalSize = Number(head.totalSize || totalSize || 0)
  const list = head.resultList || []
  if (list.length === 0) break
  for (const item of list) {
    const info = item.InformationInq || {}
    const [lng, lat] = toWgs84(Number(info.longitude), Number(info.latitude), 'gcj02')
    if (!inShenzhen(lng, lat)) continue
    rows.push({
      name: info.organName || `中国邮政储蓄银行${info.organShtName || ''}`,
      address: info.organAddr || '',
      phone: info.phone || '',
      openingHours: formatHours(info.bus_tm),
      district: districtOf(info.organAddr),
      lng,
      lat,
      brand: '中国邮政储蓄银行',
      branchType: 'branch',
    })
  }
  console.log(`  第 ${pageIndex} 页：累计 ${rows.length}${totalSize ? ` / ${totalSize}` : ''}`)
  pageIndex++
  if (totalSize && rows.length >= totalSize) break
  if (rows.length >= LIMIT) break
  await sleep(DELAY)
}

// 证据留档
mkdirSync('data/raw', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(`data/raw/psbc-${stamp}.json`, JSON.stringify(rawPages), 'utf8')

console.log(`抓取完成：${rows.length} 条`)
console.log('样例：', JSON.stringify(rows.slice(0, 1), null, 1))

await importRows({
  source: '中国邮政储蓄银行官网',
  license: '公开信息（官网网点查询）',
  type: 'bank',
  rows,
  dryRun: DRY,
})
