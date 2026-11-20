Component({
  data: {
    leaving: false,
    particles: [
      { left: 8, top: 22, size: 7, delay: 0 },
      { left: 16, top: 68, size: 5, delay: 160 },
      { left: 24, top: 40, size: 9, delay: 320 },
      { left: 31, top: 80, size: 6, delay: 80 },
      { left: 38, top: 18, size: 4, delay: 240 },
      { left: 44, top: 58, size: 8, delay: 400 },
      { left: 51, top: 32, size: 5, delay: 120 },
      { left: 58, top: 74, size: 7, delay: 280 },
      { left: 64, top: 24, size: 6, delay: 40 },
      { left: 71, top: 50, size: 4, delay: 360 },
      { left: 78, top: 30, size: 8, delay: 200 },
      { left: 86, top: 64, size: 5, delay: 440 },
      { left: 92, top: 38, size: 6, delay: 100 },
      { left: 13, top: 48, size: 4, delay: 300 },
      { left: 28, top: 14, size: 6, delay: 220 },
      { left: 46, top: 86, size: 5, delay: 60 },
      { left: 69, top: 86, size: 4, delay: 380 },
      { left: 83, top: 12, size: 5, delay: 140 },
    ],
  },

  lifetimes: {
    attached() {
      this.timer = setTimeout(() => this.finish(), 1700)
    },
    detached() {
      if (this.timer) clearTimeout(this.timer)
      if (this.doneTimer) clearTimeout(this.doneTimer)
    },
  },

  methods: {
    skip() {
      this.finish()
    },

    finish() {
      if (this.finished) return
      this.finished = true
      if (this.timer) clearTimeout(this.timer)
      this.setData({ leaving: true })
      this.doneTimer = setTimeout(() => {
        this.triggerEvent('done')
      }, 220)
    },
  },
})
