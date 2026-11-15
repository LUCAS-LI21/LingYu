const endpoints = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]
const q = '[out:json][timeout:10];node(22.54,114.05,22.55,114.06);out 1;'
for (const ep of endpoints) {
  try {
    const res = await fetch(ep, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(q),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'poi-intel-research/0.1',
      },
    })
    const text = await res.text()
    console.log(ep.split('/')[2], '→', res.status, text.slice(0, 100).replace(/\s+/g, ' '))
  } catch (e) {
    console.log(ep.split('/')[2], '→ 异常', e.message.slice(0, 80))
  }
  await new Promise((r) => setTimeout(r, 1500))
}
