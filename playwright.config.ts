import { defineConfig, devices } from '@playwright/test'

// 未下载 Playwright 自带内核时，可用系统浏览器跑：
// PLAYWRIGHT_CHANNEL=chrome 或 msedge
const channel = process.env.PLAYWRIGHT_CHANNEL as 'chrome' | 'msedge' | undefined
const withChannel = channel ? { channel } : {}

// E2E：全程走“构建产物”而不是 dev server，保证与线上行为一致
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...withChannel } },
    { name: 'mobile', use: { ...devices['Pixel 5'], ...withChannel } },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
