import { describe, expect, it } from 'vitest'

import {
  amapMarkerUrl,
  amapNavigationUrl,
  canNavigate,
  tencentMarkerUrl,
  tencentNavigationUrl,
} from '@/lib/nav'

const target = {
  name: '深圳农商银行流塘支行',
  address: '深圳市宝安区新安街道建安路 1 号',
  gcjLng: 113.886647,
  gcjLat: 22.579233,
}

const noCoord = { name: '某某小区', address: '深圳市福田区深南大道 1 号' }

describe('导航链接', () => {
  it('高德用 lng,lat 顺序，并声明 coordinate=gaode', () => {
    const url = amapMarkerUrl(target)
    expect(url).toContain('position=113.886647,22.579233')
    expect(url).toContain('coordinate=gaode')
    expect(url).toContain('src=poi-intel')
  })

  it('腾讯用 lat,lng 顺序（和高德相反，写反会跳到海里）', () => {
    const url = tencentMarkerUrl(target)
    expect(url).toContain('coord:22.579233,113.886647')
    expect(url).toContain('referer=poi-intel')
  })

  it('有坐标时生成导航链接，无坐标时退化为按地址搜索', () => {
    expect(amapNavigationUrl(target)).toContain('uri.amap.com/navigation')
    expect(amapNavigationUrl(target)).toContain('113.886647,22.579233')
    expect(tencentNavigationUrl(target)).toContain('routeplan')

    expect(amapNavigationUrl(noCoord)).toContain('uri.amap.com/search')
    expect(tencentNavigationUrl(noCoord)).toContain('uri/v1/search')
  })

  it('地址会被 URL 编码，不会拼出非法链接', () => {
    const url = amapMarkerUrl(noCoord)
    expect(url).toContain(encodeURIComponent(noCoord.address))
    expect(url).not.toContain(' ')
  })

  it('0 或缺失坐标不算可导航', () => {
    expect(canNavigate(target)).toBe(true)
    expect(canNavigate(noCoord)).toBe(false)
    expect(canNavigate({ ...noCoord, gcjLng: 0, gcjLat: 0 })).toBe(false)
    expect(canNavigate({ ...noCoord, gcjLng: Number.NaN, gcjLat: 22.5 })).toBe(false)
  })
})
