/**
 * 深圳市政府数据开放平台 · 数据接口抓取器
 *
 * 背景：平台提示"数据过多建议直接调用接口"，且下载有 1 万条上限。
 * 接口不收费（平台条款：免费获取、非排他使用权；禁止转让/镜像），
 * 但必须用**自己账号**申请的 appKey（文档里的示例 key 已失效，返回 10001）。
 *
 * 用法：
 *   node scripts/fetch-opendata-api.mjs \
 *     --api "api/1514671018/1/service.xhtml" \
 *     --appkey 你的appKey \
 *     --type community --enrich \
 *     --map "PRJ_NAME=name,ZDJ=avgPrice,ZONE=district"
 *
 * 说明：
 * - --enrich：数据集没有坐标时用，按名称匹配已有 POI 补字段，绝不新建无坐标记录
 * - 分页参数 page/rows，默认 500 条/页
 * - 限速 1 请求/秒
 */
const args = process.argv.slice(2)
const flag = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const hasFlag = (name) => args.includes(`--${name}`)

const apiPath = flag('api')
const appKey = flag('appkey') || process.env.SZ_OPENDATA_APPKEY
const type = flag('type', 'community')
const source = flag('source', '深圳市政府数据开放平台')
const license = flag('license', '政府公开信息（署名）')
const mappingArg = flag('map')
const rowsPerPage = Number(flag('rows', '500'))
const maxPages = Number(flag('max-pages', '200'))
const apiBase = flag('backend', 'http://127.0.0.1:8080')
const enrich = hasFlag('enrich') || type === 'community'
const dryRun = hasFlag('dry-run')

if (!apiPath || !appKey || !mappingArg) {
  console.error(
    '缺少参数。示例：--api "api/xxxx/1/service.xhtml" --appkey 你的key --type community --map "PRJ_NAME=name,ZDJ=avgPrice,ZONE=district"',
  )
  process.exit(1)
}

const mapping = mappingArg.split(',').map((pair) => {
  const [column, field] = pair.split('=')
  return { column: (column ?? '').trim(), field: (field ?? '').trim() }
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const numeric = new Set(['lng', 'lat', 'builtYear', 'avgPrice', 'propertyFee'])

function normalizeRow(raw) {
  const row = {}
  for (const { column, field } of mapping) {
    const value = raw[column]
    if (value === null || value === undefined) continue
    const text = String(value).trim()
    if (!text) continue
    if (numeric.has(field)) {
      const parsed = Number(text)
      if (!Number.isFinite(parsed)) continue
      row[field] = parsed
    } else {
      row[field] = text
    }
  }
  return row
}

async function fetchPage(page) {
  const url = `https://opendata.sz.gov.cn/${apiPath}?page=${page}&rows=${rowsPerPage}&appKey=${encodeURIComponent(appKey)}`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'poi-intel-demo/0.1 (academic demo; contact 2396845790@qq.com)' },
  })
  const body = await response.json()
  if (body.errorCode) {
    throw new Error(`平台返回 ${body.errorCode}：${body.message}（检查 appKey 是否已授权该接口）`)
  }
  // 常见结构：{data:[...]} / {rows:[...]} / 直接数组
  const list = body.data || body.rows || body.result || (Array.isArray(body) ? body : [])
  return { list, raw: body }
}

const collected = []
let page = 1
let total = null

while (page <= maxPages) {
  let pageResult
  try {
    pageResult = await fetchPage(page)
  } catch (error) {
    console.error(`第 ${page} 页抓取失败：${error.message}`)
    if (collected.length === 0) process.exit(1)
    break
  }
  const { list, raw } = pageResult
  total = raw.total ?? raw.count ?? total
  if (!Array.isArray(list) || list.length === 0) {
    console.log(`第 ${page} 页为空，结束`)
    break
  }
  for (const item of list) {
    const row = normalizeRow(item)
    if (Object.keys(row).length) collected.push(row)
  }
  console.log(
    `第 ${page} 页：${list.length} 条，累计 ${collected.length}${total ? ` / 共 ${total}` : ''}`,
  )
  if (total && collected.length >= Number(total)) break
  if (list.length < rowsPerPage) break
  page++
  await sleep(1000)
}

console.log(`\n抓取完成，共 ${collected.length} 条`)
if (dryRun) {
  console.log('前 3 条：', JSON.stringify(collected.slice(0, 3), null, 2))
  process.exit(0)
}

const login = await fetch(`${apiBase}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: process.env.OPERATOR_USERNAME || 'operator',
    password: process.env.OPERATOR_PASSWORD || 'operator123',
  }),
})
const token = (await login.json()).data?.token
if (!token) {
  console.error('后端登录失败')
  process.exit(1)
}

const batchSize = 500
let inserted = 0
let updated = 0
let skipped = 0
let unchanged = 0

for (let i = 0; i < collected.length; i += batchSize) {
  const chunk = collected.slice(i, i + batchSize)
  const response = await fetch(`${apiBase}/api/v1/admin/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ source, license, type, enrich, rows: chunk }),
  })
  const body = await response.json()
  if (body.code !== 0) {
    console.error('导入失败：', body.message)
    process.exit(1)
  }
  inserted += body.data.inserted
  updated += body.data.updated
  skipped += body.data.skipped
  unchanged += body.data.unchanged ?? 0
  console.log(
    `导入第 ${Math.floor(i / batchSize) + 1} 批：新增 ${body.data.inserted} / 更新 ${body.data.updated} / 未变 ${body.data.unchanged ?? 0} / 跳过 ${body.data.skipped}`,
  )
  if (body.data.errors?.length) console.log('  样例：', body.data.errors.slice(0, 3).join('；'))
}

console.log(`\n完成：新增 ${inserted}，更新 ${updated}，未变 ${unchanged}，跳过 ${skipped}`)
console.log('提醒：须注明「数据来源：深圳市政府数据开放平台」，且不得转让数据。')
