import { expect, test } from '@playwright/test'

/** 读取隐藏计数器里的命中数（桌面与移动布局通用） */
async function readCount(page: import('@playwright/test').Page): Promise<number> {
  const text = await page.getByTestId('result-count').textContent()
  return Number((text ?? '').replace(/[^\d]/g, ''))
}

test.describe('邻域 POI 主流程', () => {
  test('地图页加载真实 POI 并展示结果', async ({ page }) => {
    await page.goto('/')

    await expect.poll(() => readCount(page), { timeout: 25_000 }).toBeGreaterThan(100)
    await expect(page.locator('[data-testid="poi-card"]:visible').first()).toBeVisible()
  })

  test('搜索可缩小结果集', async ({ page }) => {
    await page.goto('/')
    await expect.poll(() => readCount(page), { timeout: 25_000 }).toBeGreaterThan(100)
    const before = await readCount(page)

    await page.getByPlaceholder('搜索网点 / 小区名称').fill('招商')
    await expect.poll(() => readCount(page), { timeout: 10_000 }).toBeGreaterThan(0)
    expect(await readCount(page)).toBeLessThan(before)
  })

  test('列表页可按均价排序并打开详情', async ({ page }) => {
    await page.goto('/list')
    await expect(page.getByTestId('poi-card').first()).toBeVisible({ timeout: 20_000 })

    await page.locator('select').first().selectOption('priceDesc')
    await page.getByTestId('poi-card').first().click()

    await expect(page.getByText('数据来源')).toBeVisible()
  })

  test('提交纠错反馈得到受理编号', async ({ page }) => {
    await page.goto('/list')
    await expect(page.getByTestId('poi-card').first()).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('poi-card').first().click()

    await page.getByRole('button', { name: '提交纠错' }).click()
    await page.locator('select').last().selectOption({ index: 1 })
    await page
      .getByPlaceholder('请描述你看到的情况，例如：该网点已搬迁至对面')
      .fill('E2E 回归：该网点已搬迁')
    await page.getByRole('button', { name: '提交反馈' }).click()

    await expect(page.getByText(/反馈已提交：FB/)).toBeVisible({ timeout: 10_000 })
  })

  test('移动端点击点位打开底部详情面板', async ({ page, isMobile }) => {
    test.skip(!isMobile, '仅移动端布局')
    await page.goto('/')
    await expect.poll(() => readCount(page), { timeout: 25_000 }).toBeGreaterThan(0)

    await page.locator('[data-testid="poi-card"]:visible').first().click()

    const sheet = page.getByTestId('mobile-detail-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('数据来源')).toBeVisible()
    await expect(sheet.getByRole('button', { name: '地图定位' })).toBeVisible()

    await sheet.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(sheet).toBeHidden()
  })

  test('数据洞察搜索把关键词带到列表页', async ({ page }) => {
    await page.goto('/stats')
    await page.getByTestId('stats-search').fill('招商')
    await page.getByTestId('stats-search-submit').click()

    await expect(page).toHaveURL(/\/list\?/)
    await expect(page.getByTestId('list-search')).toHaveValue('招商')
    await expect(page.getByTestId('poi-card').first()).toBeVisible({ timeout: 20_000 })
  })

  test('用户后台可提交纠错并查看我的反馈', async ({ page }) => {
    await page.route('**/api/v1/feedback', (route) =>
      route.fulfill({
        json: {
          code: 0,
          message: 'ok',
          data: { code: 'FB20261110-9999', status: 'pending' },
        },
      }),
    )

    await page.goto('/me')
    await expect(page.getByRole('heading', { name: '用户后台' })).toBeVisible()

    await page.getByTestId('correction-search').fill('建设')
    await page.getByTestId('correction-result').first().click({ timeout: 20_000 })
    await page.getByTestId('correction-description').fill('E2E 用户后台：地址需要补充')
    await page.getByTestId('correction-submit').click()

    await expect(page.getByText('已提交，等待审核')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '查看我的反馈' }).click()
    await expect(page.getByText('E2E 用户后台：地址需要补充')).toBeVisible()
  })

  test('开场粒子动画可跳过并展示卡片', async ({ page }) => {
    await page.goto('/?intro=1')
    await expect(page.getByTestId('map-intro')).toBeVisible()
    await page.getByRole('button', { name: /跳过动画/ }).click()

    await expect(page.getByTestId('map-intro')).toBeHidden()
    await expect(page.locator('[data-testid="poi-card"]:visible').first()).toBeVisible({
      timeout: 20_000,
    })
  })

  test('数据说明页展示三级授权模型', async ({ page }) => {
    await page.goto('/compliance')

    await expect(page.getByRole('heading', { name: '数据来源与合规声明' })).toBeVisible()
    await expect(page.getByText('L1 可入库').first()).toBeVisible()
    await expect(page.getByText('L2 仅展示').first()).toBeVisible()
    await expect(page.getByText('L3 禁用').first()).toBeVisible()
  })
})
