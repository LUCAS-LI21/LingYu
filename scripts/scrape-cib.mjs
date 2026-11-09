/**
 * 兴业银行深圳网点适配器（暂存模式）。
 *
 * 来源：branch.cib.com.cn/ShenZhen/outlets/index.html
 * 页面是纯 HTML 表格：营业网点名称 / 详细地址 / 电话 / 营业时间，共 50 家，**无经纬度**。
 * 官方地图接口用 SM2 加密（请求 {encrypt,signature}），坐标不可得。
 *
 * 因为没有坐标，这里不写 poi_bank（那等于编造位置），而是写入 bank_pending 暂存表，
 * 等人工确认坐标或接入地理编码后再转正（POST /api/v1/admin/pending/{id}/promote）。
 *
 * robots：www.cib.com.cn 404；branch.cib.com.cn 返回 HTML 404 页；e.cib.com.cn 为 SPA。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { curlText } from './lib/http.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const LIMIT = Number(flag('limit', '999'))
const DRY = args.includes('--dry-run')
const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const PAGE = 'https://branch.cib.com.cn/ShenZhen/outlets/index.html'
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

function clean(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

console.log('抓取兴业银行深圳网点（HTML 表格）…')
const html = await curlText(PAGE)
const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
  .map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => clean(c[1])))
  .filter((cells) => cells.length >= 4 && cells[0] !== '营业网点名称')

const rowsOut = []
for (const cells of rows.slice(0, LIMIT)) {
  const [name, address, phone, hours] = cells
  if (!name || !name.includes('银行')) continue
  rowsOut.push({
    name,
    address: address || '',
    phone: phone || '',
    openingHours: (hours || '')
      .replace(/网点节假日营业时间以公告为准.*$/, '')
      .trim()
      .slice(0, 120),
    district: districtOf(address),
  })
}

console.log(`解析出 ${rowsOut.length} 家（源站表格共 ${rows.length} 行）`)
console.log('样例：', JSON.stringify(rowsOut.slice(0, 1), null, 1))

// 原始快照留档
mkdirSync('data/raw', { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(`data/raw/cib-${stamp}.xml`, html, 'utf8')

if (DRY) {
  console.log('[dry-run] 不写入暂存表')
  process.exit(0)
}

const login = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: process.env.OPERATOR_USERNAME || 'operator',
    password: process.env.OPERATOR_PASSWORD || 'operator123',
  }),
})
const token = (await login.json())?.data?.token
if (!token) throw new Error('登录失败')

const response = await fetch(`${API}/api/v1/admin/pending/import`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ source: '兴业银行官网', sourceUrl: PAGE, rows: rowsOut }),
})
const body = await response.json()
if (body.code !== 0) throw new Error(`导入失败：${body.message}`)
console.log('暂存结果：', JSON.stringify(body.data))
console.log('提示：这些网点无坐标，需人工确认后调用 /api/v1/admin/pending/{id}/promote 转正。')
