/**
 * 轻量负载测试：并发打关键读接口，统计 p50/p95/p99 与错误率。
 *
 * 用法：node scripts/load-test.mjs [并发=20] [每接口请求数=50]
 * 目标：不追求压测精度，只验证"演示级并发下不塌、延迟可接受"。
 */
const BASE = process.env.API_BASE || 'http://127.0.0.1:8080'
const CONCURRENCY = Number(process.argv[2] || 20)
const PER_ENDPOINT = Number(process.argv[3] || 50)

const endpoints = [
  { name: '列表 /pois?size=20', path: '/api/v1/pois?size=20' },
  { name: '地图 /pois?size=5000&lite', path: '/api/v1/pois?size=5000&lite=true' },
  { name: '统计 /stats', path: '/api/v1/stats' },
  { name: '待定位 /community-pending?size=20', path: '/api/v1/community-pending?size=20' },
]

async function timed(path) {
  const started = process.hrtime.bigint()
  try {
    const res = await fetch(`${BASE}${path}`)
    await res.arrayBuffer()
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    return { ms, ok: res.ok, status: res.status }
  } catch (err) {
    const ms = Number(process.hrtime.bigint() - started) / 1e6
    return { ms, ok: false, status: 0, error: String(err.message).slice(0, 40) }
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

for (const ep of endpoints) {
  const results = []
  let cursor = 0
  async function worker() {
    while (cursor < PER_ENDPOINT) {
      cursor += 1
      results.push(await timed(ep.path))
    }
  }
  const started = Date.now()
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  const elapsed = Date.now() - started
  const times = results.map((r) => r.ms).sort((a, b) => a - b)
  const failures = results.filter((r) => !r.ok)
  const rps = (results.length / elapsed) * 1000
  console.log(
    `${ep.name}\n  n=${results.length} 并发=${CONCURRENCY} 用时=${elapsed}ms ` +
      `qps=${rps.toFixed(1)} p50=${percentile(times, 50).toFixed(0)}ms ` +
      `p95=${percentile(times, 95).toFixed(0)}ms p99=${percentile(times, 99).toFixed(0)}ms ` +
      `失败=${failures.length}${failures[0] ? ' (' + failures[0].status + ')' : ''}`,
  )
}
