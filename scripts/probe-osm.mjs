const UA = 'poi-intel-demo/0.1 (academic demo; contact 2396845790@qq.com)'
const q1 =
  '[out:json][timeout:90];node["amenity"~"^(bank|atm)$"](22.50,114.00,22.58,114.10);out count;'
const q2 =
  '[out:json][timeout:90];way["landuse"="residential"](22.50,114.00,22.58,114.10);out count;'
async function run(name, q) {
  const t0 = Date.now()
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
        Accept: 'application/json',
      },
      body: 'data=' + encodeURIComponent(q),
      signal: AbortSignal.timeout(150000),
    })
    const txt = await r.text()
    console.log(
      name,
      r.status,
      ((Date.now() - t0) / 1000).toFixed(1) + 's',
      txt.replace(/\s+/g, ' ').slice(0, 400),
    )
  } catch (e) {
    console.log(name, 'ERR', e.message, ((Date.now() - t0) / 1000).toFixed(1) + 's')
  }
}
await run('BANK_ATM', q1)
await run('RESIDENTIAL', q2)
