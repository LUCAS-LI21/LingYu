/**
 * 扫描深圳市政府数据开放平台的目录，找出与银行/小区相关的数据集。
 *
 * 合规说明：
 * - 该平台 robots.txt 未声明禁止（返回 404）
 * - 只读目录元数据（标题/单位/更新时间），不下载正文
 * - 限速 ≤ 2 请求/秒，带自定义 UA
 */
import { writeFileSync } from 'node:fs'

const BASE = 'https://opendata.sz.gov.cn'
const UA = 'poi-intel-demo/0.1 (academic demo; contact 2396845790@qq.com)'
const DELAY_MS = 600
const MAX_PAGES = 400

const KEYWORDS = /小区|住宅|物业|房地|住房|楼|社区|银行|金融|地名|人口|网格|建筑/

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchPage(pageNo) {
  const response = await fetch(`${BASE}/data/dataSet/findPage`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${BASE}/data/dataSet/toDataSet`,
    },
    body: `pageNo=${pageNo}&rows=20`,
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json()
  const inner = JSON.parse(body.dataList || '{}')
  return inner.list || []
}

const all = []
const seen = new Set()

for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
  const list = await fetchPage(pageNo)
  if (list.length === 0) {
    console.log(`第 ${pageNo} 页为空，结束`)
    break
  }
  let added = 0
  for (const item of list) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    all.push({
      id: item.id,
      title: item.resTitle,
      office: item.officeName,
      updateDate: item.updateDate,
      downloads: Number(item.downloads || 0),
      resId: item.resId,
    })
    added++
  }
  if (pageNo % 20 === 0 || pageNo === 1) {
    console.log(`第 ${pageNo} 页：累计 ${all.length} 条（本页新增 ${added}）`)
  }
  if (added === 0) {
    console.log(`第 ${pageNo} 页无新增，判定到底，结束`)
    break
  }
  await sleep(DELAY_MS)
}

const hits = all.filter((d) => KEYWORDS.test(d.title || ''))
writeFileSync('data/opendata-catalog.json', JSON.stringify({ total: all.length, hits }, null, 2))

console.log(`\n总计 ${all.length} 个数据集，命中关键词 ${hits.length} 个：`)
for (const hit of hits.slice(0, 40)) {
  console.log(`  ${hit.id} | ${hit.title} | ${hit.office} | 下载 ${hit.downloads}`)
}
