const { get, trackQuery } = require('../../utils/api')
const { formatNumber } = require('../../utils/format')

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

Page({
  data: {
    loading: true,
    error: '',
    stats: null,
    cards: [],
    brands: [],
    priceBuckets: [],
    byDistrict: [],
    gridTop: [],
    keyword: '',
    districtIndex: 0,
    district: '全部区域',
    districts: DISTRICTS,
    type: 'all',
    types: [
      { key: 'all', label: '全部' },
      { key: 'bank', label: '银行' },
      { key: 'community', label: '小区' },
    ],
  },

  onLoad() {
    this.load()
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const raw = await get('/stats')
      const brands = (raw.brands || []).slice(0, 6).map((row) => ({
        label: row.label,
        value: Number(row.value || 0),
      }))
      const maxBrand = Math.max(1, ...brands.map((row) => row.value))
      brands.forEach((row) => {
        row.width = Math.max(4, Math.round((row.value / maxBrand) * 100))
      })

      const priceBuckets = (raw.priceBuckets || []).map((row) => ({
        label: row.label,
        value: Number(row.value || 0),
      }))
      const maxPrice = Math.max(1, ...priceBuckets.map((row) => row.value))
      priceBuckets.forEach((row) => {
        row.width = Math.max(4, Math.round((row.value / maxPrice) * 100))
      })

      const byDistrict = (raw.byDistrict || []).map((row) => {
        const bank = Number(row.bank || 0)
        const community = Number(row.community || 0)
        return {
          label: row.label,
          bank,
          community,
          bankText: formatNumber(bank),
          communityText: formatNumber(community),
        }
      })
      const maxDistrict = Math.max(
        1,
        ...byDistrict.map((row) => Math.max(row.bank, row.community)),
      )
      byDistrict.forEach((row) => {
        row.bankWidth = Math.max(2, Math.round((row.bank / maxDistrict) * 100))
        row.communityWidth = Math.max(2, Math.round((row.community / maxDistrict) * 100))
      })

      const gridTop = (raw.gridTop || []).map((row) => ({
        label: row.label,
        value: formatNumber(row.value || 0),
        rawValue: Number(row.value || 0),
        lng: row.lng,
        lat: row.lat,
      }))

      this.setData({
        loading: false,
        stats: raw,
        cards: [
          {
            label: '银行网点',
            value: formatNumber(raw.branch),
            hint: '含柜台网点',
            tone: 'brand',
          },
          {
            label: 'ATM 自助',
            value: formatNumber(raw.atm),
            hint: '24 小时可用',
            tone: 'mint',
          },
          {
            label: '住宅小区',
            value: formatNumber(raw.community),
            hint: '含村 / 花园 / 新村',
            tone: 'amber',
          },
          {
            label: '覆盖区域',
            value: formatNumber(raw.districts),
            hint: '有数据的行政区',
            tone: 'ink',
          },
        ],
        brands,
        priceBuckets,
        byDistrict,
        gridTop,
      })
    } catch (error) {
      this.setData({ loading: false, error: error.message || '统计加载失败' })
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  setType(e) {
    this.setData({ type: e.currentTarget.dataset.type })
  },

  onDistrictChange(e) {
    const index = Number(e.detail.value)
    this.setData({ districtIndex: index, district: this.data.districts[index] })
  },

  goSearch() {
    const keyword = this.data.keyword.trim()
    if (!keyword && this.data.district === '全部区域') {
      wx.showToast({ title: '请输入关键词或选择区域', icon: 'none' })
      return
    }
    trackQuery(
      keyword,
      this.data.district === '全部区域' ? '' : this.data.district,
      this.data.type === 'all' ? ['bank', 'community'] : [this.data.type],
    )
    this.goListWith({
      keyword,
      district: this.data.district === '全部区域' ? '' : this.data.district,
      type: this.data.type,
    })
  },

  searchBrand(e) {
    this.goListWith({
      keyword: e.currentTarget.dataset.brand,
      district: '',
      type: 'bank',
    })
  },

  goListWith(query) {
    try {
      wx.setStorageSync('poi_list_query', query)
    } catch (e) {
      // ignore
    }
    wx.switchTab({ url: '/pages/list/list' })
  },

  openPending() {
    wx.navigateTo({ url: '/pages/pending/pending' })
  },

  openHotspots() {
    wx.navigateTo({ url: '/pages/hotspots/hotspots' })
  },

  openLand() {
    wx.navigateTo({ url: '/pages/land/land' })
  },

  retry() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  onShareAppMessage() {
    return {
      title: '邻域 POI · 深圳银行与小区数据洞察',
      path: '/pages/stats/stats',
    }
  },
})
