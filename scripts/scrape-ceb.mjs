/**
 * 中国光大银行深圳网点适配器（依赖浏览器探针）。
 *
 * 特殊情况：光大官网用「瑞数」WAF，接口的 URL/请求体被动态令牌加密（?7ibksfL8= / vgL7Kuyn=），
 * 浏览器外无法重放。因此本适配器不直接请求接口，而是读取探针脚本的产物：
 *
 *   1) 先运行 `node scripts/probe-ceb.mjs`（Playwright 真实浏览器，绕不过但能正常渲染）
 *   2) 再运行本脚本导入
 *
 * 探针产物：scripts/probe-out/ceb-shenzhen.json → { branches: [{name,address,phone,lng,lat}] }
 * 坐标：未标注，按国内惯例视为 GCJ-02。
 */
import { readFileSync, existsSync } from 'node:fs'
import { importRows, inShenzhen } from './lib/import-client.mjs'
import { toWgs84 } from './lib/coord.mjs'

const args = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const LIMIT = Number(flag('limit', '999'))
const DRY = args.includes('--dry-run')
const FILE = 'scripts/probe-out/ceb-shenzhen.json'
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

if (!existsSync(FILE)) {
  console.error(`缺少探针产物 ${FILE}，请先运行：node scripts/probe-ceb.mjs`)
  process.exit(1)
}

function districtOf(address) {
  for (const d of DISTRICTS) if ((address || '').includes(d)) return d
  return ''
}

const probe = JSON.parse(readFileSync(FILE, 'utf8'))
const list = (probe.branches || []).slice(0, LIMIT)
console.log(`从探针产物读取 ${list.length} 条`)

const rows = []
let bad = 0
for (const item of list) {
  const [lng, lat] = toWgs84(Number(item.lng), Number(item.lat), 'gcj02')
  if (!inShenzhen(lng, lat)) {
    bad++
    continue
  }
  rows.push({
    name: (item.name || '').startsWith('光大银行') ? item.name : `中国光大银行${item.name || ''}`,
    address: item.address || '',
    phone: item.phone || '',
    openingHours: '',
    district: districtOf(item.address),
    lng,
    lat,
    brand: '中国光大银行',
    branchType: 'branch',
  })
}

console.log(`转换完成：${rows.length} 条（坐标越界 ${bad} 条）`)
console.log('样例：', JSON.stringify(rows.slice(0, 1), null, 1))

await importRows({
  source: '中国光大银行官网',
  license: '公开信息（官网网点查询）',
  type: 'bank',
  rows,
  dryRun: DRY,
})
