const { APP_VERSION } = require('../../config')
const { getProfile, saveProfile, listFeedback } = require('../../utils/feedback-store')

Page({
  data: {
    nickname: '',
    contact: '',
    avatarText: '访',
    saved: false,
    feedbackCount: 0,
    pendingCount: 0,
    version: APP_VERSION,
    services: [
      { key: 'feedback', label: '纠错 / 补充', hint: '发现信息不准，告诉我们就好', icon: '修' },
      { key: 'history', label: '我的反馈', hint: '查看提交记录与处理进度', icon: '记' },
      { key: 'compliance', label: '数据说明', hint: '了解数据来自哪里', icon: '源' },
    ],
    explore: [
      { key: 'pending', label: '待定位小区', hint: '帮小区补上地图位置', icon: '定' },
      { key: 'land', label: '存量住宅用地', hint: '查看深圳住宅用地信息', icon: '地' },
      { key: 'hotspots', label: '查询热点', hint: '看看大家最近在找什么', icon: '热' },
    ],
  },

  onShow() {
    const profile = getProfile()
    const history = listFeedback()
    this.setData({
      nickname: profile.nickname,
      contact: profile.contact,
      avatarText: profile.nickname ? profile.nickname.slice(0, 1) : '访',
      feedbackCount: history.length,
      pendingCount: history.filter((item) => item.status === 'pending').length,
    })
  },

  onNickname(e) {
    const nickname = e.detail.value
    this.setData({
      nickname,
      avatarText: nickname.trim() ? nickname.trim().slice(0, 1) : '访',
    })
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
      wx.showToast({ title: '保存失败，请稍后再试', icon: 'none' })
      return
    }
    this.setData({ saved: true })
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => this.setData({ saved: false }), 1800)
  },

  onQuickAction(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'feedback') wx.navigateTo({ url: '/pages/feedback/feedback' })
    else if (key === 'history') wx.navigateTo({ url: '/pages/history/history' })
    else if (key === 'compliance') wx.navigateTo({ url: '/pages/compliance/compliance' })
    else if (key === 'admin') wx.navigateTo({ url: '/pages/admin/admin' })
  },

  onExplore(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'pending') wx.navigateTo({ url: '/pages/pending/pending' })
    else if (key === 'land') wx.navigateTo({ url: '/pages/land/land' })
    else if (key === 'hotspots') wx.navigateTo({ url: '/pages/hotspots/hotspots' })
  },

  goMap() {
    wx.switchTab({ url: '/pages/map/map' })
  },

  goStats() {
    wx.switchTab({ url: '/pages/stats/stats' })
  },

  onShareAppMessage() {
    return {
      title: '邻域 · 深圳银行网点与小区情报',
      path: '/pages/map/map',
    }
  },
})
