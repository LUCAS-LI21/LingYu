import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CorrectionComposer from '@/components/CorrectionComposer.vue'
import type { FeedbackRecord } from '@/api/pois'
import type { BankPoi } from '@/types/poi'

const poiMocks = vi.hoisted(() => ({
  loadPois: vi.fn(),
  searchPois: vi.fn(),
  submitFeedback: vi.fn(),
}))

vi.mock('@/api/pois', () => poiMocks)
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

const bank: BankPoi = {
  id: 'osm-node-1',
  type: 'bank',
  name: '中国建设银行(车公庙支行)',
  address: '',
  lng: 114.05,
  lat: 22.54,
  district: '福田区',
  source: 'OpenStreetMap',
  license: 'ODbL',
  sourceLevel: 'L1',
  brand: '中国建设银行',
  branchType: 'branch',
  phone: '',
  openingHours: '',
}

const submittedRecord: FeedbackRecord = {
  code: 'FB20261110-0001',
  poiType: 'bank',
  poiId: bank.id,
  poiName: bank.name,
  type: 'error',
  field: '地址',
  newValue: '深南大道 1 号',
  description: '地址缺失',
  contact: '',
  status: 'pending',
  createdAt: '2026-11-10T10:00:00.000Z',
}

beforeEach(() => {
  poiMocks.loadPois.mockResolvedValue([bank])
  poiMocks.searchPois.mockResolvedValue([bank])
  poiMocks.submitFeedback.mockResolvedValue(submittedRecord)
})

describe('CorrectionComposer', () => {
  it('预选点位后提交，复用反馈接口并展示受理编号', async () => {
    const wrapper = mount(CorrectionComposer, { props: { initialPoi: bank } })

    await wrapper.get('[data-testid="correction-description"]').setValue('该网点地址缺失')
    await wrapper.get('[data-testid="correction-submit"]').trigger('click')
    await flushPromises()

    expect(poiMocks.submitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        poiId: bank.id,
        poiType: 'bank',
        type: 'error',
        field: '地址',
        description: '该网点地址缺失',
      }),
    )
    expect(wrapper.emitted('submitted')?.[0]?.[0]).toMatchObject({ code: submittedRecord.code })
    expect(wrapper.text()).toContain(submittedRecord.code)
    expect(wrapper.text()).toContain('已提交，等待审核')
  })

  it('搜索并选中点位后才允许提交', async () => {
    const wrapper = mount(CorrectionComposer)
    await wrapper.get('[data-testid="correction-search"]').setValue('建设')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await flushPromises()

    expect(poiMocks.searchPois).toHaveBeenCalledWith('建设', 8)
    const option = wrapper
      .findAll('button')
      .find((button) => button.text().includes('中国建设银行(车公庙支行)'))
    expect(option).toBeTruthy()
    await option!.trigger('click')

    expect(wrapper.text()).toContain('换一个')
    await wrapper.get('[data-testid="correction-description"]').setValue('地址缺失')
    expect(wrapper.get('[data-testid="correction-submit"]').attributes('disabled')).toBeUndefined()
  })

  it('管理端提交后可直接跳审核队列', async () => {
    const wrapper = mount(CorrectionComposer, { props: { mode: 'admin', initialPoi: bank } })

    await wrapper.get('[data-testid="correction-description"]').setValue('管理员代录')
    await wrapper.get('[data-testid="correction-submit"]').trigger('click')
    await flushPromises()

    const review = wrapper.findAll('button').find((button) => button.text() === '去审核队列')
    expect(review).toBeTruthy()
    await review!.trigger('click')
    expect(wrapper.emitted('review')).toHaveLength(1)
  })

  it('「已关闭」类型下字段与正确值不可编辑', async () => {
    const wrapper = mount(CorrectionComposer, { props: { initialPoi: bank } })
    const closed = wrapper.findAll('button').find((button) => button.text().includes('已关闭'))
    await closed!.trigger('click')

    const selects = wrapper.findAll('select')
    expect(selects[0]?.attributes('disabled')).toBeDefined()
    expect(
      wrapper.findAll('input').some((input) => input.attributes('disabled') !== undefined),
    ).toBe(true)
  })
})
