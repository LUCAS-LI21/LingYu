import { readFileSync, writeFileSync } from 'node:fs'

const ids = readFileSync('batch-ids.txt', 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
const login = await fetch('http://127.0.0.1:8080/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'operator', password: 'operator123' }),
})
const token = (await login.json()).data.token
const headers = { Authorization: 'Bearer ' + token }

const results = []
for (let i = 0; i < ids.length; i++) {
  const id = ids[i]
  const t0 = Date.now()
  try {
    const res = await fetch(`http://127.0.0.1:8080/api/v1/admin/agent/propose?entityType=bank&entityId=${id}&field=address`, { method: 'POST', headers })
    const j = await res.json()
    const d = j.data || {}
    results.push({ id, name: d.name, status: d.status, value: d.proposal?.value || '', problems: d.proposal?.problems || [], runId: d.runId, ms: Date.now() - t0 })
  } catch (e) {
    results.push({ id, status: 'exception', problems: [e.message], ms: Date.now() - t0 })
  }
  console.log(`[${i + 1}/${ids.length}] ${results[i].status} ${results[i].name || id} ${Date.now() - t0}ms`)
}
writeFileSync('data/agent-batch.json', JSON.stringify(results, null, 1))
const tally = results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {})
console.log('结果分布:', JSON.stringify(tally))
const problems = {}
for (const r of results) for (const p of r.problems) { const k = p.split('（')[0]; problems[k] = (problems[k] || 0) + 1 }
console.log('问题分布:', JSON.stringify(problems))
console.log('ready 样例:', JSON.stringify(results.filter((r) => r.status === 'ready').slice(0, 5).map((r) => ({ name: r.name, value: r.value })), null, 1))