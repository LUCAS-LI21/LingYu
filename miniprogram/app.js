const { get } = require('./utils/api')

App({
  globalData: {
    meta: null,
    systemInfo: null,
    online: false,
  },

  onLaunch() {
    try {
      this.globalData.systemInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    } catch (e) {
      this.globalData.systemInfo = null
    }

    // 启动自检：拿坐标约定与接口清单，失败不影响页面（页面会各自提示）
    get('/meta')
      .then((meta) => {
        this.globalData.meta = meta
        this.globalData.online = true
      })
      .catch(() => {
        this.globalData.online = false
      })
  },
})
