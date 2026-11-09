/**
 * 广发银行深圳网点适配器。
 *
 * 来源：www.cgbchina.com.cn 网点查询（robots 200 / Allow: /，禁 php/asp/aspx/sql/txt/xml/pdf，.jsp 未禁）
 * 接口：POST /mobile/jsp/common/getRtpTrade.jsp
 *   form: interfaceType=nearBank&cityCode=440300&beginNum=0&pageNums=20
 * 返回：totalNum + markInfoOList[]（markName/markAdress/tel/bussTime/longitude/latitude）
 * 坐标：未标注，按国内惯例视为 GCJ-02。
 */
import { importRows, inShenzhen } from './lib/import-client.mjs'
import { toWgs84 } from './lib/coord.mjs'
import { curlJson } from './lib/http.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const LIMIT = Number(flag('limit', '999'))
const DRY = args.includes('--dry-run')
const DELAY = 1100

const URL = 'https://www.cgbchina.com.cn/mobile/jsp/common/getRtpTrade.jsp'
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

console.log('拉取广发深圳网点…')
const rows = []
let beginNum = 0
let total = null

while (rows.length < LIMIT) {
  const form = new URLSearchParams({
    interfaceType: 'nearBank',
    cityCode: '440300',
    beginNum: String(beginNum),
    pageNums: '20',
  }).toString()
  const body = curlJson(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    referer: 'https://www.cgbchina.com.cn/Channel/185652',
    body: form,
  })
  const list = body?.markInfoOList || []
  total = body?.totalNum ?? total
  if (list.length === 0) break
  for (const item of list) {
    const [lng, lat] = toWgs84(Number(item.longitude), Number(item.latitude), 'gcj02')
    if (!inShenzhen(lng, lat)) continue
    const name = (item.markName || '').startsWith('广发银行')
      ? item.markName
      : `广发银行${item.markName || ''}`
    rows.push({
      name,
      address: item.markAdress || '',
      phone: item.tel || '',
      openingHours: (item.bussTime || '').replace(/\s+/g, ' ').slice(0, 120),
      district: districtOf(item.markAdress),
      lng,
      lat,
      brand: '广发银行',
      branchType: 'branch',
    })
  }
  console.log(`  偏移 ${beginNum}：累计 ${rows.length}${total ? ` / ${total}` : ''}`)
  if (total && rows.length >= Number(total)) break
  beginNum += 20
  await sleep(DELAY)
}

console.log(`抓取完成：${rows.length} 条`)
console.log('样例：', JSON.stringify(rows.slice(0, 1), null, 1))

await importRows({
  source: '广发银行官网',
  license: '公开信息（官网网点查询）',
  type: 'bank',
  rows,
  dryRun: DRY,
})
