const { get } = require('../../utils/api')
const { normalizeLand } = require('../../utils/poi')
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
    districts: DISTRICTS,
    districtIndex: 0,
    district: '全部区域',
    items: [],
    skeletons: [1, 2, 3],
    total: 0,
    totalText: '0',
    areaText: '0',
    housingTypes: [],
    loading: true,
    error: '',
  },

  onLoad() {
    this.load()
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const data = await get('/land-parcels', {
        district: this.data.district === '全部区域' ? '' : this.data.district,
        limit: 100,
      })
      const items = (data.items || []).map((row) => {
        const item = normalizeLand(row)
        return Object.assign(item, {
          areaText: item.areaHa === null ? '面积待补充' : item.areaHa.toFixed(2) + ' ha',
        })
      })
      const totalArea = items.reduce((sum, item) => sum + (item.areaHa || 0), 0)
      const typeMap = {}
      items.forEach((item) => {
        const key = item.housingType || '未标注'
        typeMap[key] = (typeMap[key] || 0) + 1
      })
      const housingTypes = Object.keys(typeMap)
        .map((label) => ({ label, value: typeMap[label] }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
      this.setData({
        items,
        total: Number(data.total || items.length),
        totalText: formatNumber(data.total || items.length),
        areaText: totalArea.toFixed(1),
        housingTypes,
        loading: false,
      })
    } catch (error) {
      this.setData({ loading: false, error: error.message || '存量用地加载失败' })
    }
  },

  onDistrictChange(e) {
    const index = Number(e.detail.value)
    this.setData({ districtIndex: index, district: this.data.districts[index] })
    this.load()
  },

  refresh() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },
})
