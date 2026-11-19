const { get } = require('../../utils/api')
const { normalizePoi, normalizeSource } = require('../../utils/poi')
const { openLocation, callPhone, copyText } = require('../../utils/nav')
const {
  formatPrice,
  formatFee,
  formatDistance,
  formatNumber,
  formatDate,
} = require('../../utils/format')

const FIELD_LABELS = {
  address: '地址',
  phone: '电话',
  openingHours: '营业时间',
  name: '名称',
  builtYear: '建成年份',
  avgPrice: '均价',
  propertyFee: '物业费',
  propertyCompany: '物业公司',
  waterSavingYear: '节水年份',
}

Page({
  data: {
    id: '',
    poi: null,
    loading: true,
    error: '',
    sources: [],
    nearby: [],
    nearbyTitle: '附近点位',
    formatted: {},
    liveState: 'idle',
    liveAddress: '',
    liveMessage: '',
    livePoiState: 'idle',
    livePois: [],
  },

  onLoad(options) {
    const id = options.id ? decodeURIComponent(options.id) : ''
    this.setData({ id })
    if (!id) {
      this.setData({ loading: false, error: '缺少点位 ID' })
      return
    }
    this.load()
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const poi = normalizePoi(await get('/pois/' + encodeURIComponent(this.data.id)))
      if (!poi) throw new Error('点位不存在')
      this.setData({
        poi,
        formatted: this.buildFormatted(poi),
        nearbyTitle: poi.type === 'community' ? '最近银行' : '周边小区',
      })
      this.loadExtras(poi)
      this.setData({ loading: false })
    } catch (error) {
      this.setData({ loading: false, error: error.message || '详情加载失败' })
    }
  },

  buildFormatted(poi) {
    if (!poi) return {}
    if (poi.type === 'community') {
      const hasRealPrice = Boolean(poi.avgPrice)
      const priceValue = poi.avgPrice || poi.avgPriceDemo
      return {
        price: formatPrice(priceValue),
        priceNote: hasRealPrice
          ? poi.avgPriceSource === 'gov_reference'
            ? '官方成交参考价'
            : ''
          : poi.avgPriceDemo
            ? '示意均价，不参与筛选'
            : '暂无均价',
        rent: this.rentText(poi),
        developer: poi.developer || '',
        fee: formatFee(poi.propertyFee),
        year: poi.builtYear ? poi.builtYear + ' 年' : '—',
        nearest: poi.nearestBankM ? formatDistance(poi.nearestBankM) : '—',
        bankCount: formatNumber(poi.surroundBankCount),
        atmCount: formatNumber(poi.surroundAtmCount),
        brandCount: formatNumber(poi.nearbyBrandCount),
      }
    }
    return {
      branch: poi.branchType === 'atm' ? 'ATM 自助' : '柜台网点',
      phone: poi.phone || '—',
      hours: poi.openingHours || '—',
    }
  },

  rentText(poi) {
    const parts = []
    if (poi.rentGc) parts.push('高层 ' + Number(poi.rentGc).toFixed(1))
    if (poi.rentDc) parts.push('多层 ' + Number(poi.rentDc).toFixed(1))
    if (poi.rentDmd) parts.push('低密度 ' + Number(poi.rentDmd).toFixed(1))
    return parts.length ? parts.join(' / ') + ' 元/㎡·月' : ''
  },

  async loadExtras(poi) {
    const base = '/pois/' + encodeURIComponent(poi.id)
    const tasks = [get(base + '/sources').catch(() => [])]
    tasks.push(
      poi.type === 'community'
        ? get(base + '/nearest-banks', { limit: 3, radius: 5000 }).catch(() => ({ items: [] }))
        : get(base + '/nearby-communities', { limit: 3, radius: 1000 }).catch(() => ({ items: [] })),
    )

    const [sourceRows, nearbyRaw] = await Promise.all(tasks)
    const sources = (sourceRows || []).map((row) => {
      const source = normalizeSource(row)
      return Object.assign(source, {
        label: FIELD_LABELS[source.field] || source.field,
        date: source.updatedAt ? formatDate(source.updatedAt).slice(0, 10) : '—',
      })
    })
    const nearby = ((nearbyRaw && nearbyRaw.items) || []).map((row) => {
      const item = row.poi ? normalizePoi(row.poi) : normalizePoi(row)
      return {
        id: (item && item.id) || row.id,
        name: (item && item.name) || row.name || '点位',
        address: (item && item.address) || row.address || '',
        distance: formatDistance(row.distance),
      }
    })
    this.setData({ sources, nearby })
  },

  openNav() {
    if (this.data.poi) openLocation(this.data.poi)
  },

  callPhone() {
    if (this.data.poi && this.data.poi.phone) callPhone(this.data.poi.phone)
  },

  copyAddress() {
    if (this.data.poi) copyText(this.data.poi.address, '地址已复制')
  },

  goFeedback() {
    const poi = this.data.poi
    if (!poi) return
    wx.navigateTo({
      url:
        '/pages/feedback/feedback?poiId=' +
        encodeURIComponent(poi.id) +
        '&poiName=' +
        encodeURIComponent(poi.name) +
        '&poiType=' +
        poi.type,
    })
  },

  async loadLiveAddress() {
    const poi = this.data.poi
    if (!poi) return
    this.setData({ liveState: 'loading', liveMessage: '', liveAddress: '' })
    try {
      const data = await get('/live/address', { lng: poi.lng, lat: poi.lat })
      if (!data.enabled) {
        this.setData({
          liveState: 'unavailable',
          liveMessage: data.reason || '实时地址暂不可用',
        })
        return
      }
      if (data.error) {
        this.setData({ liveState: 'error', liveMessage: data.error })
        return
      }
      if (!data.address) {
        this.setData({ liveState: 'empty', liveMessage: '高德未返回该坐标的地址' })
        return
      }
      this.setData({ liveState: 'success', liveAddress: data.address })
    } catch (error) {
      this.setData({ liveState: 'error', liveMessage: error.message || '实时地址查询失败' })
    }
  },

  async loadLivePois() {
    const poi = this.data.poi
    if (!poi) return
    this.setData({ livePoiState: 'loading', livePois: [] })
    try {
      const data = await get('/live/pois', { lng: poi.lng, lat: poi.lat, radius: 1000 })
      if (!data.enabled) {
        this.setData({
          livePoiState: 'unavailable',
          liveMessage: data.reason || '实时周边暂不可用',
        })
        return
      }
      if (data.error) {
        this.setData({ livePoiState: 'error', liveMessage: data.error })
        return
      }
      this.setData({
        livePoiState: 'success',
        livePois: (data.items || []).slice(0, 6),
      })
    } catch (error) {
      this.setData({ livePoiState: 'error', liveMessage: error.message || '实时周边查询失败' })
    }
  },

  retry() {
    this.load()
  },

  onShareAppMessage() {
    if (!this.data.poi) return { title: '邻域', path: '/pages/map/map' }
    return {
      title: this.data.poi.name + ' · 邻域',
      path: '/pages/detail/detail?id=' + encodeURIComponent(this.data.poi.id),
    }
  },
})
