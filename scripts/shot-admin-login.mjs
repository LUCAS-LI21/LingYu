import { chromium } from '@playwright/test'

const base = process.env.APP_URL || 'http://127.0.0.1:5173'
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

await page.goto(`${base}/admin`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.screenshot({ path: 'shot-admin-login.png' })

await page.getByPlaceholder('请输入口令').fill('operator123')
await page.getByRole('button', { name: '登录' }).click()
await page.waitForTimeout(1800)
await page.screenshot({ path: 'shot-admin-authed.png' })

console.log('login screenshots done')
await browser.close()
