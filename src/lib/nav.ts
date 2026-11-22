/**
 * 导航链接构建：把 POI 交给高德 / 腾讯地图 App 或网页打开。
 * 坐标用后端换算的 GCJ-02；高德 URI 为 lng,lat，腾讯为 lat,lng；无坐标时按地址搜索。
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

/** 腾讯：地图标注该点（lat,lng 顺序） */
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

/** 是否具备导航条件（有 GCJ-02 坐标） */
export function canNavigate(target: NavTarget): boolean {
  return hasCoord(target)
}
