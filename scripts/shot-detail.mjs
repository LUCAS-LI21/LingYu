import { chromium } from '@playwright/test'

const base = process.env.APP_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

await page.goto(`${base}/list`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="poi-card"]', { timeout: 20000 })
await page.locator('[data-testid="poi-card"]').first().click()
await page.waitForTimeout(1200)
await page.screenshot({ path: 'shot-detail-address.png' })
console.log('detail screenshot done')
await browser.close()
