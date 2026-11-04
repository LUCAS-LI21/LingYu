import { chromium } from '@playwright/test'

const base = process.env.APP_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const apiCalls = []
page.on('response', async (res) => {
  const url = res.url()
  if (url.includes('/api/v1/')) {
    apiCalls.push({ url: url.replace(base, ''), status: res.status() })
  }
})

await page.goto(base, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: 'shot-live-map.png' })

await page.goto(`${base}/stats`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: 'shot-live-stats.png' })

console.log(JSON.stringify(apiCalls, null, 2))
await browser.close()
