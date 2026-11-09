/**
 * 深圳农商银行（原深圳农村商业银行）网点适配器。
 *
 * 来源：www.4001961200.com/index.php/map（robots 不存在：302→/404 软 404）
 * 接口：GET /api/CMS/BranchQryList.do
 *   ?ClientType=Client&DeptType=branch&Type=1&City=深圳市
 *   - 必须带 Accept-Language: zh-CN，否则 404（后端按 locale 找模板）
 *   - 一次返回全量，无分页
 * 字段陷阱（重要）：小写 lat 存的是**经度**、小写 lon 存的是**纬度**，均为 GCJ-02；
 *   大写 Lat/Lng 是同一地点的 BD-09。入库用 GCJ-02 那套。
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

const URL_BASE = 'https://www.4001961200.com/api/CMS/BranchQryList.do'
const DISTRICTS = ['福田区', '南山区', '罗湖区', '宝安区', '龙岗区', '盐田区', '龙华区', '坪山区', '光明区', '大鹏新区', '深汕特别合作区']

function districtOf(address) {
  for (const d of DISTRICTS) if ((address || '').includes(d)) return d
  return ''
}

console.log('拉取深圳农商银行网点…')
const url = `${URL_BASE}?ClientType=Client&DeptType=branch&Type=1&City=${encodeURIComponent('深圳市')}`
const body = curlJson(url, { headers: { 'Accept-Language': 'zh-CN' } })
const list = (body.List || []).slice(0, LIMIT)
console.log(`接口返回 ${body.List?.length ?? 0} 条，本次处理 ${list.length}`)

const rows = []
let badCoords = 0
for (const item of list) {
  // 注意字段名与内容相反
  const lngRaw = Number(item.lat)
  const latRaw = Number(item.lon)
  const [lng, lat] = toWgs84(lngRaw, latRaw, 'gcj02')
  if (!inShenzhen(lng, lat)) { badCoords++; continue }
  rows.push({
    name: (item.name || '').startsWith('深圳农商银行') ? item.name : `深圳农商银行${item.name || ''}`,
    address: item.address || '',
    phone: item.phonenum || '',
    openingHours: String(item.time || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    district: districtOf(item.address),
    lng,
    lat,
    brand: '深圳农商银行',
    branchType: 'branch',
  })
}

console.log(`转换完成：${rows.length} 条（坐标越界 ${badCoords} 条）`)
console.log('样例：', JSON.stringify(rows.slice(0, 1), null, 1))

await importRows({
  source: '深圳农商银行官网',
  license: '公开信息（官网网点地图）',
  type: 'bank',
  rows,
  dryRun: DRY,
})
