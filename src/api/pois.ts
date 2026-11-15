import {
  apiRequest,
  fetchAllPois,
  fetchNearby as fetchNearbyRemote,
  fetchFieldSources,
  type FieldSource,
  fetchStats as fetchStatsRemote,
  postFeedback,
  probeServer,
} from './server'
import { saveFeedbackRecord } from '@/lib/feedbackHistory'
import type { BranchType, CommunityPoi, Filters, Poi, PoiDataset, PoiType } from '@/types/poi'

let serverMode: boolean | null = null
let probing: Promise<boolean> | null = null

/** 后端在线则走真实接口，否则整体降级到本地种子数据（离线也能演示） */
export async function isServerMode(): Promise<boolean> {
  if (serverMode !== null) return serverMode
  if (!probing) {
    probing = probeServer().then((value) => {
      serverMode = value
      return value
    })
  }
  return probing
}

/** 深圳 10 区近似中心，用于把坐标归到行政区（MVP 用最近质心，后端接入后换成点面判定） */
const DISTRICT_ANCHORS = [
  { name: '福田区', lng: 114.055, lat: 22.541 },
  { name: '罗湖区', lng: 114.131, lat: 22.548 },
  { name: '南山区', lng: 113.93, lat: 22.533 },
  { name: '盐田区', lng: 114.236, lat: 22.557 },
  { name: '宝安区', lng: 113.883, lat: 22.555 },
  { name: '龙岗区', lng: 114.246, lat: 22.72 },
  { name: '龙华区', lng: 114.036, lat: 22.697 },
  { name: '坪山区', lng: 114.35, lat: 22.69 },
  { name: '光明区', lng: 113.936, lat: 22.748 },
  { name: '大鹏新区', lng: 114.479, lat: 22.596 },
]

