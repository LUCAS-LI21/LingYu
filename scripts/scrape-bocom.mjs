/**
 * 交通银行深圳网点适配器。
 *
 * 来源：www.bankcomm.com 网点查询（robots 404，无声明）
 * 接口：POST /SITE/queryBranchResult.do
 *   form: REQ_MESSAGE={"REQ_HEAD":{"TRAN_PROCESS":"","TRAN_ID":""},
 *                      "REQ_BODY":{"URL_TYPE":"","CITY":"深圳市","COUNTY_NAME":""}}
 *   注意：REQ_BODY 只能这 3 个键，多塞字段会返回 count=0（实测踩过）
 * 返回：data 为 p0..pN 的对象（非数组），字段 n=名称 a=地址 p=对私电话 o=对公电话
 *       t=营业时间 x=经度 y=纬度（均为 URL 编码字符串）
 * 坐标：GCJ-02（页面用 from=3&to=5 送百度 geoconv，偏移量吻合），入库前转 WGS-84。
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

const URL = 'https://www.bankcomm.com/SITE/queryBranchResult.do'
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

const decode = (v) => {
  try {
    return decodeURIComponent(String(v ?? '').replace(/\+/g, ' '))
  } catch (e) {
    return String(v ?? '')
  }
}

function districtOf(address) {
  for (const d of DISTRICTS) if ((address || '').includes(d)) return d
  return ''
}

console.log('拉取交通银行深圳网点…')
const message = JSON.stringify({
  REQ_HEAD: { TRAN_PROCESS: '', TRAN_ID: '' },
  REQ_BODY: { URL_TYPE: '', CITY: '深圳市', COUNTY_NAME: '' },
})
const body = curlJson(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'zh-CN' },
  referer:
    'https://www.bankcomm.com/BankCommSite/shtml/jyjr/cn/7158/8203/list.shtml?channelId=7158',
  body: 'REQ_MESSAGE=' + encodeURIComponent(message),
})

const data = body?.RSP_BODY?.branch?.data || {}
const items = Object.keys(data)
  .map((k) => data[k])
  .filter((v) => v && typeof v === 'object')
console.log(`接口返回 ${items.length} 条`)

const rows = []
let bad = 0
for (const item of items.slice(0, LIMIT)) {
  const [lng, lat] = toWgs84(Number(item.x), Number(item.y), 'gcj02')
  if (!inShenzhen(lng, lat)) {
    bad++
    continue
  }
  const name = decode(item.n)
  const address = decode(item.a)
  const phone = [decode(item.p), decode(item.o)].filter(Boolean).join(' / ')
  rows.push({
    name: name.startsWith('交通银行') ? name : `交通银行${name}`,
    address,
    phone,
    openingHours: decode(item.t).slice(0, 120),
    district: districtOf(address),
    lng,
    lat,
    brand: '交通银行',
    branchType: 'branch',
  })
}

console.log(`转换完成：${rows.length} 条（坐标越界 ${bad} 条）`)
console.log('样例：', JSON.stringify(rows.slice(0, 1), null, 1))

await importRows({
  source: '交通银行官网',
  license: '公开信息（官网网点查询）',
  type: 'bank',
  rows,
  dryRun: DRY,
})
