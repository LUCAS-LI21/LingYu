/**
 * 导航链接构建：把 POI 交给高德 / 腾讯地图 App 或网页打开。
 *
 * 三个必须记住的细节：
 * 1. **坐标系**：国内地图用 GCJ-02，库里存的是 WGS-84。直接用 lng/lat 会偏 500 米左右，
 *    所以这里一律用后端算好的 `gcjLng / gcjLat`。
 * 2. **坐标顺序**：高德 URI 是 `lng,lat`，腾讯是 `lat,lng`——写反了会跳到海里。
 * 3. **没有坐标时**：退化成"按地址搜索"，不要拼一个 (0,0) 出来。
 *
 * 这些链接都不需要 API Key，也不会把我们库里的坐标发给对方（只是把点交给地图展示/导航）。
 */

export interface NavTarget {
  name: string
  address?: string
  gcjLng?: number | null
  gcjLat?: number | null
}

const UA_SRC = 'poi-intel'

function hasCoord(target: NavTarget): boolean {
  return (
    typeof target.gcjLng === 'number' &&
    typeof target.gcjLat === 'number' &&
    Number.isFinite(target.gcjLng) &&
    Number.isFinite(target.gcjLat) &&
    target.gcjLng !== 0 &&
    target.gcjLat !== 0
  )
}

function addrOf(target: NavTarget): string {
  return (target.address || target.name || '').trim()
}

/** 高德：在地图上标出这个点 */
export function amapMarkerUrl(target: NavTarget): string {
  if (!hasCoord(target)) {
    return `https://uri.amap.com/search?keyword=${encodeURIComponent(addrOf(target))}&city=${encodeURIComponent('深圳')}&src=${UA_SRC}`
  }
  const position = `${target.gcjLng},${target.gcjLat}`
  return `https://uri.amap.com/marker?position=${position}&name=${encodeURIComponent(target.name)}&address=${encodeURIComponent(addrOf(target))}&src=${UA_SRC}&coordinate=gaode`
}

/** 高德：从当前位置导航过去（打开高德 App 或网页导航） */
export function amapNavigationUrl(target: NavTarget, mode: 'car' | 'bus' | 'walk' = 'car'): string {
  if (!hasCoord(target)) return amapMarkerUrl(target)
  const to = `${target.gcjLng},${target.gcjLat},${encodeURIComponent(target.name)}`
  return `https://uri.amap.com/navigation?to=${to}&mode=${mode}&policy=1&src=${UA_SRC}&coordinate=gaode`
}

/** 腾讯：在地图上标出这个点（注意 lat,lng 顺序） */
export function tencentMarkerUrl(target: NavTarget): string {
  if (!hasCoord(target)) {
    return `https://apis.map.qq.com/uri/v1/search?keyword=${encodeURIComponent(addrOf(target))}&region=${encodeURIComponent('深圳')}&referer=${UA_SRC}`
  }
  const marker = `coord:${target.gcjLat},${target.gcjLng};title:${encodeURIComponent(target.name)};addr:${encodeURIComponent(addrOf(target))}`
  return `https://apis.map.qq.com/uri/v1/marker?marker=${marker}&referer=${UA_SRC}`
}

/** 腾讯：驾车路线规划（打开腾讯地图 App 或网页） */
export function tencentNavigationUrl(target: NavTarget): string {
  if (!hasCoord(target)) return tencentMarkerUrl(target)
  const tocoord = `${target.gcjLat},${target.gcjLng}`
  return `https://apis.map.qq.com/uri/v1/routeplan?type=drive&to=${encodeURIComponent(target.name)}&tocoord=${tocoord}&policy=0&referer=${UA_SRC}`
}

/** 是否具备导航条件（有 GCJ 坐标）；没有时前端应只展示"按地址搜索" */
export function canNavigate(target: NavTarget): boolean {
  return hasCoord(target)
}
