const { get } = require('../../utils/api')

/**
 * 查询热点：消费公开接口 /hotspots（query_log 聚合的近 7 天热门网格）。
 *
 * 与 Web 洞察页同一个数据源；热点是「用户搜了什么 → 采集优先补哪里」的对外可见半环，
 * 之前只有运营后台能看到。
 */
Page({
  data: {
    loading: true,
    error: '',
    items: [],
    totalQueries: 0,
    totalText: '0',
    limit: 20,
  },

  onLoad() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const data = await get('/hotspots', { limit: this.data.limit })
      const items = (data.items || []).map((row, index) => {
        const grid = String(row.grid || '')
        const [lng, lat] = grid.split(',')
        return {
          rank: index + 1,
          grid,
          lng: lng || '',
          lat: lat || '',
          queryCount: Number(row.queryCount || 0),
          zeroResultCount: Number(row.zeroResultCount || 0),
          hasZero: Number(row.zeroResultCount || 0) > 0,
          lastDate: row.lastDate || '',
        }
      })
      const total = Number(data.totalQueries || 0)
      this.setData({
        items,
        totalQueries: total,
        totalText: total.toLocaleString ? total.toLocaleString() : String(total),
        loading: false,
      })
    } catch (err) {
      this.setData({ loading: false, error: err && err.message ? err.message : '热点加载失败' })
    }
  },

  /** 点一条看详情：给出网格坐标与空结果提示，可复制坐标去地图定位 */
  onTapItem(e) {
    const item = this.data.items[e.currentTarget.dataset.index]
    if (!item) return
    const lines = [
      '网格：' + item.grid,
      '查询次数：' + item.queryCount,
      '空结果：' + item.zeroResultCount + ' 次',
    ]
    if (item.lastDate) lines.push('最近统计日：' + item.lastDate)
    if (item.hasZero) lines.push('提示：该区域有查询未命中，可作为采集优先级参考')
    wx.showModal({
      title: '第 ' + item.rank + ' 名 · 查询热点',
      content: lines.join('\n'),
      confirmText: '复制坐标',
      cancelText: '关闭',
      success: (res) => {
        if (res.confirm && item.grid) {
          wx.setClipboardData({ data: item.grid })
        }
      },
    })
  },

  retry() {
    this.load()
  },
})
