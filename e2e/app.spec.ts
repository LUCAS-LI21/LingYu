import { expect, test } from '@playwright/test'

test.describe('核心链路', () => {
  test('首页展示六大阶段', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: /网站开发六阶段/ })).toBeVisible()
    for (const phase of ['需求分析', '设计', '实现', '测试', '部署', '业务闭环']) {
      await expect(page.getByText(phase, { exact: true }).first()).toBeVisible()
    }
  })

  test('任务看板可新增并推进任务', async ({ page }) => {
    await page.goto('/board')

    const input = page.getByPlaceholder('写下一个待办，例如：补齐登录页 E2E')
    await input.fill('补齐登录页 E2E')
    await page.getByRole('button', { name: '添加任务' }).click()

    const row = page.locator('li', { hasText: '补齐登录页 E2E' })
    await expect(row).toBeVisible()
    await expect(row.getByText('待开始')).toBeVisible()

    await row.getByRole('button', { name: '推进' }).click()
    await expect(row.getByText('进行中')).toBeVisible()
  })

  test('未知路由落到 404 页', async ({ page }) => {
    await page.goto('/not-exist-page')

    await expect(page.getByText('404')).toBeVisible()
    await expect(page.getByRole('heading', { name: /这个页面还没被设计出来/ })).toBeVisible()
  })
})
