const API = 'http://127.0.0.1:8080'
const districts = [
  ['龙岗区', 22.55, 114.05, 22.8, 114.35],
  ['龙华区', 22.6, 113.95, 22.75, 114.1],
  ['坪山区', 22.6, 114.25, 22.8, 114.45],
  ['光明区', 22.68, 113.8, 22.85, 113.98],
  ['盐田区', 22.55, 114.2, 22.65, 114.32],
  ['大鹏新区', 22.5, 114.4, 22.65, 114.6],
]
const login = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'operator', password: 'operator123' }),
})
const token = (await login.json()).data.token
const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }

for (const [name, s, w, n, e] of districts) {
  // 等当前任务结束
  for (let i = 0; i < 120; i++) {
    const jobs = await (await fetch(`${API}/api/v1/admin/jobs?size=5`, { headers })).json()
    const running = (jobs.data?.items || []).filter((j) =>
      ['pending', 'running'].includes(j.status),
    )
    if (running.length === 0) break
    await new Promise((r) => setTimeout(r, 5000))
  }
  const res = await fetch(`${API}/api/v1/admin/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ south: s, west: w, north: n, east: e }),
  })
  const body = await res.json()
  console.log(name, '->', body.code === 0 ? `job#${body.data.jobId}` : body.message)
  await new Promise((r) => setTimeout(r, 4000))
}
console.log('全部提交完成')
