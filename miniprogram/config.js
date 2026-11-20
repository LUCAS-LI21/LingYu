/**
 * 小程序 API 地址。
 *
 * 开发者工具本机联调：http://127.0.0.1:8080
 * 真机预览：改成电脑的局域网 IP，例如 http://192.168.1.20:8080
 * 上线：必须是 HTTPS 且在小程序后台配置 request 合法域名。
 */
const API_BASE = 'http://127.0.0.1:8080'

const REQUEST_TIMEOUT = 30000
const APP_VERSION = '0.1.0'

module.exports = {
  API_BASE,
  REQUEST_TIMEOUT,
  APP_VERSION,
}
