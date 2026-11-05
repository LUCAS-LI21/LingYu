export interface LiveAddressResult {
  enabled: boolean
  address?: string
  reason?: string
  error?: string
  source?: string
  stored?: boolean
}

/**
 * L2 实时地址（ADR-0001）：服务端不落库、浏览器不缓存。
 * 仅用于在详情里临时展示，页面关闭即消失。
 */
export async function fetchLiveAddress(lng: number, lat: number): Promise<LiveAddressResult> {
  const response = await fetch(`/api/v1/live/address?lng=${lng}&lat=${lat}`)
  const body = (await response.json().catch(() => null)) as {
    code: number
    message: string
    data: LiveAddressResult
  } | null
  if (!response.ok || !body || body.code !== 0) {
    throw new Error(body?.message || `实时地址查询失败（HTTP ${response.status}）`)
  }
  return body.data
}
