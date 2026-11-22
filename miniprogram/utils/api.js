const { API_BASE, REQUEST_TIMEOUT } = require('../config')

const TOKEN_KEY = 'poi_admin_token'

function getToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY) || ''
  } catch (e) {
    return ''
  }
}

function setToken(token) {
  try {
    if (token) wx.setStorageSync(TOKEN_KEY, token)
    else wx.removeStorageSync(TOKEN_KEY)
  } catch (e) {
    // 存储不可用时仅影响本次会话
  }
}

function clearToken() {
  setToken('')
}

function buildQuery(params) {
  if (!params) return ''
  const parts = []
  Object.keys(params).forEach((key) => {
    const value = params[key]
    if (value === undefined || value === null || value === '') return
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
  })
  return parts.length ? '?' + parts.join('&') : ''
}

function friendlyFail(err) {
  const msg = (err && err.errMsg) || ''
  if (msg.indexOf('timeout') >= 0) {
    return '请求超时，请确认后端已启动（' + API_BASE + '）'
  }
  if (msg.indexOf('domain') >= 0 || msg.indexOf('合法域名') >= 0) {
    return '域名未配置：开发期请在开发者工具勾选「不校验合法域名」'
  }
  return '网络异常，请检查 API 地址或后端服务'
}

/** 统一请求封装：code !== 0 时 reject。 */
function request(path, options) {
  const opts = options || {}
  const token = getToken()
  const header = Object.assign(
    { 'Content-Type': 'application/json' },
    token ? { Authorization: 'Bearer ' + token } : {},
    opts.header || {},
  )

  if (opts.loading) wx.showLoading({ title: '加载中', mask: true })

  return new Promise((resolve, reject) => {
    wx.request({
      url: API_BASE + '/api/v1' + path,
      method: opts.method || 'GET',
      data: opts.data,
      header,
      timeout: REQUEST_TIMEOUT,
      success(res) {
        const body = res.data || {}
        if (res.statusCode === 401) {
          clearToken()
          reject(new Error('未登录或登录已过期'))
          return
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(body.message || '请求失败（HTTP ' + res.statusCode + '）'))
          return
        }
        if (!body || body.code !== 0) {
          reject(new Error((body && body.message) || '业务处理失败'))
          return
        }
        resolve(body.data)
      },
      fail(err) {
        reject(new Error(friendlyFail(err)))
      },
      complete() {
        if (opts.loading) wx.hideLoading()
      },
    })
  })
}

function get(path, params, options) {
  return request(path + buildQuery(params), Object.assign({}, options, { method: 'GET' }))
}

function post(path, data, options) {
  return request(path, Object.assign({}, options, { method: 'POST', data: data || {} }))
}

/** 记录查询行为，失败不影响主流程。 */
function trackQuery(keyword, district, types) {
  const params = {
    size: 1,
    types: Array.isArray(types) && types.length ? types.join(',') : '',
    keyword: keyword || '',
    district: district || '',
  }
  get('/pois', params).catch(() => {})
}

module.exports = {
  request,
  get,
  post,
  buildQuery,
  getToken,
  setToken,
  clearToken,
  trackQuery,
}
