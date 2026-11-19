const { get } = require('../../utils/api')
const { normalizePoi, normalizePoiList, normalizeSource } = require('../../utils/poi')
const { openLocation, callPhone } = require('../../utils/nav')
const {
  formatPrice,
  formatDistance,
  formatNumber,
} = require('../../utils/format')

const DISTRICTS = [
  '全部区域',
  '福田区',
  '罗湖区',
  '南山区',
  '盐田区',
  '宝安区',
  '龙岗区',
  '龙华区',
  '坪山区',
  '光明区',
  '大鹏新区',
]

const DEFAULT_CENTER = {
  latitude: 22.5431,
  longitude: 114.0579,
}

const DISTRICT_CENTERS = {
  福田区: { latitude: 22.541, longitude: 114.055 },
  罗湖区: { latitude: 22.548, longitude: 114.131 },
  南山区: { latitude: 22.533, longitude: 113.93 },
  盐田区: { latitude: 22.557, longitude: 114.237 },
  宝安区: { latitude: 22.555, longitude: 113.884 },
  龙岗区: { latitude: 22.721, longitude: 114.247 },
  龙华区: { latitude: 22.696, longitude: 114.045 },
  坪山区: { latitude: 22.69, longitude: 114.35 },
  光明区: { latitude: 22.748, longitude: 113.936 },
  大鹏新区: { latitude: 22.596, longitude: 114.479 },
}

const FIELD_LABELS = {
  address: '地址',
  phone: '电话',
  openingHours: '营业时间',
  name: '名称',
  builtYear: '建成年份',
  avgPrice: '均价',
  propertyFee: '物业费',
}

