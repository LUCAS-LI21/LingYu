import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { PHASE_LABEL, STATUS_FLOW, useBoardStore } from '../board'

describe('任务看板 store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('种子数据覆盖全部六个阶段', () => {
    const board = useBoardStore()
    expect(board.tasks).toHaveLength(6)
    expect(new Set(board.tasks.map((task) => task.phase)).size).toBe(
      Object.keys(PHASE_LABEL).length,
    )
  })

  it('新增任务：去空格后插入头部，默认待开始', () => {
    const board = useBoardStore()
    const item = board.addTask('  接入 Sentry  ', 'ops')

    expect(item.title).toBe('接入 Sentry')
    expect(item.status).toBe('todo')
    expect(board.tasks[0]?.id).toBe(item.id)
  })

  it('状态推进遵循 todo → doing → done 并停在终态', () => {
    const board = useBoardStore()
    const { id } = board.addTask('写回归用例', 'test')

    expect(board.advance(id)).toBe('doing')
    expect(board.advance(id)).toBe('done')
    expect(board.advance(id)).toBe('done')
    expect(STATUS_FLOW).toHaveLength(3)
  })

  it('推进不存在的任务返回 undefined', () => {
    const board = useBoardStore()
    expect(board.advance('not-exist')).toBeUndefined()
  })

  it('关键词过滤同时命中标题与负责人', () => {
    const board = useBoardStore()

    board.keyword = 'ee2e'
    expect(board.filtered).toHaveLength(0)

    board.keyword = 'e2e'
    expect(board.filtered).toHaveLength(1)

    board.keyword = '运维'
    expect(board.filtered.every((task) => task.owner.includes('运维'))).toBe(true)

    board.keyword = '   '
    expect(board.filtered).toHaveLength(board.tasks.length)
  })

  it('统计与阶段分组反映真实完成度', () => {
    const board = useBoardStore()

    expect(board.stats.total).toBe(6)
    expect(board.stats.done).toBe(2)
    expect(board.stats.percent).toBe(33)

    const { id } = board.addTask('补部署文档', 'deploy')
    expect(board.stats.total).toBe(7)

    board.advance(id)
    board.advance(id)
    expect(board.stats.done).toBe(3)
    expect(board.stats.percent).toBe(43)

    const phase = board.byPhase.find((item) => item.phase === 'requirement')
    expect(phase?.label).toBe('需求分析')
  })

  it('删除任务后不再出现在列表里', () => {
    const board = useBoardStore()
    const id = board.tasks[0]?.id ?? ''
    const before = board.tasks.length

    board.remove(id)
    expect(board.tasks).toHaveLength(before - 1)
    expect(board.tasks.some((task) => task.id === id)).toBe(false)
  })
})
