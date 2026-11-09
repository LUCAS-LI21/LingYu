import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AdminView from '@/views/AdminView.vue'

const adminMocks = vi.hoisted(() => ({
  approveFeedback: vi.fn(),
  fetchFeedback: vi.fn(),
  fetchHotspots: vi.fn(),
  fetchJobs: vi.fn(),
  fetchOverview: vi.fn(),
  recomputeHotspots: vi.fn(),
  rejectFeedback: vi.fn(),
  triggerJob: vi.fn(),
}))

vi.mock('@/api/admin', () => adminMocks)
vi.mock('@/api/pois', () => ({ isServerMode: () => Promise.resolve(true) }))
vi.mock('@/api/auth', () => ({
  isLoggedIn: () => true,
  login: vi.fn(),
  clearToken: vi.fn(),
}))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

const overview = {
  pendingFeedback: 3,
  totalFeedback: 23,
  totalJobs: 4,
  successJobs: 3,
  failedJobs: 0,
  runningJobs: 1,
  hotRegions: 2,
  versions: 11,
  avgFreshHours: 6,
}

const feedbackRow = (code: string) => ({
  code,
  poiType: 'bank' as const,
  poiId: 'b1',
  poiName: '中国建设银行',
  type: 'error' as const,
  field: '营业时间',
  newValue: '09:00-18:00',
  description: '营业时间已调整',
  contact: '',
  status: 'pending',
  reviewer: '',
  reviewNote: '',
  createdAt: '2026-11-10 10:00:00',
})

const jobRow = (id: number, status: string) => ({
  id,
  sourceCode: 'osm',
  triggerType: 'manual',
  scopeValue: 'shenzhen',
  status,
  fetchedCount: 120,
  insertedCount: 3,
  updatedCount: 5,
  failedCount: 0,
  errorSummary: '',
  createdAt: '2026-11-10 10:00:00',
  finishedAt: status === 'running' ? null : '2026-11-10 10:00:20',
})

function feedbackPage(page: number, size: number) {
  return {
    items: Array.from({ length: size }, (_, index) => feedbackRow(`FB-${page}-${index}`)),
    total: 23,
    page,
    size,
  }
}

async function flushAll(): Promise<void> {
  const pending = flushPromises()
  await vi.advanceTimersByTimeAsync(0)
  await pending
  await flushPromises()
}

async function mountView(): Promise<VueWrapper> {
  const wrapper = mount(AdminView)
  await flushAll()
  return wrapper
}

async function clickButton(wrapper: VueWrapper, label: string): Promise<void> {
  const button = wrapper.findAll('button').find((item) => item.text().trim() === label)
  expect(button, `找不到按钮「${label}」`).toBeTruthy()
  await button!.trigger('click')
  await flushAll()
}

beforeEach(() => {
  vi.useFakeTimers()
  adminMocks.fetchOverview.mockResolvedValue(overview)
  adminMocks.fetchFeedback.mockImplementation((_status: string, page = 1, size = 10) =>
    Promise.resolve(feedbackPage(page, size)),
  )
  adminMocks.fetchJobs.mockResolvedValue({
    items: [jobRow(1, 'running'), jobRow(2, 'success')],
    total: 2,
    page: 1,
    size: 20,
  })
  adminMocks.fetchHotspots.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('AdminView 反馈分页', () => {
  it('默认按待审核第 1 页拉取，总数来自后端', async () => {
    const wrapper = await mountView()
    await clickButton(wrapper, '反馈审核')

    expect(adminMocks.fetchFeedback).toHaveBeenLastCalledWith('pending', 1, 10)
    expect(wrapper.text()).toContain('共 23 条')
    expect(wrapper.text()).toContain('第 1–10 条')
    expect(wrapper.text()).toContain('1 / 3')
  })

  it('翻页传给后端正确的 page 参数', async () => {
    const wrapper = await mountView()
    await clickButton(wrapper, '反馈审核')

    await wrapper.get('[data-testid="feedback-next"]').trigger('click')
    await flushAll()

    expect(adminMocks.fetchFeedback).toHaveBeenLastCalledWith('pending', 2, 10)
    expect(wrapper.text()).toContain('2 / 3')
  })

  it('切换状态筛选时回到第 1 页', async () => {
    const wrapper = await mountView()
    await clickButton(wrapper, '反馈审核')
    await wrapper.get('[data-testid="feedback-next"]').trigger('click')
    await flushAll()

    await clickButton(wrapper, '全部')

    expect(adminMocks.fetchFeedback).toHaveBeenLastCalledWith('all', 1, 10)
    expect(wrapper.text()).toContain('1 / 3')
  })

  it('改每页条数时重新计算页数', async () => {
    const wrapper = await mountView()
    await clickButton(wrapper, '反馈审核')

    await wrapper.get('[data-testid="feedback-page-size"]').setValue('20')
    await flushAll()

    expect(adminMocks.fetchFeedback).toHaveBeenLastCalledWith('pending', 1, 20)
    expect(wrapper.text()).toContain('1 / 2')
  })
})

describe('AdminView 任务自动刷新', () => {
  it('停留在任务页时每 5 秒自动拉取一次', async () => {
    const wrapper = await mountView()
    await clickButton(wrapper, '抓取任务')

    expect(adminMocks.fetchJobs).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    await flushAll()

    expect(adminMocks.fetchJobs).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('任务执行中，状态自动刷新')
  })

  it('关闭自动刷新后不再轮询', async () => {
    const wrapper = await mountView()
    await clickButton(wrapper, '抓取任务')
    const calls = adminMocks.fetchJobs.mock.calls.length

    await wrapper.get('[data-testid="jobs-auto-refresh"]').setValue(false)
    await flushAll()
    await vi.advanceTimersByTimeAsync(5000)
    await flushAll()

    expect(adminMocks.fetchJobs).toHaveBeenCalledTimes(calls)
  })

  it('切走任务页后停止轮询', async () => {
    const wrapper = await mountView()
    await clickButton(wrapper, '抓取任务')
    const calls = adminMocks.fetchJobs.mock.calls.length

    await clickButton(wrapper, '概览')
    await vi.advanceTimersByTimeAsync(5000)
    await flushAll()

    expect(adminMocks.fetchJobs).toHaveBeenCalledTimes(calls)
  })

  it('「立即刷新」走手动拉取', async () => {
    const wrapper = await mountView()
    await clickButton(wrapper, '抓取任务')
    const calls = adminMocks.fetchJobs.mock.calls.length

    await wrapper.get('[data-testid="jobs-refresh"]').trigger('click')
    await flushAll()

    expect(adminMocks.fetchJobs).toHaveBeenCalledTimes(calls + 1)
  })
})
