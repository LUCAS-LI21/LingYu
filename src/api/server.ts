import { clearToken, getToken } from './auth'
import type { Poi } from '@/types/poi'

const BASE = '/api/v1'

interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

interface ServerPoi {
  id: string
  type: 'bank' | 'community'
  name: string
  address?: string | null
  district?: string | null
  lng: number
  lat: number
  brand?: string | null
  branchType?: 'branch' | 'atm' | null
  phone?: string | null
  openingHours?: string | null
  /** 服务类型：对公/对私/自助（逗号分隔，来自官网文本） */
  serviceTypes?: string | null
  gcjLng?: number | null
  gcjLat?: number | null
  builtYear?: number | null
  avgPrice?: number | null
  avgPriceSource?: string
  avgPriceDemo?: number | null
  propertyFee?: number | null
  propertyCompany?: string | null
  waterSavingYear?: number | null
  rentDc?: number | null
  rentGc?: number | null
  rentDmd?: number | null
  developer?: string
  surroundBankCount?: number | null
  surroundAtmCount?: number | null
  nearbyBrandCount?: number | null
  nearestBankM?: number | null
  demoAttributes?: boolean | null
  source?: string | null
  license?: string | null
  sourceLevel?: string | null
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // 运营接口需要 Bearer token；其余接口带了也无害
  const token = getToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers, ...((init?.headers as Record<string, string>) ?? {}) },
  })
  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null
  if (response.status === 401) {
    clearToken()
    throw new Error('未登录或登录已过期')
  }
  if (!response.ok) {
    throw new Error(body?.message || `请求失败（HTTP ${response.status}）`)
  }
  if (!body || body.code !== 0) {
    throw new Error(body?.message || '业务处理失败')
  }
  return body.data
}

const request = apiRequest

/** 探测后端是否可用；失败即整体降级到本地 mock，保证离线也能演示 */
export async function probeServer(): Promise<boolean> {
  try {
    const data = await request<{ status: string }>('/health', {
      signal: AbortSignal.timeout(2500),
    })
    return data.status === 'ok'
  } catch {
    return false
  }
}

function toPoi(row: ServerPoi): Poi {
  const base = {
    id: row.id,
    name: row.name,
    address: row.address ?? '',
    district: row.district ?? '',
    lng: Number(row.lng),
    lat: Number(row.lat),
    gcjLng: row.gcjLng === null || row.gcjLng === undefined ? null : Number(row.gcjLng),
    gcjLat: row.gcjLat === null || row.gcjLat === undefined ? null : Number(row.gcjLat),
    source: row.source ?? 'OpenStreetMap',
    license: row.license ?? undefined,
    sourceLevel: 'L1' as const,
  }
  if (row.type === 'bank') {
    return {
      ...base,
      type: 'bank',
      brand: row.brand ?? '',
      branchType: row.branchType === 'atm' ? 'atm' : 'branch',
      phone: row.phone ?? '',
      openingHours: row.openingHours ?? '',
      serviceTypes: row.serviceTypes ?? '',
    }
  }
  return {
    ...base,
    type: 'community',
    builtYear: row.builtYear ?? null,
    avgPrice: row.avgPrice ?? null,
    avgPriceSource: row.avgPriceSource ?? 'demo',
    avgPriceDemo:
      row.avgPriceDemo === null || row.avgPriceDemo === undefined ? null : Number(row.avgPriceDemo),
    propertyFee:
      row.propertyFee === null || row.propertyFee === undefined ? null : Number(row.propertyFee),
    propertyCompany: row.propertyCompany ?? '',
    waterSavingYear: row.waterSavingYear ?? null,
    rentDc: row.rentDc === null || row.rentDc === undefined ? null : Number(row.rentDc),
    rentGc: row.rentGc === null || row.rentGc === undefined ? null : Number(row.rentGc),
    rentDmd: row.rentDmd === null || row.rentDmd === undefined ? null : Number(row.rentDmd),
    developer: row.developer ?? '',
    surroundBankCount: Number(row.surroundBankCount ?? 0),
    surroundAtmCount: Number(row.surroundAtmCount ?? 0),
    nearbyBrandCount: Number(row.nearbyBrandCount ?? 0),
    nearestBankM: Number(row.nearestBankM ?? 0),
    demoAttributes: Boolean(row.demoAttributes),
  }
}

export async function fetchAllPois(): Promise<Poi[]> {
  // view=lite：地图/列表只需要核心字段，整包体积约减 60%（详情接口仍取全量）
  const data = await request<{ items: ServerPoi[]; total: number }>('/pois?size=20000&lite=true')
  return data.items.map(toPoi)
}

export interface FieldSource {
  field: string
  source: string
  sourceUrl: string
  updatedAt: string
}

/** 字段级来源：回答"这条地址/电话是哪来的" */
export async function fetchFieldSources(id: string): Promise<FieldSource[]> {
  const rows = await request<
    Array<{ field: string; source: string; source_url?: string; updated_at?: string }>
  >(`/pois/${encodeURIComponent(id)}/sources`)
  return rows.map((r) => ({
    field: r.field,
    source: r.source,
    sourceUrl: r.source_url ?? '',
    updatedAt: r.updated_at ?? '',
  }))
}

export interface ServerStats {
  total: number
  bank: number
  atm: number
  branch: number
  community: number
  districts: number
  brands: Array<{ label: string; value: number }>
  /** 区域维度：每区银行数与小区数（可能为空数组，旧后端） */
  byDistrict?: Array<{ label: string; bank: number | string; community: number | string }>
  priceBuckets: Array<{ label: string; value: number }>
  gridTop: Array<{ label: string; value: number; lng: number; lat: number }>
}

export async function fetchStats(): Promise<ServerStats> {
  return request<ServerStats>('/stats')
}

export interface ServerNearbyItem {
  poi: ServerPoi
  distance: number
}

export async function fetchNearby(
  lng: number,
  lat: number,
  radius: number,
  branchType: 'all' | 'atm' | 'branch' = 'all',
): Promise<Array<{ poi: Poi; distance: number }>> {
  const data = await request<{ items: ServerNearbyItem[] }>(
    `/pois/nearby?lng=${lng}&lat=${lat}&radius=${radius}&branchType=${branchType}&limit=100`,
  )
  return data.items.map((item) => ({ poi: toPoi(item.poi), distance: item.distance }))
}

export interface FeedbackPayloadLike {
  poiType: 'bank' | 'community'
  poiId: string
  poiName: string
  type: 'error' | 'closed' | 'add'
  field: string
  newValue: string
  description: string
  contact: string
}

export async function postFeedback(
  payload: FeedbackPayloadLike,
): Promise<{ code: string; status: string }> {
  return request<{ code: string; status: string }>('/feedback', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export interface HotspotItem {
  grid: string
  queryCount: number
  zeroResultCount: number
  priority?: number
  lastDate?: string
}

export interface HotspotKeyword {
  keyword: string
  searchCount: number
}

export interface Hotspots {
  items: HotspotItem[]
  /** 面向用户的热门搜索词（原始网格坐标只在运营后台用） */
  keywords?: HotspotKeyword[]
  /** 近 7 天关键词搜索总次数（与网格口径分开） */
  totalSearches?: number
  totalQueries: number
}

/** 查询热点（公开接口）：query_log 聚合的近 7 天热门网格 */
export async function fetchHotspots(limit = 8): Promise<Hotspots> {
  return request<Hotspots>(`/hotspots?limit=${limit}`)
}
