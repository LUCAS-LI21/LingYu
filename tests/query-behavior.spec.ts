import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import QueryBehaviorPanel from '@/components/admin/QueryBehaviorPanel.vue'

const adminMocks = vi.hoisted(() => ({
  fetchHotspots: vi.fn(),
  fetchOverview: vi.fn(),
  recomputeHotspots: vi.fn(),
}))

vi.mock('@/api/admin', () => adminMocks)

const hotspots = [
  {
    grid: '114.05,22.55',
    statDate: '2026-11-10',
    queryCount: 12,
    zeroResultCount: 2,
    priority: 16,
    updatedAt: '11-10 10:00',
  },
  {
    grid: '113.93,22.53',
    statDate: '2026-11-10',
    queryCount: 4,
    zeroResultCount: 0,
    priority: 4,
    updatedAt: '11-10 10:00',
  },
]

const overview = {
  pendingFeedback: 3,
  totalFeedback: 12,
  totalJobs: 8,
  successJobs: 7,
  failedJobs: 1,
  runningJobs: 0,
  hotRegions: 2,
  versions: 99,
  avgFreshHours: 6,
}

async function flushAll(): Promise<void> {
  const pending = flushPromises()
  await vi.advanceTimersByTimeAsync(0)
  await pending
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers()
  adminMocks.fetchHotspots.mockResolvedValue(hotspots)
  adminMocks.fetchOverview.mockResolvedValue(overview)
  adminMocks.recomputeHotspots.mockResolvedValue({ affected: 2 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('QueryBehaviorPanel', () => {
  it('挂载后重算热点并展示聚合指标', async () => {
    const wrapper = mount(QueryBehaviorPanel)
    await flushAll()

    expect(adminMocks.recomputeHotspots).toHaveBeenCalledTimes(1)
    expect(adminMocks.fetchHotspots).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('114.05,22.55')
    expect(wrapper.text()).toContain('16')
    expect(wrapper.text()).toContain('零结果')
    expect(wrapper.text()).toContain('3')
  })

  it('开启自动刷新时每 10 秒重算一次', async () => {
    mount(QueryBehaviorPanel)
    await flushAll()
    expect(adminMocks.recomputeHotspots).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10_000)
    await flushAll()

    expect(adminMocks.recomputeHotspots).toHaveBeenCalledTimes(2)
    expect(adminMocks.fetchHotspots).toHaveBeenCalledTimes(2)
  })

  it('关闭自动刷新后停止轮询', async () => {
    const wrapper = mount(QueryBehaviorPanel)
    await flushAll()
    const calls = adminMocks.recomputeHotspots.mock.calls.length

    await wrapper.get('[data-testid="behavior-auto"]').setValue(false)
    await flushAll()
    await vi.advanceTimersByTimeAsync(20_000)
    await flushAll()

    expect(adminMocks.recomputeHotspots).toHaveBeenCalledTimes(calls)
  })

  it('手动刷新可立即重算', async () => {
    const wrapper = mount(QueryBehaviorPanel)
    await flushAll()
    const calls = adminMocks.recomputeHotspots.mock.calls.length

    await wrapper.get('[data-testid="behavior-refresh"]').trigger('click')
    await flushAll()

    expect(adminMocks.recomputeHotspots).toHaveBeenCalledTimes(calls + 1)
  })

  it('登录失效时通知父级退出', async () => {
    adminMocks.fetchHotspots.mockRejectedValueOnce(new Error('未登录或登录已过期'))
    const wrapper = mount(QueryBehaviorPanel)
    await flushAll()

    expect(wrapper.emitted('unauthorized')).toHaveLength(1)
  })
})
