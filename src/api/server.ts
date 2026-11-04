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
  builtYear?: number | null
  avgPrice?: number | null
  propertyFee?: number | null
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
    }
  }
  return {
    ...base,
    type: 'community',
    builtYear: row.builtYear ?? null,
    avgPrice: row.avgPrice ?? null,
    propertyFee:
      row.propertyFee === null || row.propertyFee === undefined ? null : Number(row.propertyFee),
    demoAttributes: Boolean(row.demoAttributes),
  }
}

export async function fetchAllPois(): Promise<Poi[]> {
  const data = await request<{ items: ServerPoi[]; total: number }>('/pois?size=5000')
  return data.items.map(toPoi)
}

export interface ServerStats {
  total: number
  bank: number
  atm: number
  branch: number
  community: number
  districts: number
  brands: Array<{ label: string; value: number }>
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
