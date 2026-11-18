import { expect, test } from '@playwright/test'

/**
 * 管理后台审核与坐标标注回归。
 *
 * 设计原则：**不污染业务数据**。
 * - 审核走「驳回」，只改 feedback 状态，不动 POI 主表
 * - 坐标标注只验证到「选中坐标」这一步，不点确认（确认会真实转正进地图）
 *
 * 登录限流是 5 次/分钟（app.auth.login-limit-per-minute），所以整个文件只登录一次。
 */

const API = process.env.E2E_API_BASE || 'http://127.0.0.1:8080'

async function createFeedback(): Promise<string> {
  // 取一个真实存在的银行作为锚点
  const list = await (await fetch(`${API}/api/v1/pois?types=bank&size=1`)).json()
  const bank = list.data.items[0]
  const res = await fetch(`${API}/api/v1/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      poiType: 'bank',
      poiId: bank.id,
      type: 'error',
      field: '电话',
      newValue: '0755-00000000',
      description: 'e2e 测试反馈（会被驳回）',
    }),
  })
  const body = await res.json()
  return body.data.code
}

test.describe('管理后台', () => {
  test('登录后可以驳回反馈、查看待定位小区并打开坐标选择器', async ({ page, isMobile }) => {
    test.skip(isMobile, '移动端后台布局不同，暂只覆盖桌面')
    test.setTimeout(60_000)
    const code = await createFeedback()

    await page.goto('/admin')
    // 口令从环境变量读，避免把某次部署的口令写死在用例里
    await page.fill(
      'input[placeholder="请输入口令"]',
      process.env.OPERATOR_PASSWORD || 'operator123',
    )
    await page.getByRole('button', { name: '登录' }).click()

    // 登录成功标志：出现退出按钮
    await expect(page.getByRole('button', { name: '退出' })).toBeVisible({ timeout: 15_000 })

    // 反馈审核：找到刚才那条并驳回
    await page.getByRole('button', { name: /反馈审核/ }).click()
    await expect(page.getByText(code)).toBeVisible({ timeout: 15_000 })
    // 反馈是卡片列表（listitem），不是表格行；exact 避免命中「已驳回」筛选按钮
    const card = page.locator('li', { hasText: code })
    await expect(card).toHaveCount(1, { timeout: 10_000 })
    await card.getByRole('button', { name: '驳回', exact: true }).click()

    // 断言「状态真的变了」而不是看 toast（toast 2.6s 后消失，容易 flaky）
    await page.getByRole('button', { name: '已驳回', exact: true }).click()
    await expect(page.getByText(code)).toBeVisible({ timeout: 15_000 })

    // 待定位小区：列表能加载，且能打开坐标选择器
    await page.getByRole('button', { name: '待定位小区', exact: true }).click()
    await expect(page.getByTestId('pick-location').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/待定位总数|待定位小区/).first()).toBeVisible()

    await page.getByTestId('pick-location').first().click()
    const picker = page.getByTestId('coordinate-picker')
    await expect(picker).toBeVisible({ timeout: 10_000 })

    // 在地图上点一下，应出现「已选：lng, lat」
    const map = picker.locator('.leaflet-container')
    const box = await map.boundingBox()
    if (!box) throw new Error('坐标选择器地图未渲染')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(picker.getByText(/已选：/)).toBeVisible({ timeout: 8000 })

    // 取消而不是确认：不写库
    await picker.getByRole('button', { name: '取消' }).click()
    await expect(picker).toBeHidden()

    // 待定位网点：闭环最后一环（兴业 50 条 + 用户反馈新增），列表要能加载
    await page.getByRole('button', { name: '待定位网点', exact: true }).click()
    await expect(page.getByTestId('pick-bank-location').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('待定位网点').first()).toBeVisible()
  })
})