/** FNV-1a：给演示属性一个稳定的伪随机源，同名小区每次刷新数值一致 */
function hashCode(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seeded(seed: number, salt: number, min: number, max: number, step = 1): number {
  const x = Math.sin(seed * 0.0001 + salt * 12.9898) * 43758.5453
  const frac = x - Math.floor(x)
  return Math.round((min + frac * (max - min)) / step) * step
}

function nearestDistrict(lng: number, lat: number): string {
  let best = DISTRICT_ANCHORS[0]!
  let bestDist = Number.POSITIVE_INFINITY
  for (const anchor of DISTRICT_ANCHORS) {
    const d = (anchor.lng - lng) ** 2 + (anchor.lat - lat) ** 2
    if (d < bestDist) {
      bestDist = d
      best = anchor
    }
  }
  return best.name
}

/** 球面距离（米） */
export function distanceMeters(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const R = 6371000
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function normalize(raw: Record<string, unknown>): Poi | null {
  const type = raw.type as PoiType
  const lng = Number(raw.lng)
  const lat = Number(raw.lat)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null

  const base = {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? '').trim() || '未命名点位',
    address: String(raw.address ?? ''),
    lng,
    lat,
    district: nearestDistrict(lng, lat),
    source: String(raw.source ?? 'OpenStreetMap'),
    license: raw.license ? String(raw.license) : undefined,
    sourceLevel: 'L1' as const,
  }

  if (type === 'bank') {
    return {
      ...base,
      type: 'bank',
      brand: String(raw.brand ?? '').trim(),
      branchType: (raw.branchType === 'atm' ? 'atm' : 'branch') as BranchType,
      phone: String(raw.phone ?? ''),
      openingHours: String(raw.openingHours ?? ''),
    }
  }

  // 小区商业属性：OSM 不提供，用稳定伪随机生成并显式标记为「演示属性」
  const seed = hashCode(base.id + base.name)
  const community: CommunityPoi = {
    ...base,
    type: 'community',
    builtYear: seeded(seed, 1, 1996, 2022),
    avgPrice: seeded(seed, 2, 42000, 138000, 100),
    propertyFee: seeded(seed, 3, 25, 98, 1) / 10,
    demoAttributes: true,
  }
  return community
}

let cache: Poi[] | null = null
let loading: Promise<Poi[]> | null = null

/** 过滤「29栋」「3号楼」这类建筑级命名，小区名应至少有一个非数字字符 */
function isNoiseName(name: string): boolean {
  const value = name.trim()
  if (value.length < 2) return true
  return /^\d+([栋幢号楼单元座]|\s*号?)$/.test(value) || /^\d+$/.test(value)
}

export async function loadPois(): Promise<Poi[]> {
  if (cache) return cache
  if (loading) return loading
  loading = (async () => {
    // 优先走真实后端；失败则静默降级到本地种子，保证演示不中断
    if (await isServerMode()) {
      try {
        const remote = await fetchAllPois()
        if (remote.length > 0) {
          cache = remote.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
          return cache
        }
      } catch {
        serverMode = false
      }
    }

    const res = await fetch(`${import.meta.env.BASE_URL}data/pois.json`)
    if (!res.ok) throw new Error(`种子数据加载失败：${res.status}`)
    const dataset = (await res.json()) as PoiDataset
    const pois = dataset.pois
      .map(normalize)
      .filter((item): item is Poi => item !== null)
      // OSM 里大量建筑被标成 residential 并命名为「29栋」这类，对业务无意义
      .filter((poi) => poi.type === 'bank' || !isNoiseName(poi.name))

    // OSM 里同一小区常被拆成多个地块，按名称去重并优先保留带地址的那条
    const byName = new Map<string, Poi>()
    for (const poi of pois) {
      const key = poi.type === 'community' ? `c:${poi.name}` : poi.id
      const existing = byName.get(key)
      if (!existing) {
        byName.set(key, poi)
        continue
      }
      if (existing.type === 'community' && poi.type === 'community') {
        if ((poi.address?.length ?? 0) > (existing.address?.length ?? 0)) byName.set(key, poi)
      }
    }
    cache = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    return cache
  })()
  return loading
}

export interface QueryBounds {
  west: number
  south: number
  east: number
  north: number
}

export interface QueryEvent {
  keyword?: string
  district?: string
  types?: PoiType[]
  bounds?: QueryBounds
  minPrice?: number
  maxPrice?: number
  minYear?: number
  maxYear?: number
}

/** 把用户搜索行为记到后端 query_log：复用 /pois（size=1），失败静默不影响主流程 */
export async function recordQuery(event: QueryEvent): Promise<void> {
  if (!(await isServerMode())) return
  const params = new URLSearchParams({ size: '1' })
  const keyword = event.keyword?.trim()
  if (keyword) params.set('keyword', keyword)
  if (event.district && event.district !== '全部区域') params.set('district', event.district)
  if (event.types?.length) params.set('types', event.types.join(','))

  const bounds = event.bounds ?? districtBounds(event.district)
  if (bounds) {
    params.set('west', String(bounds.west))
    params.set('south', String(bounds.south))
    params.set('east', String(bounds.east))
    params.set('north', String(bounds.north))
  }
  if (event.minPrice !== undefined) params.set('minPrice', String(event.minPrice))
  if (event.maxPrice !== undefined) params.set('maxPrice', String(event.maxPrice))
  if (event.minYear !== undefined) params.set('minYear', String(event.minYear))
  if (event.maxYear !== undefined) params.set('maxYear', String(event.maxYear))

  try {
    await apiRequest<unknown>(`/pois?${params.toString()}`)
  } catch {
    // 行为埋点失败不影响查询本身；热点分析可接受少量缺失
  }
}

function districtBounds(district?: string): QueryBounds | undefined {
  if (!district || district === '全部区域') return undefined
  const anchor = DISTRICT_ANCHORS.find((item) => item.name === district)
  if (!anchor) return undefined
  const span = 0.02
  return {
    west: anchor.lng - span,
    south: anchor.lat - span,
    east: anchor.lng + span,
    north: anchor.lat + span,
  }
}

/** 本地全量检索：用于纠错表单选点位，避免每次输入都打后端 */
export async function searchPois(keyword: string, limit = 8): Promise<Poi[]> {
  const term = keyword.trim().toLowerCase()
  if (!term) return []
  const all = await loadPois()
  return all
    .filter((poi) => `${poi.name} ${poi.address} ${poi.district}`.toLowerCase().includes(term))
    .slice(0, limit)
}

export interface QueryOptions {
  filters: Filters
  bounds?: { north: number; south: number; east: number; west: number } | null
  sort?: 'default' | 'name' | 'priceAsc' | 'priceDesc' | 'yearDesc' | 'yearAsc'
  page?: number
  pageSize?: number
}

export function filterPois(pois: Poi[], options: QueryOptions): Poi[] {
  const { filters, bounds, sort = 'default' } = options
  const keyword = filters.keyword.trim().toLowerCase()
  const minPrice = filters.priceRange?.[0] ?? null
  const maxPrice = filters.priceRange?.[1] ?? null
  const minYear = filters.yearRange?.[0] ?? null
  const maxYear = filters.yearRange?.[1] ?? null

  const result = pois.filter((poi) => {
    if (!filters.layers.includes(poi.type)) return false
    if (filters.district !== '全部区域' && poi.district !== filters.district) return false
    if (bounds) {
      if (poi.lat > bounds.north || poi.lat < bounds.south) return false
      if (poi.lng > bounds.east || poi.lng < bounds.west) return false
    }
    if (keyword) {
      const haystack = `${poi.name} ${poi.address}`.toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    if (
      poi.type === 'bank' &&
      filters.branchType !== 'all' &&
      poi.branchType !== filters.branchType
    ) {
      return false
    }
    if (poi.type === 'community') {
      if (minPrice !== null && (poi.avgPrice === null || poi.avgPrice < minPrice)) return false
      if (maxPrice !== null && (poi.avgPrice === null || poi.avgPrice > maxPrice)) return false
      if (minYear !== null && (poi.builtYear === null || poi.builtYear < minYear)) return false
      if (maxYear !== null && (poi.builtYear === null || poi.builtYear > maxYear)) return false
    }
    return true
  })

  if (sort === 'name') result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  if (sort === 'priceAsc' || sort === 'priceDesc') {
    const dir = sort === 'priceAsc' ? 1 : -1
    result.sort((a, b) => {
      const av = a.type === 'community' ? (a.avgPrice ?? -1) : -1
      const bv = b.type === 'community' ? (b.avgPrice ?? -1) : -1
      return (av - bv) * dir
    })
  }
  if (sort === 'yearAsc' || sort === 'yearDesc') {
    const dir = sort === 'yearAsc' ? 1 : -1
    result.sort((a, b) => {
      const av = a.type === 'community' ? (a.builtYear ?? 0) : 0
      const bv = b.type === 'community' ? (b.builtYear ?? 0) : 0
      return (av - bv) * dir
    })
  }
  return result
}

export function paginate<T>(items: T[], page = 1, pageSize = 20): { items: T[]; total: number } {
  const start = (page - 1) * pageSize
  return { items: items.slice(start, start + pageSize), total: items.length }
}

export interface NearbyItem {
  poi: Poi
  distance: number
}

export function nearby(
  pois: Poi[],
  center: { lng: number; lat: number },
  radiusMeters: number,
  types: PoiType[] = ['bank'],
  branchType: 'all' | BranchType = 'all',
): NearbyItem[] {
  return pois
    .filter((poi) => types.includes(poi.type))
    .filter((poi) =>
      branchType === 'all' ? true : poi.type === 'bank' && poi.branchType === branchType,
    )
    .map((poi) => ({ poi, distance: distanceMeters(center, poi) }))
    .filter((item) => item.distance <= radiusMeters)
    .sort((a, b) => a.distance - b.distance)
}

export interface Stats {
  total: number
  bank: number
  atm: number
  branch: number
  community: number
  districts: number
  brands: Array<{ label: string; value: number }>
  /** 区域维度：每区银行数与小区数 */
  byDistrict: Array<{ label: string; bank: number; community: number }>
  priceBuckets: Array<{ label: string; value: number }>
  gridTop: Array<{ label: string; value: number; lng: number; lat: number }>
}

export function buildStats(pois: Poi[]): Stats {
  const banks = pois.filter((p) => p.type === 'bank')
  const communities = pois.filter((p) => p.type === 'community')
  const atm = banks.filter((p) => p.branchType === 'atm').length

  const brandMap = new Map<string, number>()
  for (const bank of banks) {
    const key = bank.brand || bank.name.slice(0, 4) || '其他'
    brandMap.set(key, (brandMap.get(key) ?? 0) + 1)
  }
  const brands = [...brandMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)

  const buckets = [
    { label: '< 5 万', min: 0, max: 50000 },
    { label: '5–7 万', min: 50000, max: 70000 },
    { label: '7–9 万', min: 70000, max: 90000 },
    { label: '9–11 万', min: 90000, max: 110000 },
    { label: '≥ 11 万', min: 110000, max: Number.POSITIVE_INFINITY },
  ]
  const priceBuckets = buckets.map((bucket) => ({
    label: bucket.label,
    value: communities.filter(
      (c) => c.avgPrice !== null && c.avgPrice >= bucket.min && c.avgPrice < bucket.max,
    ).length,
  }))

  // 0.02° 网格做「银行密度」排行（约 2.2km × 2.2km）
  const grid = new Map<string, { count: number; lng: number; lat: number }>()
  for (const bank of banks) {
    const gx = Math.floor(bank.lng / 0.02)
    const gy = Math.floor(bank.lat / 0.02)
    const key = `${gx}:${gy}`
    const cell = grid.get(key) ?? {
      count: 0,
      lng: (gx + 0.5) * 0.02,
      lat: (gy + 0.5) * 0.02,
    }
    cell.count += 1
    grid.set(key, cell)
  }
  const gridTop = [...grid.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((cell) => ({
      label: `${cell.lng.toFixed(2)}, ${cell.lat.toFixed(2)}`,
      value: cell.count,
      lng: cell.lng,
      lat: cell.lat,
    }))

  // 区域维度：每区银行数 / 小区数
  const districtMap = new Map<string, { bank: number; community: number }>()
  for (const poi of pois) {
    if (!poi.district) continue
    const entry = districtMap.get(poi.district) ?? { bank: 0, community: 0 }
    if (poi.type === 'bank') entry.bank += 1
    else entry.community += 1
    districtMap.set(poi.district, entry)
  }
  const byDistrict = [...districtMap.entries()]
    .map(([label, value]) => ({ label, bank: value.bank, community: value.community }))
    .sort((a, b) => b.bank - a.bank || b.community - a.community)

  return {
    total: pois.length,
    bank: banks.length,
    atm,
    branch: banks.length - atm,
    community: communities.length,
    districts: new Set(pois.map((p) => p.district)).size,
    brands,
    byDistrict,
    priceBuckets,
    gridTop,
  }
}

export interface FeedbackPayload {
  poiType: PoiType
  poiId: string
  poiName: string
  type: 'error' | 'closed' | 'add'
  field: string
  newValue: string
  description: string
  contact: string
}

export interface FeedbackRecord extends FeedbackPayload {
  code: string
  status: 'pending' | 'auto_applied'
  createdAt: string
}

const feedbackStore: FeedbackRecord[] = []

export async function submitFeedback(payload: FeedbackPayload): Promise<FeedbackRecord> {
  if (await isServerMode()) {
    try {
      const result = await postFeedback(payload)
      const record: FeedbackRecord = {
        ...payload,
        code: result.code,
        status: result.status === 'pending' ? 'pending' : 'auto_applied',
        createdAt: new Date().toISOString(),
      }
      feedbackStore.unshift(record)
      saveFeedbackRecord(record)
      return record
    } catch {
      // 后端异常时退回本地记录，避免用户白填
    }
  }

  const seq = String(feedbackStore.length + 1).padStart(4, '0')
  const record: FeedbackRecord = {
    ...payload,
    code: `FB${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${seq}`,
    status: payload.type === 'add' ? 'pending' : 'auto_applied',
    createdAt: new Date().toISOString(),
  }
  feedbackStore.unshift(record)
  await new Promise((resolve) => setTimeout(resolve, 260))
  saveFeedbackRecord(record)
  return record
}

export async function listFeedback(): Promise<FeedbackRecord[]> {
  return [...feedbackStore]
}

/** 优先走后端统计接口，失败返回 null，调用方用本地统计兜底 */
export async function statsFromServer(): Promise<Stats | null> {
  if (!(await isServerMode())) return null
  try {
    const remote = await fetchStatsRemote()
    // JDBC 的 SUM() 会以字符串返回，统一转数字；旧后端没有 byDistrict 时给空数组
    return {
      ...remote,
      brands: remote.brands ?? [],
      priceBuckets: remote.priceBuckets ?? [],
      gridTop: remote.gridTop ?? [],
      byDistrict: (remote.byDistrict ?? []).map((item) => ({
        label: item.label,
        bank: Number(item.bank) || 0,
        community: Number(item.community) || 0,
      })),
    }
  } catch {
    return null
  }
}

/** 字段级来源：后端在线才有，离线返回 null 让界面隐藏该区块 */
export async function fieldSourcesFromServer(poi: Poi): Promise<FieldSource[] | null> {
  if (!(await isServerMode())) return null
  try {
    return await fetchFieldSources(poi.id)
  } catch {
    return null
  }
}
/** 优先走后端球面距离查询，失败返回 null 让调用方本地兜底 */
export async function nearbyFromServer(
  poi: Poi,
  radius: number,
  branchType: 'all' | BranchType = 'all',
): Promise<NearbyItem[] | null> {
  if (!(await isServerMode())) return null
  try {
    return await fetchNearbyRemote(poi.lng, poi.lat, radius, branchType)
  } catch {
    return null
  }
}

/**
 * L2 实时层（ADR-0001）：仅展示、不落库。
 * 前端优先保证「无 Key 时优雅降级」，接入后端后改调 /api/v1/live/nearby。
 */
export interface LiveResult {
  enabled: boolean
  reason?: string
  items?: Array<{ name: string; address: string; lng: number; lat: number; distance: number }>
}

export async function liveNearby(): Promise<LiveResult> {
  return {
    enabled: false,
    reason: '未配置高德 Key：实时层已降级，当前仅展示本地库数据（符合 L2 仅展示约束）',
  }
}

/** 存量住宅用地（宗地级，政府开放数据） */
export interface LandParcel {
  id: string
  districtStreet: string
  location: string
  areaHa: number | null
  housingType: string
  buildStatus: string
  developer: string
  projectName: string
  supplyDate: string | null
}

export async function fetchLandParcels(
  district = '',
  limit = 100,
): Promise<{ total: number; items: LandParcel[] }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (district) params.set('district', district)
  const data = await apiRequest<{
    total: number
    items: Array<Record<string, unknown>>
  }>(`/land-parcels?${params.toString()}`)
  return {
    total: data.total ?? 0,
    items: (data.items ?? []).map((row) => ({
      id: String(row.id ?? ''),
      districtStreet: String(row.district_street ?? ''),
      location: String(row.location ?? ''),
      areaHa: row.area_ha === null || row.area_ha === undefined ? null : Number(row.area_ha),
      housingType: String(row.housing_type ?? ''),
      buildStatus: String(row.build_status ?? ''),
      developer: String(row.developer ?? ''),
      projectName: String(row.project_name ?? ''),
      supplyDate: row.supply_date ? String(row.supply_date) : null,
    })),
  }
}

/** 最近的 N 家银行（小区详情用） */
export interface NearestBank {
  id: string
  name: string
  brand: string
  address: string
  branchType: string
  distance: number
}

export async function fetchNearestBanks(id: string, limit = 3): Promise<NearestBank[]> {
  const data = await apiRequest<{ items: NearestBank[] }>(
    `/pois/${encodeURIComponent(id)}/nearest-banks?limit=${limit}`,
  )
  return data.items ?? []
}

/** 待定位小区（有名称地址、缺坐标） */
export interface PendingCommunity {
  id: string
  name: string
  address: string
  district: string
  street: string
  attribute: string
}

export async function fetchCommunityPending(params: {
  district?: string
  keyword?: string
  page?: number
  size?: number
}): Promise<{ total: number; page: number; size: number; items: PendingCommunity[] }> {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    size: String(params.size ?? 20),
  })
  if (params.district) query.set('district', params.district)
  if (params.keyword) query.set('keyword', params.keyword)
  const data = await apiRequest<{
    total: number
    page: number
    size: number
    items: Array<Record<string, unknown>>
  }>(`/community-pending?${query.toString()}`)
  return {
    total: data.total ?? 0,
    page: data.page ?? 1,
    size: data.size ?? 20,
    items: (data.items ?? []).map((row) => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? ''),
      address: String(row.address ?? ''),
      district: String(row.district ?? ''),
      street: String(row.street ?? ''),
      attribute: String(row.attribute ?? ''),
    })),
  }
}
