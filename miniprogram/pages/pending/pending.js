const { get, post } = require('../../utils/api')
const { normalizePending } = require('../../utils/poi')
const { gcj02ToWgs84, isInShenzhen } = require('../../utils/coord')
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

const PAGE_SIZE = 20

Page({
  data: {
    districts: DISTRICTS,
    districtIndex: 0,
    district: '全部区域',
    keyword: '',
    items: [],
    skeletons: [1, 2, 3],
    total: 0,
    totalText: '0',
    page: 1,
    loading: true,
    loadingMore: false,
    hasMore: false,
    error: '',
    submittingId: '',
  },

  onLoad() {
    this.fetch(true)
  },

  async fetch(reset) {
    if (this.loadingRequest && !reset) return
    this.loadingRequest = true
    const page = reset ? 1 : this.data.page
    this.setData({
      loading: reset,
      loadingMore: !reset,
      error: reset ? '' : this.data.error,
    })
    try {
      const data = await get('/community-pending', {
        page,
        size: PAGE_SIZE,
        keyword: this.data.keyword.trim(),
        district: this.data.district === '全部区域' ? '' : this.data.district,
      })
      const rows = (data.items || []).map((row) => {
        const item = normalizePending(row)
        return Object.assign(item, {
          shortId: item.id.length > 10 ? item.id.slice(-10) : item.id,
          isSubmitted: false,
        })
      })
      const items = reset ? rows : this.data.items.concat(rows)
      const total = Number(data.total || rows.length)
      this.setData({
        items,
        total,
        totalText: formatNumber(total),
        page: page + 1,
        loading: false,
        loadingMore: false,
        hasMore: items.length < total,
      })
    } catch (error) {
      this.setData({
        loading: false,
        loadingMore: false,
        error: error.message || '待定位小区加载失败',
      })
    } finally {
      this.loadingRequest = false
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    this.fetch(true)
  },

  onDistrictChange(e) {
    const index = Number(e.detail.value)
    this.setData({ districtIndex: index, district: this.data.districts[index] })
    this.fetch(true)
  },

  chooseCoordinate(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.items.find((row) => row.id === id)
    if (!item || this.data.submittingId) return
    wx.chooseLocation({
      success: (res) => {
        const wgs = gcj02ToWgs84(res.longitude, res.latitude)
        if (!isInShenzhen(wgs.lng, wgs.lat)) {
          wx.showToast({ title: '请选择深圳范围内的位置', icon: 'none' })
          return
        }
        wx.showModal({
          title: '确认提交坐标？',
          content:
            (res.name || item.name) +
            '\nWGS-84：' +
            wgs.lng.toFixed(5) +
            ', ' +
            wgs.lat.toFixed(5),
          confirmText: '提交',
          success: (modal) => {
            if (!modal.confirm) return
            this.submitCoordinate(item, wgs, res)
          },
        })
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        if (msg.indexOf('auth deny') >= 0 || msg.indexOf('authorize') >= 0) {
          wx.showModal({
            title: '需要位置权限',
            content: '请在设置中允许使用位置信息，或在地图上手动选择。',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) wx.openSetting()
            },
          })
          return
        }
        if (msg.indexOf('cancel') < 0) {
          wx.showToast({ title: '未能打开地图选点', icon: 'none' })
        }
      },
    })
  },

  async submitCoordinate(item, wgs, location) {
    this.setData({ submittingId: item.id })
    try {
      await post('/community-pending/' + encodeURIComponent(item.id) + '/locate', {
        lng: wgs.lng,
        lat: wgs.lat,
        note: '小程序实地确认：' + (location.name || item.name),
      })
      const items = this.data.items.map((row) =>
        row.id === item.id ? Object.assign({}, row, { isSubmitted: true }) : row,
      )
      this.setData({ items, submittingId: '' })
      wx.showModal({
        title: '已提交，等待核实',
        content: '运营审核通过后，该小区会出现在地图与列表中。',
        showCancel: false,
        confirmText: '知道了',
      })
    } catch (error) {
      this.setData({ submittingId: '' })
      wx.showToast({ title: error.message || '提交失败', icon: 'none' })
    }
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore && !this.data.loading) {
      this.fetch(false)
    }
  },

  onPullDownRefresh() {
    this.fetch(true).finally(() => wx.stopPullDownRefresh())
  },
})