Page({
  data: {
    districts: DISTRICTS,
    districtIndex: 0,
    district: '全部区域',
    types: [
      { key: 'all', label: '全部' },
      { key: 'bank', label: '银行网点' },
      { key: 'community', label: '住宅小区' },
    ],
    type: 'all',
    keyword: '',
    latitude: DEFAULT_CENTER.latitude,
    longitude: DEFAULT_CENTER.longitude,
    scale: 13,
    markers: [],
    markerPois: [],
    total: 0,
    loading: true,
    error: '',
    selected: null,
    selectedOpen: false,
    selectedLoading: false,
    nearby: [],
    sources: [],
    formatted: {},
    nearbyTitle: '附近点位',
  },

  onReady() {
    this.mapCtx = wx.createMapContext('poiMap', this)
    this.debounceTimer = null
    this.fetchByRegion()
  },

  onUnload() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
  },

  getRegion() {
    return new Promise((resolve) => {
      if (!this.mapCtx) {
        resolve(null)
        return
      }
      this.mapCtx.getRegion({
        success: (res) => {
          const sw = res.southwest || {}
          const ne = res.northeast || {}
          if (!sw.longitude || !ne.longitude) {
            resolve(null)
            return
          }
          resolve({
            west: sw.longitude,
            east: ne.longitude,
            south: sw.latitude,
            north: ne.latitude,
          })
        },
        fail: () => resolve(null),
      })
    })
  },

  async fetchByRegion() {
    if (this.loadingRequest) return
    this.loadingRequest = true
    this.setData({ loading: true, error: '' })

    try {
      const region = await this.getRegion()
      const params = {
        page: 1,
        size: 300,
        types:
          this.data.type === 'all'
            ? 'bank,community'
            : this.data.type === 'bank'
              ? 'bank'
              : 'community',
        keyword: this.data.keyword.trim(),
        district: this.data.district === '全部区域' ? '' : this.data.district,
      }

      // 有明确关键词/行政区时全局查询；否则只取当前视野，避免一次拉全城
      if (!params.keyword && !params.district) {
        if (region) {
          params.west = region.west
          params.east = region.east
          params.south = region.south
          params.north = region.north
        } else {
          params.west = DEFAULT_CENTER.longitude - 0.09
          params.east = DEFAULT_CENTER.longitude + 0.09
          params.south = DEFAULT_CENTER.latitude - 0.06
          params.north = DEFAULT_CENTER.latitude + 0.06
        }
      }

      const data = await get('/pois', params)
      const items = normalizePoiList(data.items)
      const markerPois = []
      const markers = []

      items.forEach((poi) => {
        if (poi.gcjLng === null || poi.gcjLat === null) return
        const markerId = markerPois.length
        markerPois.push(poi)
        markers.push({
          id: markerId,
          latitude: poi.gcjLat,
          longitude: poi.gcjLng,
          iconPath:
            poi.type === 'community'
              ? '/assets/markers/community.png'
              : '/assets/markers/bank.png',
          width: 30,
          height: 38,
          anchor: { x: 0.5, y: 1 },
          zIndex: poi.type === 'community' ? 1 : 2,
          callout: {
            content: poi.name,
            color: '#0f172a',
            fontSize: 11,
            borderRadius: 8,
            padding: 6,
            bgColor: '#ffffff',
            display: 'BYCLICK',
          },
        })
      })

      this.setData({
        markers,
        markerPois,
        total: Number(data.total || items.length),
        loading: false,
        error: items.length ? '' : '当前条件下暂无点位',
      })
    } catch (error) {
      this.setData({
        loading: false,
        error: error.message || '点位加载失败',
      })
    } finally {
      this.loadingRequest = false
    }
  },

  onRegionChange(e) {
    const phase = (e.detail && e.detail.type) || e.type
    if (phase !== 'end') return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.fetchByRegion(), 360)
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    this.fetchByRegion()
  },

  clearKeyword() {
    this.setData({ keyword: '' })
    this.fetchByRegion()
  },

  setType(e) {
    const type = e.currentTarget.dataset.type
    if (type === this.data.type) return
    this.setData({ type })
    this.fetchByRegion()
  },

  onDistrictChange(e) {
    const index = Number(e.detail.value)
    const district = this.data.districts[index]
    const center = DISTRICT_CENTERS[district]
    const patch = {
      districtIndex: index,
      district,
    }
    if (center) {
      patch.latitude = center.latitude
      patch.longitude = center.longitude
      patch.scale = 13
    }
    this.setData(patch)
    this.fetchByRegion()
  },

  onMarkerTap(e) {
    const markerId = e.detail.markerId
    const poi = this.data.markerPois[markerId]
    if (!poi) return
    this.setData({
      selected: poi,
      selectedOpen: true,
      selectedLoading: true,
      nearby: [],
      sources: [],
      formatted: this.buildFormatted(poi),
      nearbyTitle: poi.type === 'community' ? '最近银行' : '周边小区',
    })
    this.loadSelectedDetail(poi)
  },

  buildFormatted(poi) {
    if (!poi) return {}
    if (poi.type === 'community') {
      const priceValue = poi.avgPrice || poi.avgPriceDemo
      return {
        price: formatPrice(priceValue),
        priceNote: poi.avgPrice
          ? poi.avgPriceSource === 'gov_reference'
            ? '官方参考价'
            : ''
          : poi.avgPriceDemo
            ? '示意均价'
            : '',
        fee: poi.propertyFee === null ? '—' : Number(poi.propertyFee).toFixed(2) + ' 元/㎡·月',
        year: poi.builtYear ? poi.builtYear + ' 年' : '—',
        nearest: poi.nearestBankM ? formatDistance(poi.nearestBankM) : '—',
        surround: formatNumber(poi.surroundBankCount) + ' 家 / ' + formatNumber(poi.surroundAtmCount) + ' 台',
      }
    }
    return {
      branch: poi.branchType === 'atm' ? 'ATM 自助' : '柜台网点',
      phone: poi.phone || '—',
    }
  },

  async loadSelectedDetail(poi) {
    try {
      const tasks = [
        get('/pois/' + encodeURIComponent(poi.id)),
        get('/pois/' + encodeURIComponent(poi.id) + '/sources').catch(() => []),
      ]
      if (poi.type === 'community') {
        tasks.push(
          get('/pois/' + encodeURIComponent(poi.id) + '/nearest-banks', {
            limit: 3,
            radius: 5000,
          }).catch(() => ({ items: [] })),
        )
      } else {
        tasks.push(
          get('/pois/' + encodeURIComponent(poi.id) + '/nearby-communities', {
            limit: 3,
            radius: 1000,
          }).catch(() => ({ items: [] })),
        )
      }

      const [detailRaw, sourceRows, nearbyRaw] = await Promise.all(tasks)
      const detail = normalizePoi(detailRaw) || poi
      const sources = (sourceRows || []).map((row) => {
        const source = normalizeSource(row)
        return Object.assign(source, {
          label: FIELD_LABELS[source.field] || source.field,
          date: source.updatedAt ? String(source.updatedAt).slice(0, 10) : '—',
        })
      })
      const nearbyRows = nearbyRaw && nearbyRaw.items ? nearbyRaw.items : []
      const nearby = nearbyRows.map((row) => {
        const item = row.poi ? normalizePoi(row.poi) : normalizePoi(row)
        return {
          id: (item && item.id) || row.id,
          name: (item && item.name) || row.name || '点位',
          address: (item && item.address) || row.address || '',
          distance: formatDistance(row.distance),
          type: (item && item.type) || 'bank',
        }
      })

      // 请求期间用户可能已切换点位
      if (!this.data.selected || this.data.selected.id !== poi.id) return
      this.setData({
        selected: detail,
        selectedLoading: false,
        nearby,
        sources,
        formatted: this.buildFormatted(detail),
      })
    } catch (error) {
      if (!this.data.selected || this.data.selected.id !== poi.id) return
      this.setData({
        selectedLoading: false,
        error: error.message || '详情加载失败',
      })
    }
  },

  closeSelected() {
    this.setData({
      selected: null,
      selectedOpen: false,
      nearby: [],
      sources: [],
    })
  },

  goDetail() {
    if (!this.data.selected) return
    wx.navigateTo({
      url: '/pages/detail/detail?id=' + encodeURIComponent(this.data.selected.id),
    })
  },

  goFeedback() {
    if (!this.data.selected) return
    const poi = this.data.selected
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

  openSelectedLocation() {
    if (this.data.selected) openLocation(this.data.selected)
  },

  callSelectedPhone() {
    if (this.data.selected && this.data.selected.phone) {
      callPhone(this.data.selected.phone)
    }
  },

  goList() {
    try {
      wx.setStorageSync('poi_list_query', {
        keyword: this.data.keyword.trim(),
        district: this.data.district === '全部区域' ? '' : this.data.district,
        type: this.data.type,
      })
    } catch (e) {
      // ignore
    }
    wx.switchTab({ url: '/pages/list/list' })
  },

  retry() {
    this.fetchByRegion()
  },

  onShareAppMessage() {
    return {
      title: '邻域 POI · 深圳银行网点与小区地图',
      path: '/pages/map/map',
    }
  },
})
