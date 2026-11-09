/**
 * 中国农业银行深圳网点适配器。
 *
 * 来源：app.abchina.com.cn/branch/（robots 404）
 * 接口：POST /branch/Branch  body {provinceId,cityId,boroughId,tplType,bizType,pageIndex}
 * 返回：data.responseBody.totalCount + listSearchResultCollectionVo[].BranchBankVo
 * 坐标：官方前端做 gcj02→bd09 转换，故为 GCJ-02；入库前转 WGS-84。
 * 注意：接口不提供营业时间。
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

const URL = 'https://app.abchina.com.cn/branch/Branch'
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

console.log('拉取农行深圳网点…')
const rows = []
let pageIndex = 0
let total = null

while (rows.length < LIMIT) {
  // 注意：这个接口只认 form 编码，JSON 会被忽略过滤条件（返回全国 2 万条）
  const form = new URLSearchParams({
    provinceId: '440000',
    cityId: '440300',
    boroughId: '-1',
    tplType: '1',
    bizType: '0',
    pageIndex: String(pageIndex),
  }).toString()
  const body = curlJson(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    referer: 'https://app.abchina.com.cn/branch/',
    body: form,
  })
  const payload = body?.data?.responseBody || {}
  total = payload.totalCount ?? total
  const list = payload.listSearchResultCollectionVo || []
  if (list.length === 0) break
  for (const item of list) {
    const b = item.BranchBankVo || {}
    const [lng, lat] = toWgs84(Number(b.Longitude), Number(b.Latitude), 'gcj02')
    if (!inShenzhen(lng, lat)) continue
    rows.push({
      name: (b.Name || '').startsWith('中国农业银行') ? b.Name : `中国农业银行${b.Name || ''}`,
      address: b.FullAddress || '',
      phone: b.PhoneNumber || '',
      district: districtOf(b.FullAddress),
      lng,
      lat,
      brand: '中国农业银行',
      branchType: 'branch',
    })
  }
  console.log(`  第 ${pageIndex + 1} 页：累计 ${rows.length}${total ? ` / ${total}` : ''}`)
  pageIndex++
  if (total && rows.length >= Number(total)) break
  if (rows.length >= LIMIT) break
  await sleep(DELAY)
}

console.log(`抓取完成：${rows.length} 条`)
console.log('样例：', JSON.stringify(rows.slice(0, 1), null, 1))

await importRows({
  source: '中国农业银行官网',
  license: '公开信息（官网网点查询）',
  type: 'bank',
  rows,
  dryRun: DRY,
})
