const KEY = 'poi_feedback_history_v1'
const PROFILE_KEY = 'poi_user_profile_v1'

function listFeedback() {
  try {
    const raw = wx.getStorageSync(KEY)
    const rows = raw ? JSON.parse(raw) : []
    return Array.isArray(rows) ? rows : []
  } catch (e) {
    return []
  }
}

function saveFeedback(record) {
  const rows = listFeedback()
  rows.unshift(record)
  try {
    wx.setStorageSync(KEY, JSON.stringify(rows.slice(0, 50)))
  } catch (e) {
    // 存储满时忽略，不影响服务端已受理的结果
  }
  return record
}

function clearFeedback() {
  try {
    wx.removeStorageSync(KEY)
  } catch (e) {
    // ignore
  }
}

function getProfile() {
  try {
    const raw = wx.getStorageSync(PROFILE_KEY)
    const data = raw ? JSON.parse(raw) : {}
    return {
      nickname: data.nickname || '',
      contact: data.contact || '',
    }
  } catch (e) {
    return { nickname: '', contact: '' }
  }
}

function saveProfile(profile) {
  try {
    wx.setStorageSync(
      PROFILE_KEY,
      JSON.stringify({
        nickname: (profile && profile.nickname) || '',
        contact: (profile && profile.contact) || '',
      }),
    )
    return true
  } catch (e) {
    return false
  }
}

module.exports = {
  listFeedback,
  saveFeedback,
  clearFeedback,
  getProfile,
  saveProfile,
}
