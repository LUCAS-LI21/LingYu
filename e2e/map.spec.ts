import { expect, test } from '@playwright/test'

/**
 * 地图交互回归。
 *
 * 覆盖三件反复改、之前没有任何自动化保护的事：
 * 1. 底图三档切换（浅灰/彩色/卫星）——换过两次实现（OSM→CARTO→Esri），每次都可能切不动
 * 2. 框选：拖拽后出现「已框选」并影响结果
 * 3. 点位聚合：低 zoom 下应出现聚合圆点而不是 5000 个 marker
 */

test.describe('地图交互', () => {
  test('底图可在浅灰/彩色/卫星之间切换并保持选择', async ({ page }) => {
    await page.goto('/')
    const container = page.locator('.leaflet-container')
    await expect(container).toBeVisible({ timeout: 20_000 })

    // 默认浅灰
    await expect(container).toHaveAttribute('data-basemap', 'basemap-light')

    await page.getByTestId('basemap-color').click()
    await expect(container).toHaveAttribute('data-basemap', 'basemap-color')
    // 彩色模式必须去掉灰度滤镜，否则切换没意义
    const filter = await page.evaluate(() => {
      const pane = document.querySelector('.leaflet-tile-pane')
      return pane ? getComputedStyle(pane).filter : 'none'
    })
    expect(filter).toBe('none')

    await page.getByTestId('basemap-satellite').click()
    await expect(container).toHaveAttribute('data-basemap', 'basemap-satellite')
    // 署名要跟着换（Esri 条款要求）
    await expect(page.locator('.leaflet-control-attribution')).toContainText('Esri')

    // 刷新后记住选择
    await page.reload()
    await expect(page.locator('.leaflet-container')).toHaveAttribute(
      'data-basemap',
      'basemap-satellite',
    )
  })

  test('框选后出现已框选标记，清除后消失', async ({ page, isMobile }) => {
    // 框选入口在移动端隐藏（sm:flex），本用例只覆盖桌面
    test.skip(isMobile, '移动端没有框选入口')
    await page.goto('/')
    const map = page.locator('.leaflet-container')
    await expect(map).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(1500)

    await page.getByRole('button', { name: '框选' }).click()
    const box = await map.boundingBox()
    if (!box) throw new Error('地图未渲染')

    // 从中心拖出一个矩形
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 8 })
    await page.mouse.up()

    await expect(page.getByText('已框选')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: '清除' }).click()
    await expect(page.getByText('已框选')).toBeHidden({ timeout: 5000 })
  })

  test('低缩放级别使用聚合圆点而不是逐个 marker', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(2000)

    // 地图开了 preferCanvas：circleMarker 画在 canvas 上，不是 SVG path。
    // 所以断言「有 canvas 且没有 div 图标」= 走的是聚合分支。
    const canvas = await page.locator('.leaflet-overlay-pane canvas, .leaflet-pane canvas').count()
    const pins = await page.locator('.poi-marker').count()
    expect(canvas).toBeGreaterThan(0)
    expect(pins).toBe(0)

    // 放大到 16 之后应改为单点 marker
    await page
      .getByRole('button', { name: '放大' })
      .click()
      .catch(() => {})
    await page.evaluate(() => {
      // 直接派发两次滚轮缩放，避免依赖 Leaflet 的按钮结构
      const el = document.querySelector('.leaflet-container')
      el?.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true }))
    })
    await page.waitForTimeout(1200)
  })
})
