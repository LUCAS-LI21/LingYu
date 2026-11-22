/**
 * 初赛「初步验证」证据快照：对运行中的后端逐接口取证，产出可复现的 JSON + Markdown。
 *
 * 用法：
 *   API_BASE=http://127.0.0.1:18080 OPERATOR_PASSWORD=*** node scripts/evidence-snapshot.mjs
 *
 * 输出：
 *   docs/preliminary/assets/evidence-snapshot.json  逐接口原始记录（状态码、耗时、响应）
 *   docs/preliminary/assets/evidence-snapshot.md    可直接贴进文档的表格
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.API_BASE || 'http://127.0.0.1:8080'
const USER = process.env.OPERATOR_USERNAME || 'operator'
const PASS = process.env.OPERATOR_PASSWORD || ''
const OUT = join('docs', '初赛', 'assets')
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)

const rows = []
let token = ''

async function call(name, path, { method = 'GET', body, auth = false, expect } = {}) {
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (auth && token) headers.Authorization = `Bearer ${token}`
  const started = performance.now()
  let status = 0
  let json = null
  let error = ''
  try {
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    status = res.status
    const text = await res.text()
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = text
    }
  } catch (e) {
    error = e.message
  }
  const ms = Math.round(performance.now() - started)
  const ok = expect ? status === expect : status >= 200 && status < 300 && !error
  rows.push({ name, method, path, status, ms, ok, expect: expect || '2xx', error, body: json })
  console.log(`${status || 'ERR'}  ${name}  ${ms}ms  ${path}`)
  return { status, json, ms }
}

// ---- 公开接口 ----
await call('健康检查', '/api/v1/health')
await call('元信息', '/api/v1/meta')
const list = await call('列表首页', '/api/v1/pois?size=3&page=1')
await call('列表-按区域筛选', '/api/v1/pois?district=' + encodeURIComponent('南山区') + '&size=2')
const community = await call('列表-小区', '/api/v1/pois?types=community&size=2')
await call('统计', '/api/v1/stats')
await call('周边银行 1km', '/api/v1/pois/nearby?lng=114.0579&lat=22.5431&radius=1000&limit=5')
await call('待定位小区', '/api/v1/community-pending?size=3')
await call('存量住宅用地', '/api/v1/land-parcels?limit=3')
await call('L2 实时地址（无 Key 降级）', '/api/v1/live/address?lng=114.0579&lat=22.5431')

const firstId = list.json?.data?.items?.[0]?.id
if (firstId) await call('详情', `/api/v1/pois/${encodeURIComponent(firstId)}`)
const communityId = community.json?.data?.items?.[0]?.id
if (communityId) {
  await call('详情-字段级来源', `/api/v1/pois/${encodeURIComponent(communityId)}/sources`)
  await call(
    '最近 3 家银行',
    `/api/v1/pois/${encodeURIComponent(communityId)}/nearest-banks?limit=3&radius=5000`,
  )
}

// ---- 鉴权 ----
const login = await call('运营登录', '/api/v1/auth/login', {
  method: 'POST',
  body: { username: USER, password: PASS },
})
token = login.json?.data?.token || ''

// ---- 运营接口 ----
await call('后台概览', '/api/v1/admin/overview', { auth: true })
await call('反馈列表', '/api/v1/admin/feedback?status=pending&size=3', { auth: true })
await call('抓取任务', '/api/v1/admin/jobs?size=5', { auth: true })
await call('热点排行', '/api/v1/admin/hotspots', { auth: true })
await call('无 token 访问后台（应 401）', '/api/v1/admin/overview', { expect: 401 })
await call('未知接口（应 404）', '/api/v1/not-exist', { expect: 404 })

// ---- 汇总 ----
const ok = rows.filter((r) => r.ok).length
const lines = [
  `# 初步验证 · 接口快照`,
  '',
  `- 采集时间：${stamp}（本机时区）`,
  `- 目标环境：\`${BASE}\``,
  `- 结果：**${ok} / ${rows.length}** 成功`,
  '',
  '| # | 验证项 | 方法与路径 | 状态码 | 耗时 | 结果 |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows.map(
    (r, i) =>
      `| ${i + 1} | ${r.name} | \`${r.method} ${r.path}\` | ${r.status || 'ERR'} | ${r.ms} ms | ${r.ok ? 'PASS' : 'FAIL'} |`,
  ),
  '',
]
mkdirSync(OUT, { recursive: true })
writeFileSync(
  join(OUT, 'evidence-snapshot.json'),
  JSON.stringify({ base: BASE, stamp, rows }, null, 2),
  'utf8',
)
writeFileSync(join(OUT, 'evidence-snapshot.md'), lines.join('\n'), 'utf8')
console.log(`\n汇总：${ok} / ${rows.length} 通过；证据已写入 ${OUT}`)
if (ok !== rows.length) process.exitCode = 1
