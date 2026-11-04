import { chromium } from '@playwright/test'

const base = process.env.APP_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

await page.goto(`${base}/admin`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: 'shot-admin-overview.png' })

await page.getByRole('button', { name: '反馈审核' }).click()
await page.waitForTimeout(1200)
await page.screenshot({ path: 'shot-admin-feedback.png' })

await page.getByRole('button', { name: '抓取任务' }).click()
await page.waitForTimeout(900)
await page.screenshot({ path: 'shot-admin-jobs.png' })

console.log('admin screenshots done')
await browser.close()
