import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AgentPanel from '@/components/admin/AgentPanel.vue'
import type { BankPoi } from '@/types/poi'

const agentMocks = vi.hoisted(() => ({
  applyAgentRun: vi.fn(),
  fetchAgentRuns: vi.fn(),
  fetchAgentStatus: vi.fn(),
  proposeAgentField: vi.fn(),
}))

const poiMocks = vi.hoisted(() => ({
  searchPois: vi.fn(),
}))

vi.mock('@/api/agent', () => agentMocks)
vi.mock('@/api/pois', () => poiMocks)
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))

const poi: BankPoi = {
  id: 'osm-node-6986531413',
  type: 'bank',
  name: '中国建设银行(岗厦支行)',
  address: '',
  lng: 114.07,
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

const run = {
  id: 45,
  entity_type: 'bank',
  entity_id: poi.id,
  field: 'address',
  status: 'ready',
  result_json: JSON.stringify({
    value: '深圳市福田区福田街道福华路 355 号',
    evidence: '地址：深圳市福田区福田街道福华路 355 号',
    sourceUrl: 'https://www.ccb.com/sz/branch',
    confidence: 0.86,
    problems: [],
  }),
  reviewed_by: '',
  created_at: '2026-11-10 04:07:33',
}

beforeEach(() => {
  agentMocks.fetchAgentStatus.mockResolvedValue({
    enabled: true,
    model: 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com',
  })
  agentMocks.fetchAgentRuns.mockResolvedValue([run])
  agentMocks.applyAgentRun.mockResolvedValue({
    runId: 45,
    status: 'applied',
    field: 'address',
    value: '深圳市福田区福田街道福华路 355 号',
    sourceUrl: 'https://www.ccb.com/sz/branch',
  })
  agentMocks.proposeAgentField.mockResolvedValue({
    entityType: 'bank',
    entityId: poi.id,
    name: poi.name,
    field: 'address',
    status: 'ready',
    runId: 46,
    proposal: {
      value: '深圳市福田区福田街道福华路 355 号',
      evidence: '地址：深圳市福田区福田街道福华路 355 号',
      sourceUrl: 'https://www.ccb.com/sz/branch',
      confidence: 0.9,
      problems: [],
    },
  })
  poiMocks.searchPois.mockResolvedValue([poi])
})

describe('AgentPanel', () => {
  it('加载状态与运行记录，并解析 result_json', async () => {
    const wrapper = mount(AgentPanel)
    await flushPromises()

    expect(agentMocks.fetchAgentStatus).toHaveBeenCalled()
    expect(agentMocks.fetchAgentRuns).toHaveBeenCalledWith(50)
    expect(wrapper.text()).toContain('deepseek-flash')
    expect(wrapper.text()).toContain('深圳市福田区福田街道福华路 355 号')
    expect(wrapper.text()).toContain('86%')
  })

  it('可采纳记录支持直接采纳', async () => {
    agentMocks.fetchAgentRuns
      .mockResolvedValueOnce([run])
      .mockResolvedValueOnce([{ ...run, status: 'applied', reviewed_by: 'operator' }])
    const wrapper = mount(AgentPanel)
    await flushPromises()

    await wrapper.get('[data-testid="agent-run-apply"]').trigger('click')
    await flushPromises()

    expect(agentMocks.applyAgentRun).toHaveBeenCalledWith(45)
    expect(agentMocks.fetchAgentRuns).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('已采纳')
  })

  it('选择点位后可运行 Agent 并采纳本次建议', async () => {
    const wrapper = mount(AgentPanel)
    await flushPromises()

    await wrapper.get('[data-testid="agent-search"]').setValue('建设')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await flushPromises()
    await wrapper.get('[data-testid="agent-entity-result"]').trigger('click')

    await wrapper.get('[data-testid="agent-run"]').trigger('click')
    await flushPromises()

    expect(agentMocks.proposeAgentField).toHaveBeenCalledWith('bank', poi.id, 'address')
    expect(wrapper.get('[data-testid="agent-result"]').text()).toContain(
      '深圳市福田区福田街道福华路 355 号',
    )

    await wrapper.get('[data-testid="agent-apply"]').trigger('click')
    await flushPromises()
    expect(agentMocks.applyAgentRun).toHaveBeenCalledWith(46)
  })

  it('未启用时禁止触发并展示提示', async () => {
    agentMocks.fetchAgentStatus.mockResolvedValueOnce({
      enabled: false,
      model: 'deepseek-flash',
      baseUrl: 'https://api.deepseek.com',
    })
    const wrapper = mount(AgentPanel)
    await flushPromises()

    expect(wrapper.text()).toContain('未配置 DEEPSEEK_API_KEY')
    expect(wrapper.get('[data-testid="agent-run"]').attributes('disabled')).toBeDefined()
  })

  it('登录失效时通知父级', async () => {
    agentMocks.fetchAgentStatus.mockRejectedValueOnce(new Error('未登录或登录已过期'))
    const wrapper = mount(AgentPanel)
    await flushPromises()

    expect(wrapper.emitted('unauthorized')).toHaveLength(1)
  })
})
