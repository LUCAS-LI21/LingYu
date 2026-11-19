Page({
  onLoad() {
    // 组件加载异常时也能进入首页，避免停在开场页
    this.fallback = setTimeout(() => this.finish(), 2600)
  },

  onUnload() {
    if (this.fallback) clearTimeout(this.fallback)
  },

  finish() {
    if (this.finished) return
    this.finished = true
    if (this.fallback) clearTimeout(this.fallback)
    wx.reLaunch({ url: '/pages/map/map' })
  },
})
