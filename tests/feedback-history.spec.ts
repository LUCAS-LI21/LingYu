import { beforeEach, describe, expect, it } from 'vitest'

import type { FeedbackRecord } from '@/api/pois'
import {
  clearFeedbackHistory,
  feedbackStatusText,
  formatFeedbackTime,
  listFeedbackHistory,
  saveFeedbackRecord,
} from '@/lib/feedbackHistory'

const record = (code: string, over: Partial<FeedbackRecord> = {}): FeedbackRecord => ({
  code,
  poiType: 'bank',
  poiId: 'b1',
  poiName: '中国建设银行',
  type: 'error',
  field: '地址',
  newValue: '深南大道 1 号',
  description: '地址有误',
  contact: '',
  status: 'pending',
  createdAt: '2026-11-10T10:00:00.000Z',
  ...over,
})

beforeEach(() => {
  localStorage.clear()
  clearFeedbackHistory()
})

describe('feedbackHistory', () => {
  it('按时间倒序保存提交记录', () => {
    saveFeedbackRecord(record('FB-1'))
    saveFeedbackRecord(record('FB-2'))

    const history = listFeedbackHistory()
    expect(history.map((item) => item.code)).toEqual(['FB-2', 'FB-1'])
    expect(history[0]?.savedAt).toBeTruthy()
  })

  it('同一编号重复保存时去重', () => {
    saveFeedbackRecord(record('FB-1', { description: '第一次' }))
    saveFeedbackRecord(record('FB-1', { description: '第二次' }))

    const history = listFeedbackHistory()
    expect(history).toHaveLength(1)
    expect(history[0]?.description).toBe('第二次')
  })

  it('最多保留 50 条', () => {
    for (let i = 0; i < 60; i += 1) {
      saveFeedbackRecord(record(`FB-${i}`))
    }
    const history = listFeedbackHistory()
    expect(history).toHaveLength(50)
    expect(history[0]?.code).toBe('FB-59')
  })

  it('清空后返回空数组', () => {
    saveFeedbackRecord(record('FB-1'))
    clearFeedbackHistory()
    expect(listFeedbackHistory()).toEqual([])
  })

  it('损坏的本地数据不会抛错', () => {
    localStorage.setItem('poi_feedback_history_v1', '{not-json')
    expect(listFeedbackHistory()).toEqual([])
  })

  it('状态文案覆盖待审核与自动受理', () => {
    expect(feedbackStatusText('pending')).toBe('待运营审核')
    expect(feedbackStatusText('auto_applied')).toBe('已自动受理')
    expect(feedbackStatusText('need_refetch')).toBe('待重抓')
  })

  it('提交时间格式化为本地时间', () => {
    expect(formatFeedbackTime('2026-11-09 20:02')).toBe('2026-11-09 20:02')
    expect(formatFeedbackTime('不是时间')).toBe('不是时间')
  })
})
