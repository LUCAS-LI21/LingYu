export interface LiveAddressResult {
  enabled: boolean
  address?: string
  reason?: string
  error?: string
  throttled?: boolean
  coord_sys?: string
  source?: string
  stored?: boolean
}

export interface LivePoiItem {
  name: string
  address: string
  type: string
  phone: string
  distance?: number
  lng?: number
  lat?: number
}

export interface LiveAroundResult {
  enabled: boolean
  items?: LivePoiItem[]
  reason?: string
  error?: string
  throttled?: boolean
  coord_sys?: string
  source?: string
  stored?: boolean
}

async function getLive<T>(path: string): Promise<T> {
  const response = await fetch(path)
  const body = (await response.json().catch(() => null)) as {
    code: number
    message: string
    data: T
  } | null
  if (!response.ok || !body || body.code !== 0) {
    throw new Error(body?.message || `实时查询失败（HTTP ${response.status}）`)
  }
  return body.data
}

/**
 * L2 实时层（ADR-0001）：服务端不落库、浏览器不缓存。
 * 结果只在当前页面存活，关闭即消失。
 */
export function fetchLiveAddress(lng: number, lat: number): Promise<LiveAddressResult> {
  return getLive<LiveAddressResult>(`/api/v1/live/address?lng=${lng}&lat=${lat}`)
}

export function fetchLiveAround(
  lng: number,
  lat: number,
  radius = 1000,
  keywords?: string,
): Promise<LiveAroundResult> {
  const query = new URLSearchParams({ lng: String(lng), lat: String(lat), radius: String(radius) })
  if (keywords) query.set('keywords', keywords)
  return getLive<LiveAroundResult>(`/api/v1/live/pois?${query.toString()}`)
}

export interface LiveFacilityItem {
  category: 'school' | 'hospital' | 'metro' | 'mall'
  name: string
  address?: string
  type?: string
  distance?: number
}

export interface LiveFacilitiesResult {
  enabled: boolean
  counts?: Record<string, number>
  items?: LiveFacilityItem[]
  reason?: string
  error?: string
  throttled?: boolean
  stored?: boolean
}

/** 周边配套（L2）：学校/医院/地铁/商场，一次查询按类型归组，不落库 */
export function fetchLiveFacilities(
  lng: number,
  lat: number,
  radius = 1000,
): Promise<LiveFacilitiesResult> {
  return getLive<LiveFacilitiesResult>(
    `/api/v1/live/facilities?lng=${lng}&lat=${lat}&radius=${radius}`,
  )
}
