function openLocation(poi) {
  if (!poi) return
  const lng = Number(poi.gcjLng)
  const lat = Number(poi.gcjLat)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    wx.showToast({ title: '该点位缺少地图坐标', icon: 'none' })
    return
  }
  wx.openLocation({
    longitude: lng,
    latitude: lat,
    name: poi.name || '点位',
    address: poi.address || '',
    scale: 18,
  })
}

function callPhone(phone) {
  if (!phone) return
  wx.makePhoneCall({ phoneNumber: String(phone) })
}

function copyText(text, tip) {
  if (!text) return
  wx.setClipboardData({
    data: String(text),
    success() {
      wx.showToast({ title: tip || '已复制', icon: 'none' })
    },
  })
}

module.exports = {
  openLocation,
  callPhone,
  copyText,
}
