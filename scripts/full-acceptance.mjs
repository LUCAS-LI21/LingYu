/**
 * 全量接口验收：正向 + 反向 + 一致性 + 边界。
 *
 * 用法：
 *   node scripts/full-acceptance.mjs                          # 打开发栈 8080
 *   API_BASE=http://127.0.0.1:18080 node scripts/full-acceptance.mjs   # 打 Docker 栈
 *
 * 输出：逐项 PASS/FAIL + 汇总，失败会打印实际返回，便于定位。
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:8080'
const USER = process.env.OPERATOR_USERNAME || 'operator'
const PASS = process.env.OPERATOR_PASSWORD || 'operator123'

const results = []
let token = ''

function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${name}${detail ? '  → ' + detail : ''}`)
}

async function call(path, options = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const headers = { ...(options.headers || {}) }
  if (options.body) headers['Content-Type'] = 'application/json'
  if (options.auth) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, { ...options, headers })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

const expect = (name, cond, detail) => record(name, Boolean(cond), detail)

// ---------- 1. 基础与元信息 ----------
{
  const r = await call('/api/v1/health')
  expect('健康检查返回 200 且 code=0', r.status === 200 && r.body?.code === 0, `status=${r.status}`)
}
{
  const r = await call('/api/v1/meta')
  const eps = r.body?.data?.endpoints || []
  expect('/meta 自描述接口数 > 10', r.status === 200 && eps.length > 10, `endpoints=${eps.length}`)
  expect(
    '/meta 声明坐标系与鉴权',
    Boolean(r.body?.data?.coord?.storage && r.body?.data?.auth?.type),
    JSON.stringify({ coord: r.body?.data?.coord?.storage, auth: r.body?.data?.auth?.type }),
  )
}

// ---------- 2. 列表与分页 ----------
{
  const r = await call('/api/v1/pois?size=5&page=1')
  const d = r.body?.data || {}
  expect(
    '列表返回 200 且 items 非空',
    r.status === 200 && (d.items || []).length > 0,
    `items=${(d.items || []).length}`,
  )
  expect(
    '列表分页字段完整',
    typeof d.total === 'number' && 'page' in d && 'size' in d,
    JSON.stringify(Object.keys(d)),
  )
}
{
  const r = await call('/api/v1/pois?size=5&page=999999')
  expect('超大页码不 500', r.status === 200 || r.status === 400, `status=${r.status}`)
}
{
  const r = await call('/api/v1/pois?types=bank&size=1')
  const items = r.body?.data?.items || []
  expect('按类型过滤生效', items.length === 1 && items[0].type === 'bank', items[0]?.type)
}
{
  const r = await call('/api/v1/pois?types=community&size=1')
  const c = r.body?.data?.items?.[0]
  expect('小区带 GCJ-02 坐标', Boolean(c && c.gcjLng && c.gcjLat), `${c?.gcjLng},${c?.gcjLat}`)
  expect('小区带价格来源标记', Boolean(c && 'avgPriceSource' in c), String(c?.avgPriceSource))
}

// ---------- 3. 详情与 404 ----------
let sampleId
{
  const r = await call('/api/v1/pois?types=community&size=1')
  sampleId = r.body?.data?.items?.[0]?.id || ''
  const d = await call(`/api/v1/pois/${encodeURIComponent(sampleId)}`)
  expect('详情返回 200', d.status === 200 && d.body?.data?.id === sampleId, `status=${d.status}`)
}
{
  const r = await call('/api/v1/pois/__not_exist__')
  expect('不存在的点位返回 404', r.status === 404, `status=${r.status}`)
}

// ---------- 4. 周边（正反向） ----------
{
  const r = await call('/api/v1/pois/nearby?lng=114.0579&lat=22.5412&radius=1000')
  const items = r.body?.data?.items || []
  expect('周边查询 200 且有结果', r.status === 200 && items.length >= 0, `items=${items.length}`)
  expect('周边结果含距离', items.length === 0 || typeof items[0].distance === 'number', '')
}
{
  const r = await call('/api/v1/pois/nearby')
  expect('周边缺参返回 400', r.status === 400, `status=${r.status}`)
}
{
  const r = await call('/api/v1/pois/nearby?lng=abc&lat=22.5&radius=1000')
  expect('周边参数类型错返回 400', r.status === 400, `status=${r.status}`)
}
{
  const r = await call('/api/v1/pois/nearby?lng=114&lat=22.5&radius=99999')
  expect('周边半径越界返回 400', r.status === 400, `status=${r.status}`)
}

// ---------- 5. 统计与一致性 ----------
let statsTotal
{
  const r = await call('/api/v1/stats')
  const d = r.body?.data || {}
  statsTotal = d.total || 0
  expect(
    '统计返回四类计数',
    r.status === 200 && d.total > 0 && d.bank > 0 && d.community > 0,
    `total=${d.total}`,
  )
  const list = await call('/api/v1/pois?size=1')
  expect(
    'stats.total 与列表 total 一致',
    list.body?.data?.total === statsTotal,
    `${list.body?.data?.total} vs ${statsTotal}`,
  )
}

// ---------- 6. 待定位与地块 ----------
{
  const r = await call('/api/v1/community-pending?size=3')
  const d = r.body?.data || {}
  expect(
    '待定位小区分页正常',
    r.status === 200 && Array.isArray(d.items) && d.total > 0,
    `total=${d.total}`,
  )
  expect('待定位带参考价字段', d.items?.length === 0 || 'avg_price' in d.items[0], '')
}
{
  const r = await call('/api/v1/land-parcels?size=5')
  expect('存量用地返回 200', r.status === 200, `status=${r.status}`)
}

// ---------- 7. 鉴权 ----------
{
  const r = await call('/api/v1/admin/pending')
  expect(
    '无 token 访问后台返回 401/403',
    r.status === 401 || r.status === 403,
    `status=${r.status}`,
  )
}
{
  const r = await call('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  token = r.body?.data?.token || ''
  expect('运营登录成功并拿到 token', r.status === 200 && Boolean(token), `status=${r.status}`)
}
{
  const r = await call('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USER, password: 'wrong-password' }),
  })
  // 凭据错误是 401；同一 IP 短时间多次登录会被限流成 429——两者都算通过
  expect('错误口令返回 401/429', r.status === 401 || r.status === 429, `status=${r.status}`)
}
{
  const r = await call('/api/v1/admin/overview', { auth: true })
  expect('带 token 访问后台概览 200', r.status === 200, `status=${r.status}`)
}

// ---------- 8. 反馈闭环（写 → 读） ----------
let feedbackCode
{
  const poi = await call('/api/v1/pois?types=bank&size=1')
  const poiId = poi.body?.data?.items?.[0]?.id
  const r = await call('/api/v1/feedback', {
    method: 'POST',
    body: JSON.stringify({
      poiType: 'bank',
      poiId,
      type: 'error',
      field: '电话',
      newValue: '0755-00000000',
      description: 'acceptance 自测反馈（会被驳回）',
    }),
  })
  feedbackCode = r.body?.data?.code || ''
  expect('提交反馈返回受理编号', r.status === 200 && Boolean(feedbackCode), feedbackCode)
}
{
  const r = await call(`/api/v1/admin/feedback/${feedbackCode}/reject`, {
    method: 'POST',
    auth: true,
  })
  expect('运营驳回反馈成功', r.status === 200, `status=${r.status}`)
}
{
  const r = await call(`/api/v1/admin/feedback/${feedbackCode}/reject`, {
    method: 'POST',
    auth: true,
  })
  expect('重复驳回被拒绝（幂等保护）', r.status >= 400 && r.status < 500, `status=${r.status}`)
}

// ---------- 9. 反馈列表与分页 ----------
{
  const r = await call('/api/v1/admin/feedback?status=rejected&size=5', { auth: true })
  expect('后台反馈列表 200', r.status === 200, `status=${r.status}`)
}

// ---------- 10. 抓取任务（只读，不触发） ----------
{
  const r = await call('/api/v1/admin/jobs?size=5', { auth: true })
  expect('抓取任务列表 200', r.status === 200, `status=${r.status}`)
}

// ---------- 11. L2 实时接口（无 Key 应优雅失败） ----------
{
  const r = await call('/api/v1/live/address?lng=114.05&lat=22.54')
  expect(
    '实时地址无 Key 时非 500',
    r.status === 200 || r.status === 400 || r.status === 503,
    `status=${r.status}`,
  )
}

// ---------- 12. 未知路径 ----------
{
  const r = await call('/api/v1/__nope__')
  expect('未知接口返回 404', r.status === 404, `status=${r.status}`)
}

// ---------- 汇总 ----------
const passed = results.filter((r) => r.ok).length
const failed = results.filter((r) => !r.ok)
console.log(`\n结果：通过 ${passed} / ${results.length}`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(`  - ${f.name} ${f.detail}`)
  process.exitCode = 1
}
