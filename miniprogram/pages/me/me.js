const { APP_VERSION, API_BASE } = require('../../config')
const { getProfile, saveProfile, listFeedback } = require('../../utils/feedback-store')

Page({
  data: {
    nickname: '',
    contact: '',
    saved: false,
    feedbackCount: 0,
    pendingCount: 0,
    version: APP_VERSION,
    apiBase: API_BASE,
    quickActions: [
      { key: 'feedback', label: '纠错 / 补充', hint: '提交后会进审核队列', icon: '修' },
      { key: 'history', label: '我的反馈', hint: '查看本机提交记录', icon: '记' },
      { key: 'compliance', label: '数据说明', hint: '来源、坐标与合规', icon: '源' },
      { key: 'admin', label: '管理后台', hint: '运营登录后可审核', icon: '管' },
    ],
    dataLinks: [
      { key: 'pending', label: '待定位小区', hint: '有地址、缺坐标，可实地确认', icon: '待' },
      { key: 'land', label: '存量住宅用地', hint: '政府开放数据 · 宗地级', icon: '地' },
    ],
  },

  onShow() {
    const profile = getProfile()
    const history = listFeedback()
    this.setData({
      nickname: profile.nickname,
      contact: profile.contact,
      feedbackCount: history.length,
      pendingCount: history.filter((item) => item.status === 'pending').length,
    })
  },

  onNickname(e) {
    this.setData({ nickname: e.detail.value })
  },

  onContact(e) {
    this.setData({ contact: e.detail.value })
  },

  saveProfile() {
    const ok = saveProfile({
      nickname: this.data.nickname.trim(),
      contact: this.data.contact.trim(),
    })
    if (!ok) {
      wx.showToast({ title: '存储不可用，未保存', icon: 'none' })
      return
    }
    this.setData({ saved: true })
    wx.showToast({ title: '本机档案已保存', icon: 'success' })
    setTimeout(() => this.setData({ saved: false }), 1800)
  },

  onQuickAction(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'feedback') wx.navigateTo({ url: '/pages/feedback/feedback' })
    else if (key === 'history') wx.navigateTo({ url: '/pages/history/history' })
    else if (key === 'compliance') wx.navigateTo({ url: '/pages/compliance/compliance' })
    else if (key === 'admin') wx.navigateTo({ url: '/pages/admin/admin' })
  },

  onDataLink(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'pending') wx.navigateTo({ url: '/pages/pending/pending' })
    else if (key === 'land') wx.navigateTo({ url: '/pages/land/land' })
  },

  goMap() {
    wx.switchTab({ url: '/pages/map/map' })
  },

  goStats() {
    wx.switchTab({ url: '/pages/stats/stats' })
  },

  onShareAppMessage() {
    return {
      title: '邻域 POI · 深圳银行网点与小区情报',
      path: '/pages/map/map',
    }
  },
})
