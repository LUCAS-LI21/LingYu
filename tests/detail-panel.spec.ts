import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DetailPanel from '@/components/DetailPanel.vue'
import type { BankPoi, CommunityPoi } from '@/types/poi'

const liveMocks = vi.hoisted(() => ({
  fetchLiveAddress: vi.fn(),
  fetchLiveAround: vi.fn(),
}))

vi.mock('@/api/live', () => liveMocks)

const poiApi = vi.hoisted(() => ({ fieldSourcesFromServer: vi.fn() }))
vi.mock('@/api/pois', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/pois')>()
  return { ...actual, fieldSourcesFromServer: poiApi.fieldSourcesFromServer }
})

const bank = (over: Partial<BankPoi> = {}): BankPoi => ({
  id: 'b1',
  type: 'bank',
  name: '中国建设银行',
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
  ...over,
})

const community = (over: Partial<CommunityPoi> = {}): CommunityPoi => ({
  id: 'c1',
  type: 'community',
  name: '万科金色家园',
  address: '深南大道 1 号',
  lng: 114.06,
  lat: 22.55,
  district: '福田区',
  source: 'OpenStreetMap',
  license: 'ODbL',
  sourceLevel: 'L1',
  builtYear: 2010,
  avgPrice: 80000,
  propertyFee: 4.5,
  demoAttributes: true,
  ...over,
})

function mountPanel(poi: BankPoi | CommunityPoi) {
  return mount(DetailPanel, { props: { poi, nearby: [] } })
}

beforeEach(() => {
  liveMocks.fetchLiveAddress.mockReset()
  liveMocks.fetchLiveAround.mockReset()
})

describe('DetailPanel 地址入口分层', () => {
  it('地址缺失时展示「地址待补充」并给出主次两个入口', () => {
    const wrapper = mountPanel(bank())

    expect(wrapper.get('[data-testid="address-missing"]').text()).toContain('地址待补充')
    expect(wrapper.get('[data-testid="live-address-action"]').text()).toContain('查实时地址')
    expect(wrapper.get('[data-testid="supplement-address-action"]').text()).toContain('补充地址')
  })

  it('地址完整时不渲染补充入口', () => {
    const wrapper = mountPanel(community())

    expect(wrapper.find('[data-testid="address-missing"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="address-action"]').exists()).toBe(false)
  })

  it('「补充地址」带字段预选，交给反馈弹窗', async () => {
    const wrapper = mountPanel(bank())

    await wrapper.get('[data-testid="supplement-address-action"]').trigger('click')

    expect(wrapper.emitted('feedback')?.[0]?.[0]).toMatchObject({ field: '地址' })
  })

  it('实时地址未开通时优雅展示 reason', async () => {
    liveMocks.fetchLiveAddress.mockResolvedValue({
      enabled: false,
      reason: '未配置 AMAP_KEY，L2 实时地址不可用',
    })
    const wrapper = mountPanel(bank())

    await wrapper.get('[data-testid="live-address-action"]').trigger('click')
    await flushPromises()

    const status = wrapper.get('[data-testid="live-address-status"]').text()
    expect(status).toContain('实时地址暂不可用')
    expect(status).toContain('未配置 AMAP_KEY')
  })

  it('实时地址成功时标注 L2 与不落库', async () => {
    liveMocks.fetchLiveAddress.mockResolvedValue({
      enabled: true,
      address: '深圳市福田区深南大道 1 号',
      stored: false,
    })
    const wrapper = mountPanel(bank())

    await wrapper.get('[data-testid="live-address-action"]').trigger('click')
    await flushPromises()

    const result = wrapper.get('[data-testid="live-address-result"]').text()
    expect(result).toContain('深圳市福田区深南大道 1 号')
    expect(result).toContain('不写入数据库')
  })

  it('实时周边查询成功时按距离展示高德点位', async () => {
    liveMocks.fetchLiveAround.mockResolvedValue({
      enabled: true,
      stored: false,
      items: [
        { name: '平安银行(车公庙支行)', address: '', type: '银行', phone: '', distance: 320 },
        { name: '招商银行(泰然支行)', address: '', type: '银行', phone: '', distance: 1260 },
      ],
    })
    const wrapper = mountPanel(bank())

    await wrapper.get('[data-testid="live-around-action"]').trigger('click')
    await flushPromises()

    const list = wrapper.get('[data-testid="live-around-list"]').text()
    expect(list).toContain('平安银行(车公庙支行)')
    expect(list).toContain('320m')
    expect(list).toContain('1.3km')
  })

  it('切换点位后清空实时层结果', async () => {
    liveMocks.fetchLiveAddress.mockResolvedValue({ enabled: true, address: '实时地址' })
    const wrapper = mountPanel(bank())

    await wrapper.get('[data-testid="live-address-action"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="live-address-result"]').exists()).toBe(true)

    await wrapper.setProps({ poi: bank({ id: 'b2', name: '招商银行' }) })
    await flushPromises()

    expect(wrapper.find('[data-testid="live-address-result"]').exists()).toBe(false)
  })
})

describe('小区配套与字段来源', () => {
  it('渲染周边配套四个指标', async () => {
    const wrapper = mount(DetailPanel, {
      props: {
        poi: community({
          propertyCompany: '深圳市万科物业管理有限公司',
          surroundBankCount: 31,
          nearbyBrandCount: 14,
          nearestBankM: 218,
          surroundAtmCount: 0,
        }),
        nearby: [],
      },
    })
    await flushPromises()
    const box = wrapper.find('[data-testid="community-amenities"]')
    expect(box.exists()).toBe(true)
    expect(box.text()).toContain('31 家')
    expect(box.text()).toContain('14 个')
    expect(box.text()).toContain('218 m')
    expect(wrapper.text()).toContain('深圳市万科物业管理有限公司')
  })

  it('有字段来源时逐条渲染，无来源时整块隐藏', async () => {
    poiApi.fieldSourcesFromServer.mockResolvedValueOnce([
      { field: 'address', source: '深圳市政府数据开放平台', sourceUrl: '', updatedAt: '' },
      { field: 'property_company', source: '深圳市政府数据开放平台', sourceUrl: '', updatedAt: '' },
    ])
    const wrapper = mount(DetailPanel, {
      props: { poi: community({ propertyCompany: '某物业' }), nearby: [] },
    })
    await flushPromises()
    const rows = wrapper.findAll('[data-testid="field-sources"] li')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('地址')
    expect(rows[0]?.text()).toContain('深圳市政府数据开放平台')

    poiApi.fieldSourcesFromServer.mockResolvedValueOnce(null)
    const empty = mount(DetailPanel, { props: { poi: community(), nearby: [] } })
    await flushPromises()
    expect(empty.find('[data-testid="field-sources"]').exists()).toBe(false)
  })
})
