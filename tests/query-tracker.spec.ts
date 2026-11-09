import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  recordQuery: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/api/pois', () => apiMocks)

import {
  cancelScheduledQuery,
  clearRecentQueries,
  listRecentQueries,
  recentQueryLabel,
  rememberQuery,
  scheduleQueryLog,
  trackQueryNow,
} from '@/lib/queryTracker'

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  apiMocks.recordQuery.mockClear()
})

afterEach(() => {
  cancelScheduledQuery()
  vi.useRealTimers()
})

describe('queryTracker', () => {
  it('立即记录时写入最近搜索并上报后端', () => {
    trackQueryNow({ keyword: '招商', district: '南山区', types: ['bank'] })

    const recent = listRecentQueries()
    expect(recent).toHaveLength(1)
    expect(recentQueryLabel(recent[0]!)).toBe('南山区 · 招商')
    expect(apiMocks.recordQuery).toHaveBeenCalledWith({
      keyword: '招商',
      district: '南山区',
      types: ['bank'],
    })
  })

  it('相同条件去重，不同条件按新到旧保留', () => {
    rememberQuery({ keyword: '招商', district: '全部区域' })
    rememberQuery({ keyword: '万科', district: '福田区' })
    rememberQuery({ keyword: '招商', district: '全部区域' })

    const recent = listRecentQueries()
    expect(recent.map((item) => item.keyword)).toEqual(['招商', '万科'])
  })

  it('最多保留 8 条最近搜索', () => {
    for (let i = 0; i < 12; i += 1) {
      rememberQuery({ keyword: `关键词${i}` })
    }
    expect(listRecentQueries()).toHaveLength(8)
  })

  it('空条件不写入历史', () => {
    rememberQuery({ keyword: '   ', district: '全部区域' })
    expect(listRecentQueries()).toEqual([])
  })

  it('去抖期间只上报最后一次查询', () => {
    scheduleQueryLog({ keyword: '第一' }, 900)
    vi.advanceTimersByTime(400)
    scheduleQueryLog({ keyword: '第二' }, 900)
    vi.advanceTimersByTime(899)

    expect(apiMocks.recordQuery).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(apiMocks.recordQuery).toHaveBeenCalledTimes(1)
    expect(apiMocks.recordQuery).toHaveBeenCalledWith({ keyword: '第二' })
    expect(listRecentQueries()[0]?.keyword).toBe('第二')
  })

  it('取消挂起的查询后不再上报', () => {
    scheduleQueryLog({ keyword: '招商' }, 900)
    cancelScheduledQuery()
    vi.advanceTimersByTime(2000)

    expect(apiMocks.recordQuery).not.toHaveBeenCalled()
  })

  it('清空最近搜索', () => {
    rememberQuery({ keyword: '招商' })
    clearRecentQueries()
    expect(listRecentQueries()).toEqual([])
  })
})
