const { listFeedback, clearFeedback } = require('../../utils/feedback-store')
const { FEEDBACK_STATUS, FEEDBACK_TYPES } = require('../../utils/format')

Page({
  data: {
    items: [],
    hasItems: false,
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const rows = listFeedback().map((row) => ({
      code: row.code || '—',
      poiName: row.poiName || '点位',
      typeLabel: FEEDBACK_TYPES[row.type] || '反馈',
      field: row.field || '—',
      description: row.description || '',
      createdAt: row.createdAt || '—',
      status: row.status || 'pending',
      statusLabel: FEEDBACK_STATUS[row.status] || '待审核',
      statusClass:
        row.status === 'approved' || row.status === 'auto_applied'
          ? 'status-mint'
          : row.status === 'rejected'
            ? 'status-red'
            : row.status === 'need_refetch'
              ? 'status-brand'
              : 'status-amber',
    }))
    this.setData({ items: rows, hasItems: rows.length > 0 })
  },

  clearAll() {
    wx.showModal({
      title: '清除本机记录？',
      content: '只会清除本机缓存，服务端审核记录不受影响。',
      confirmText: '清除',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return
        clearFeedback()
        this.refresh()
        wx.showToast({ title: '已清除', icon: 'none' })
      },
    })
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' })
  },
})
