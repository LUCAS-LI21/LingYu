const { get, trackQuery } = require('../../utils/api')
const { normalizePoiList } = require('../../utils/poi')
const { formatPrice } = require('../../utils/format')

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

const SORTS = [
  { key: 'default', label: '默认排序' },
  { key: 'priceAsc', label: '均价从低到高' },
  { key: 'priceDesc', label: '均价从高到低' },
  { key: 'yearAsc', label: '建成年份从早到晚' },
  { key: 'yearDesc', label: '建成年份从晚到早' },
]

const PAGE_SIZE = 20

Page({
  data: {
    keyword: '',
    districts: DISTRICTS,
    districtIndex: 0,
    district: '全部区域',
    types: [
      { key: 'all', label: '全部' },
      { key: 'bank', label: '银行' },
      { key: 'community', label: '小区' },
    ],
    type: 'all',
    sortIndex: 0,
    sortLabel: '默认排序',
    sorts: SORTS.map((s) => s.label),
    items: [],
    skeletons: [1, 2, 3, 4],
    total: 0,
    page: 1,
    loading: true,
    loadingMore: false,
    hasMore: false,
    error: '',
  },

  onLoad(options) {
    const patch = {}
    if (options.keyword) patch.keyword = decodeURIComponent(options.keyword)
    if (options.district) {
      const index = this.data.districts.indexOf(decodeURIComponent(options.district))
      if (index >= 0) {
        patch.districtIndex = index
        patch.district = this.data.districts[index]
      }
    }
    if (options.layers) {
      const layers = decodeURIComponent(options.layers)
      patch.type = layers === 'bank' || layers === 'community' ? layers : 'all'
    }
    if (Object.keys(patch).length) this.setData(patch)
    this.fetch(true)
  },

  onShow() {
    let incoming = null
    try {
      incoming = wx.getStorageSync('poi_list_query')
      if (incoming) wx.removeStorageSync('poi_list_query')
    } catch (e) {
      incoming = null
    }
    if (incoming) {
      const index = this.data.districts.indexOf(incoming.district || '全部区域')
      this.setData({
        keyword: incoming.keyword || '',
        districtIndex: index >= 0 ? index : 0,
        district: index >= 0 ? this.data.districts[index] : '全部区域',
        type: incoming.type || 'all',
      })
      this.fetch(true)
    }
  },

  async fetch(reset) {
    if (this.loadingRequest && !reset) return
    if (reset) this.setData({ loading: true, error: '', items: [], page: 1 })
    else this.setData({ loadingMore: true })

    const requestId = Date.now()
    this.requestId = requestId
    const page = reset ? 1 : this.data.page
    this.loadingRequest = true

    try {
      const data = await get('/pois', {
        page,
        size: PAGE_SIZE,
        types:
          this.data.type === 'all'
            ? 'bank,community'
            : this.data.type === 'bank'
              ? 'bank'
              : 'community',
        keyword: this.data.keyword.trim(),
        district: this.data.district === '全部区域' ? '' : this.data.district,
        sort: SORTS[this.data.sortIndex].key,
      })

      if (this.requestId !== requestId) return
      const rows = normalizePoiList(data.items).map((poi) => this.decorate(poi))
      const total = Number(data.total || rows.length)
      const nextItems = reset ? rows : this.data.items.concat(rows)
      this.setData({
        items: nextItems,
        total,
        page: page + 1,
        loading: false,
        loadingMore: false,
        hasMore: nextItems.length < total,
        error: '',
      })
    } catch (error) {
      if (this.requestId !== requestId) return
      this.setData({
        loading: false,
        loadingMore: false,
        error: error.message || '列表加载失败',
      })
    } finally {
      if (this.requestId === requestId) this.loadingRequest = false
    }
  },

  decorate(poi) {
    if (poi.type === 'community') {
      return Object.assign({}, poi, {
        typeText: '住宅小区',
        tagClass: 'tag-amber',
        meta: (poi.builtYear ? poi.builtYear + ' 年建' : '年份待补充') + ' · ' + formatPrice(poi.avgPrice),
        extra: poi.propertyCompany ? '物业 ' + poi.propertyCompany : '物业信息待补充',
        thumb: '宅',
      })
    }
    return Object.assign({}, poi, {
      typeText: poi.branchType === 'atm' ? '银行 ATM' : '银行网点',
      tagClass: 'tag-brand',
      meta: (poi.brand || '银行') + ' · ' + (poi.branchType === 'atm' ? '自助设备' : '柜台网点'),
      extra: poi.phone || poi.openingHours || '营业信息待补充',
      thumb: '银',
    })
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    this.setData({ page: 1 })
    trackQuery(
      this.data.keyword.trim(),
      this.data.district === '全部区域' ? '' : this.data.district,
      this.data.type === 'all' ? ['bank', 'community'] : [this.data.type],
    )
    this.fetch(true)
  },

  setType(e) {
    const type = e.currentTarget.dataset.type
    if (type === this.data.type) return
    this.setData({ type })
    this.fetch(true)
  },

  onDistrictChange(e) {
    const index = Number(e.detail.value)
    this.setData({
      districtIndex: index,
      district: this.data.districts[index],
    })
    this.fetch(true)
  },

  onSortChange(e) {
    const index = Number(e.detail.value)
    this.setData({ sortIndex: index, sortLabel: SORTS[index].label })
    this.fetch(true)
  },

  clearFilters() {
    this.setData({
      keyword: '',
      districtIndex: 0,
      district: '全部区域',
      type: 'all',
      sortIndex: 0,
      sortLabel: '默认排序',
    })
    this.fetch(true)
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(id) })
  },

  goMap() {
    wx.switchTab({ url: '/pages/map/map' })
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore && !this.data.loading) {
      this.fetch(false)
    }
  },

  onPullDownRefresh() {
    this.fetch(true).finally(() => wx.stopPullDownRefresh())
  },

  onShareAppMessage() {
    return {
      title: '邻域 POI · 深圳银行网点与小区列表',
      path: '/pages/list/list',
    }
  },
})
