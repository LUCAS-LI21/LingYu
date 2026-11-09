/**
 * 中国建设银行深圳网点适配器。
 *
 * 来源：wealth.ccb.com 网点查询网关（robots 404）
 * 接口：GET /tran/WCCMainPlatV5?...&TXCODE=NZX013&ADiv_Cd=440300&Enqr_MtdCd=1&Cur_StCd=4&PAGE_JUMP=n
 *   - ADiv_Cd：区县码（440300=全市）
 *   - Enqr_MtdCd：1 营业网点 / 2 自助银行 / 3 ATM
 *   - PAGE_JUMP：1 开始，每页固定 10 条
 * 实测：无需 Cookie；UA 必须以浏览器标识开头，否则返回空 body。
 * 坐标：GCJ-02（页面 BMAP_COORD_GCJ02），入库前转 WGS-84。
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
const ADIV = flag('district', '440300')
const TYPE = flag('type', '1')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36 poi-intel-demo/0.1'
const BASE = 'https://wealth.ccb.com/tran/WCCMainPlatV5?CCB_IBSVersion=V5&SERVLET_NAME=WCCMainPlatV5&isAjaxRequest=true&TXCODE=NZX013&isJSONRequest=true'
const DISTRICTS = ['福田区', '南山区', '罗湖区', '宝安区', '龙岗区', '盐田区', '龙华区', '坪山区', '光明区', '大鹏新区']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function districtOf(address) {
  for (const d of DISTRICTS) if ((address || '').includes(d)) return d
  return ''
}

function hm(t) {
  if (!t || /^0+:\d\d:\d\d$/.test(t)) return ''
  return t.slice(0, 5)
}

function formatHours(item) {
  const parts = []
  const weekday = hm(item.Prvt_WkDy_Oprg_StTm) && hm(item.Prvt_WkDy_Oprg_EdTm)
    ? `周一至周五 ${hm(item.Prvt_WkDy_Oprg_StTm)}-${hm(item.Prvt_WkDy_Oprg_EdTm)}`
    : ''
  const sat = hm(item.Prvt_Sat_Oprg_StTm) && hm(item.Prvt_Sat_Oprg_EdTm)
    ? `周六 ${hm(item.Prvt_Sat_Oprg_StTm)}-${hm(item.Prvt_Sat_Oprg_EdTm)}`
    : ''
  const sun = hm(item.Prvt_Sun_Oprg_StTm) && hm(item.Prvt_Sun_Oprg_EdTm)
    ? `周日 ${hm(item.Prvt_Sun_Oprg_StTm)}-${hm(item.Prvt_Sun_Oprg_EdTm)}`
    : ''
  for (const p of [weekday, sat, sun]) if (p) parts.push(p)
  return parts.join('；').slice(0, 120)
}

console.log(`拉取建行网点（ADiv_Cd=${ADIV}, 类型=${TYPE}）…`)
const rows = []
let page = 1
let totalPage = 1

while (page <= totalPage && rows.length < LIMIT) {
  const url = `${BASE}&ADiv_Cd=${ADIV}&Kywd_List_Cntnt=&Enqr_MtdCd=${TYPE}&Cur_StCd=4&PAGE_JUMP=${page}`
  const response = await fetch(url, { headers: { 'User-Agent': UA } })
  const text = (await response.text()).trim()
  let body
  try {
    body = JSON.parse(text)
  } catch (e) {
    throw new Error(`建行返回非 JSON（可能被限流）：${text.slice(0, 80)}`)
  }
  if (body.SUCCESS !== 'true') throw new Error(`接口失败：${JSON.stringify(body).slice(0, 120)}`)
  totalPage = Number(body.TOTAL_PAGE || 1)
  const list = body.OUTLET_DTL_LIST || []
  for (const item of list) {
    const [lng, lat] = toWgs84(Number(item.Lgt), Number(item.Ltt), 'gcj02')
    if (!inShenzhen(lng, lat)) continue
    const name = (item.CCBIns_Nm || '').replace(/^建行/, '中国建设银行')
    rows.push({
      name,
      address: item.Dtl_Adr || '',
      phone: (item.Fix_TelNo || '').replace(/^86-/, ''),
      openingHours: formatHours(item),
      district: districtOf(item.Dtl_Adr),
      lng,
      lat,
      brand: '中国建设银行',
      branchType: 'branch',
    })
  }
  console.log(`  第 ${page}/${totalPage} 页：累计 ${rows.length}`)
  page++
  if (page <= totalPage) await sleep(DELAY)
}

console.log(`抓取完成：${rows.length} 条`)
console.log('样例：', JSON.stringify(rows.slice(0, 1), null, 1))

await importRows({
  source: '中国建设银行官网',
  license: '公开信息（官网网点查询）',
  type: 'bank',
  rows,
  dryRun: DRY,
})
