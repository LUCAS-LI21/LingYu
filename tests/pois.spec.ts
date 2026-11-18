import { describe, expect, it, vi } from 'vitest'

import { buildStats, distanceMeters, filterPois, paginate } from '@/api/pois'
import {
  DEFAULT_FILTERS,
  type BankPoi,
  type CommunityPoi,
  type Filters,
  type Poi,
} from '@/types/poi'

const bank = (id: string, over: Partial<BankPoi> = {}): BankPoi => ({
  id,
  type: 'bank',
  name: '中国建设银行',
  address: '深南大道 1 号',
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

const community = (id: string, over: Partial<CommunityPoi> = {}): CommunityPoi => ({
  id,
  type: 'community',
  name: '万科金色家园',
  address: '',
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

// 测试不依赖产品默认图层（地图默认只显示银行），这里显式指定两类都开
const filters = (over: Partial<Filters> = {}): Filters => ({
  ...DEFAULT_FILTERS,
  layers: ['bank', 'community'],
  ...over,
})

const dataset: Poi[] = [
  bank('b1'),
  bank('b2', {
    name: '招商银行',
    address: '科技园南路 8 号',
    branchType: 'atm',
    district: '南山区',
    lng: 113.93,
    lat: 22.53,
  }),
  community('c1'),
  community('c2', { name: '招商海月花园', avgPrice: 120000, builtYear: 2008, district: '南山区' }),
]

describe('distanceMeters', () => {
  it('同一点距离为 0', () => {
    expect(distanceMeters({ lng: 114, lat: 22 }, { lng: 114, lat: 22 })).toBe(0)
  })

  it('赤道上经度差 1 度约 111 公里', () => {
    const d = distanceMeters({ lng: 0, lat: 0 }, { lng: 1, lat: 0 })
    expect(d).toBeGreaterThan(110000)
    expect(d).toBeLessThan(112000)
  })

  it('深圳市区两点距离在百米级', () => {
    const d = distanceMeters({ lng: 114.055, lat: 22.541 }, { lng: 114.057, lat: 22.542 })
    expect(d).toBeGreaterThan(150)
    expect(d).toBeLessThan(400)
  })
})

describe('filterPois', () => {
  it('按图层过滤', () => {
    expect(filterPois(dataset, { filters: filters({ layers: ['bank'] }) })).toHaveLength(2)
    expect(filterPois(dataset, { filters: filters({ layers: ['community'] }) })).toHaveLength(2)
  })

  it('按区域过滤', () => {
    const result = filterPois(dataset, { filters: filters({ district: '南山区' }) })
    expect(result.map((item) => item.id).sort()).toEqual(['b2', 'c2'])
  })

  it('关键词命中名称与地址', () => {
    expect(filterPois(dataset, { filters: filters({ keyword: '招商' }) })).toHaveLength(2)
    expect(filterPois(dataset, { filters: filters({ keyword: '深南大道' }) })).toHaveLength(1)
    expect(filterPois(dataset, { filters: filters({ keyword: '不存在' }) })).toHaveLength(0)
  })

  it('银行类型过滤在银行图层内生效', () => {
    const result = filterPois(dataset, {
      filters: filters({ layers: ['bank'], branchType: 'atm' }),
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('b2')
  })

  it('价格区间只作用于小区图层', () => {
    const price = filterPois(dataset, {
      filters: filters({ layers: ['community'], priceRange: [100000, 200000] }),
    })
    expect(price.map((item) => item.id)).toEqual(['c2'])
  })

  it('建成年份只作用于小区图层', () => {
    const year = filterPois(dataset, {
      filters: filters({ layers: ['community'], yearRange: [2012, 2020] }),
    })
    expect(year).toHaveLength(0)

    const older = filterPois(dataset, {
      filters: filters({ layers: ['community'], yearRange: [2009, 2011] }),
    })
    expect(older.map((item) => item.id)).toEqual(['c1'])
  })

  it('框选范围过滤同时裁剪两类点位', () => {
    const result = filterPois(dataset, {
      filters: filters(),
      bounds: { north: 22.545, south: 22.535, east: 114.055, west: 114.045 },
    })
    expect(result.map((item) => item.id)).toEqual(['b1'])
  })

  it('均价排序把无价的小区排到末尾', () => {
    const data = [...dataset, community('c3', { avgPrice: null })]
    const sorted = filterPois(data, {
      filters: filters({ layers: ['community'] }),
      sort: 'priceDesc',
    })
    expect(sorted[0]?.id).toBe('c2')
    expect(sorted.at(-1)?.id).toBe('c3')
  })
})

describe('paginate', () => {
  it('按页切片并返回总数', () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual({ items: [3, 4], total: 5 })
    expect(paginate([1, 2, 3], 2, 2)).toEqual({ items: [3], total: 3 })
    expect(paginate([1, 2, 3], 3, 2)).toEqual({ items: [], total: 3 })
    expect(paginate([], 1, 10)).toEqual({ items: [], total: 0 })
  })
})

describe('buildStats', () => {
  it('统计数量、品牌与价格分桶', () => {
    const stats = buildStats(dataset)
    expect(stats.total).toBe(4)
    expect(stats.bank).toBe(2)
    expect(stats.atm).toBe(1)
    expect(stats.branch).toBe(1)
    expect(stats.community).toBe(2)
    expect(stats.brands[0]?.label).toBe('中国建设银行')
    expect(stats.priceBuckets.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(2)
    expect(stats.gridTop.length).toBeGreaterThan(0)
  })
})

describe('buildStats 区域维度', () => {
  it('按区统计银行与小区数量，并按银行数倒序', () => {
    const stats = buildStats([
      bank('b1', { district: '南山区' }),
      bank('b2', { district: '南山区' }),
      bank('b3', { district: '福田区' }),
      community('c1', { district: '福田区' }),
      community('c2', { district: '福田区' }),
      community('c3', { district: '南山区' }),
    ])
    expect(stats.byDistrict).toEqual([
      { label: '南山区', bank: 2, community: 1 },
      { label: '福田区', bank: 1, community: 2 },
    ])
    expect(stats.districts).toBe(2)
  })

  it('没有区的点位不计入区域统计', () => {
    const stats = buildStats([bank('b1', { district: '' })])
    expect(stats.byDistrict).toEqual([])
  })
})

describe('后端探测状态（离线横幅依赖）', () => {
  it('探测失败时把 backendOnline 置为 false，触发页面降级提示', async () => {
    vi.resetModules()
    const server = await import('@/api/server')
    const probe = vi.spyOn(server, 'probeServer').mockResolvedValue(false)
    const pois = await import('@/api/pois')
    const online = await pois.isServerMode()
    expect(online).toBe(false)
    expect(pois.backendOnline.value).toBe(false)
    probe.mockRestore()
  })
})
