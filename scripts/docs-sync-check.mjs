/**
 * 文档同步自检：把「库里的事实」与「文档里写的数字」对一遍。
 *
 * 用法：
 *   node scripts/docs-sync-check.mjs                    # 打 18080
 *   API_BASE=http://127.0.0.1:8080 node scripts/docs-sync-check.mjs
 *
 * 退出码：0 全部一致；1 有事实没在文档里出现（说明文档该同步了）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.API_BASE || 'http://127.0.0.1:18080'
const SRC = join('docs', '初赛', 'src')

function envValue(key) {
  try {
    const line = readFileSync('.env', 'utf8')
      .split('\n')
      .find((l) => l.startsWith(key + '='))
    return line ? line.slice(key.length + 1).trim() : ''
  } catch {
    return ''
  }
}

const USER = process.env.OPERATOR_USERNAME || envValue('OPERATOR_USERNAME') || 'operator'
const PASS = process.env.OPERATOR_PASSWORD || envValue('OPERATOR_PASSWORD')

const fmt = (n) => Number(n).toLocaleString('en-US')
const pct = (a, b) => ((a / b) * 100).toFixed(1) + '%'

async function get(path, headers = {}) {
  const res = await fetch(BASE + path, { headers })
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return (await res.json()).data
}

async function main() {
  const health = await get('/api/v1/health')
  if (health.status !== 'ok') throw new Error('后端未就绪')

  let token = ''
  try {
    const res = await fetch(BASE + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    })
    if (res.ok) token = (await res.json()).data.token
  } catch {
    /* 管理接口拿不到就跳过相关事实 */
  }

  const stats = await get('/api/v1/stats')
  const pending = await get('/api/v1/community-pending?size=1')
  const parcels = await get('/api/v1/land-parcels?limit=1')
  const overview = token ? await get('/api/v1/admin/overview', { Authorization: `Bearer ${token}` }) : null

  // strict=false 的是「会随定时任务持续增长」的快照型事实，允许与文档有出入
  const facts = [
    ['POI 总数', fmt(stats.total), true],
    ['银行总数', fmt(stats.bank), true],
    ['ATM 数量', fmt(stats.atm), true],
    ['小区总数（视图内）', fmt(stats.community), true],
    ['待定位小区', fmt(pending.total), true],
    ['存量住宅用地', fmt(parcels.total), true],
    ['银行覆盖率', pct(stats.bank, 1989), true],
  ]
  if (overview) {
    facts.push(['变更版本数', fmt(overview.versions), false])
    facts.push(['抓取任务数', fmt(overview.totalJobs), false])
    facts.push(['热点网格数', fmt(overview.hotRegions), false])
  }

  const docs = readdirSync(SRC)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ name: f, text: readFileSync(join(SRC, f), 'utf8') }))

  let missing = 0
  console.log(`基准：${BASE}  文档：${docs.length} 份\n`)
  console.log('事实'.padEnd(22) + '实时值'.padEnd(12) + '出现于')
  console.log('-'.repeat(70))
  for (const [label, value, strict] of facts) {
    const hit = docs.filter((d) => d.text.includes(value)).map((d) => d.name.replace('.md', ''))
    if (hit.length === 0 && strict) missing += 1
    const tail = hit.length ? hit.join('、') : strict ? '『缺失，需要同步』' : '（快照值，允许漂移）'
    console.log(label.padEnd(20) + String(value).padEnd(14) + tail)
  }

  if (missing) {
    console.log(`\n有 ${missing} 项事实未出现在文档中：先更新 docs/初赛/src/*.md，再重跑构建。`)
    process.exitCode = 1
  } else {
    console.log('\n全部事实都能在文档中找到。')
  }
}

main().catch((e) => {
  console.error('自检失败：', e.message)
  process.exitCode = 2
})
