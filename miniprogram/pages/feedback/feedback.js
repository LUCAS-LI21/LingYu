const { get, post } = require('../../utils/api')
const { normalizePoiList } = require('../../utils/poi')
const { getProfile, saveFeedback } = require('../../utils/feedback-store')
const { formatDate } = require('../../utils/format')

Page({
  data: {
    keyword: '',
    searching: false,
    searchTouched: false,
    results: [],
    selected: null,
    type: 'error',
    typeOptions: [
      { value: 'error', label: '信息有误', hint: '字段写错了，提交正确值' },
      { value: 'closed', label: '已关闭', hint: '网点或小区已不存在' },
      { value: 'add', label: '补充 / 新增', hint: '缺失信息，需要重新采集' },
    ],
    field: '地址',
    fieldOptions: ['地址', '电话', '营业时间', '名称'],
    newValue: '',
    description: '',
    contact: '',
    submitting: false,
    canSubmit: false,
    record: null,
    historyCount: 0,
  },

  onLoad(options) {
    const profile = getProfile()
    this.setData({ contact: profile.contact || '' })
    if (options.poiId) {
      this.prefillPoi(decodeURIComponent(options.poiId), options.poiName, options.poiType)
    }
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
  },

  async prefillPoi(id, name, type) {
    try {
      const poi = normalizePoiList([await get('/pois/' + encodeURIComponent(id))])[0]
      if (poi) this.selectPoiData(poi)
    } catch (e) {
      if (name) {
        this.setData({
          selected: {
            id,
            name: decodeURIComponent(name),
            type: type === 'community' ? 'community' : 'bank',
            address: '',
            district: '',
          },
        })
        this.syncFields()
      }
    }
  },

  onKeywordInput(e) {
    const keyword = e.detail.value
    this.setData({ keyword })
    if (this.searchTimer) clearTimeout(this.searchTimer)
    if (!keyword.trim()) {
      this.setData({ results: [], searching: false })
      return
    }
    this.setData({ searching: true })
    this.searchTimer = setTimeout(() => this.search(keyword.trim()), 260)
  },

  async search(term) {
    try {
      const data = await get('/pois', { keyword: term, size: 8, types: 'bank,community' })
      this.setData({
        results: normalizePoiList(data.items),
        searching: false,
        searchTouched: true,
      })
    } catch (e) {
      this.setData({ results: [], searching: false, searchTouched: true })
    }
  },

  onSelectPoi(e) {
    const index = Number(e.currentTarget.dataset.index)
    const poi = this.data.results[index]
    if (poi) this.selectPoiData(poi)
  },

  selectPoiData(poi) {
    this.setData({
      selected: poi,
      results: [],
      keyword: '',
      searchTouched: false,
    })
    this.syncFields(poi)
  },

  clearPoi() {
    this.setData({
      selected: null,
      results: [],
      field: '地址',
      fieldOptions: ['地址', '电话', '营业时间', '名称'],
    })
    this.updateCanSubmit()
  },

  syncFields(poiArg) {
    const poi = poiArg || this.data.selected
    const fieldOptions =
      poi && poi.type === 'community'
        ? ['地址', '建成年份', '均价', '物业费', '名称']
        : ['地址', '电话', '营业时间', '名称']
    const field = fieldOptions.indexOf(this.data.field) >= 0 ? this.data.field : '地址'
    this.setData({ fieldOptions, field })
    this.updateCanSubmit(poi)
  },

  onTypeChange(e) {
    this.setData({ type: e.currentTarget.dataset.value })
  },

  onFieldChange(e) {
    const field = this.data.fieldOptions[Number(e.detail.value)]
    this.setData({ field })
    this.updateCanSubmit()
  },

  onNewValue(e) {
    this.setData({ newValue: e.detail.value })
  },

  onDescription(e) {
    this.setData({ description: e.detail.value })
    this.updateCanSubmit()
  },

  onContact(e) {
    this.setData({ contact: e.detail.value })
  },

  updateCanSubmit(poiArg) {
    const poi = poiArg || this.data.selected
    this.setData({
      canSubmit: Boolean(poi && this.data.field && this.data.description.trim().length > 0),
    })
  },

  async submit() {
    if (!this.data.selected) {
      wx.showToast({ title: '请先选择点位', icon: 'none' })
      return
    }
    if (!this.data.description.trim()) {
      wx.showToast({ title: '请填写问题说明', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })
    try {
      const poi = this.data.selected
      const result = await post('/feedback', {
        poiType: poi.type,
        poiId: poi.id,
        poiName: poi.name,
        type: this.data.type,
        field: this.data.field,
        newValue: this.data.newValue.trim(),
        description: this.data.description.trim(),
        contact: this.data.contact.trim(),
      })

      const record = saveFeedback({
        code: result.code,
        status: result.status || 'pending',
        poiId: poi.id,
        poiName: poi.name,
        poiType: poi.type,
        type: this.data.type,
        field: this.data.field,
        newValue: this.data.newValue.trim(),
        description: this.data.description.trim(),
        createdAt: formatDate(new Date().toISOString()),
      })
      this.setData({ record, submitting: false })
      wx.showToast({ title: '反馈已提交', icon: 'success' })
    } catch (error) {
      this.setData({ submitting: false })
      wx.showToast({ title: error.message || '提交失败', icon: 'none' })
    }
  },

  resetForm() {
    this.setData({
      record: null,
      selected: null,
      type: 'error',
      field: '地址',
      fieldOptions: ['地址', '电话', '营业时间', '名称'],
      newValue: '',
      description: '',
      keyword: '',
      results: [],
      canSubmit: false,
    })
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' })
  },

  onShareAppMessage() {
    return {
      title: '邻域 · 一起完善银行与小区数据',
      path: '/pages/feedback/feedback',
    }
  },
})
