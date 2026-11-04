import { chromium } from '@playwright/test'

const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

async function shot(path, file, waitFor) {
  await page.goto(base + path, { waitUntil: 'networkidle' })
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 20000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: file })
  console.log('shot', file)
}

await shot('/', 'shot-map.png', '[data-testid="result-count"]')
await shot('/list', 'shot-list.png', '[data-testid="poi-card"]')
await shot('/stats', 'shot-stats.png')
await shot('/compliance', 'shot-compliance.png')

await browser.close()
