/**
 * 中信银行深圳网点适配器。
 *
 * 来源：etrade.citicbank.com 网点查询（www.citicbank.com robots 404）
 * 接口：POST /portalweb/pq/branchSearch.htm
 *   参数：cpLng/cpLat、cityName=深圳市、pageFlag=0、tcstNo、userId、
 *         pwdControlFlag=0、responseFormat=JSON、random
 * 返回：totalCount + content.resultList[]（branchName/branchAdd/branchTel/bsnTime/branchLng/branchLat）
 * 特点：一次返回全量（50 条），无分页；无需 Cookie。
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

const URL = 'https://etrade.citicbank.com/portalweb/pq/branchSearch.htm'
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

function districtOf(address) {
  for (const d of DISTRICTS) if ((address || '').includes(d)) return d
  return ''
}

console.log('拉取中信银行深圳网点…')
const form = new URLSearchParams({
  cpLng: '114.06',
  cpLat: '22.54',
  cityName: '深圳市',
  pageFlag: '0',
  tcstNo: '',
  userId: '',
  pwdControlFlag: '0',
  responseFormat: 'JSON',
  random: String(Date.now()),
}).toString()

const json = curlJson(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  referer: 'https://etrade.citicbank.com/',
  body: form,
})
const list = (json?.content?.resultList || []).slice(0, LIMIT)
console.log(`接口返回 ${json?.totalCount ?? 0} 条，本次处理 ${list.length}`)

const rows = []
let bad = 0
for (const item of list) {
  const [lng, lat] = toWgs84(Number(item.branchLng), Number(item.branchLat), 'gcj02')
  if (!inShenzhen(lng, lat)) {
    bad++
    continue
  }
  rows.push({
    name: (item.branchName || '').startsWith('中信银行')
      ? item.branchName
      : `中信银行${item.branchName || ''}`,
    address: item.branchAdd || '',
    phone: item.branchTel || '',
    openingHours: String(item.bsnTime || '')
      .replace(/\s+/g, ' ')
      .slice(0, 120),
    district: districtOf(item.branchAdd),
    lng,
    lat,
    brand: '中信银行',
    branchType: 'branch',
  })
}

console.log(`转换完成：${rows.length} 条（坐标越界 ${bad} 条）`)
console.log('样例：', JSON.stringify(rows.slice(0, 1), null, 1))

await importRows({
  source: '中信银行官网',
  license: '公开信息（官网网点查询）',
  type: 'bank',
  rows,
  dryRun: DRY,
})
