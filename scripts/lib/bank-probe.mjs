/**
 * 银行网点接口探针共用工具。
 *
 * 约定：
 * - 只请求目标银行域名；
 * - 所有主动 HTTP 调用走 Pacer，保证相邻请求间隔 >= 1100ms；
 * - Node fetch 遇到老 TLS 站点失败时回退到 scripts/lib/http.mjs 的 curl。
 */
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { curlText } from './http.mjs'

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const OUT_DIR = path.resolve('scripts/probe-out')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 依次请求之间的限速器 */
export class Pacer {
  constructor(ms = 1100) {
    this.ms = ms
    this.last = 0
  }
  async wait() {
    const gap = Date.now() - this.last
    if (gap < this.ms) await sleep(this.ms - gap)
    this.last = Date.now()
  }
}

/** Playwright 自带 headless shell 可能没下载，回退到完整 chromium */
export function findChrome() {
  try {
    const p = chromium.executablePath()
    if (p && fs.existsSync(p) && /chrome\.exe$/i.test(p)) return p
  } catch {
    // 忽略：探测失败按无 robots 处理
  }
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
  if (!fs.existsSync(base)) return undefined
  for (const d of fs
    .readdirSync(base)
    .filter((x) => /^chromium-\d+$/.test(x))
    .sort()
    .reverse()) {
    const p = path.join(base, d, 'chrome-win64', 'chrome.exe')
    if (fs.existsSync(p)) return p
  }
  return undefined
}

/** 启动 headless 浏览器；UA 默认与真实内核版本一致（部分 WAF 会校验） */
export async function launch(options = {}) {
  const browser = await chromium.launch({
    headless: options.headless !== false,
    executablePath: findChrome(),
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const version = browser.version()
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    userAgent:
      options.ua ||
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
    extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
    ignoreHTTPSErrors: true,
  })
  const page = await ctx.newPage()
  return { browser, ctx, page, close: () => browser.close() }
}

/**
 * 只放行目标银行域名；地图 SDK 的 JS 例外（页面初始化必需），
 * 其余第三方请求（瓦片、埋点等）一律阻断。
 */
export async function restrictToBank(ctx, suffix, allowedScriptHosts = []) {
  await ctx.route('**/*', (route) => {
    const req = route.request()
    let host = ''
    let protocol
    try {
      const u = new URL(req.url())
      host = u.hostname
      protocol = u.protocol
    } catch {
      return route.abort()
    }
    // blob:/data: 是页面本地资源（部分 WAF 的 JS 存在 blob 里），不属于外部访问
    if (protocol !== 'http:' && protocol !== 'https:') return route.continue()
    if (host === suffix || host.endsWith(`.${suffix}`)) return route.continue()
    if (req.resourceType() === 'script' && allowedScriptHosts.some((h) => host.endsWith(h))) {
      return route.continue()
    }
    return route.abort()
  })
}

/** 记录 XHR：URL / method / postData / 响应前 600 字符 */
export function recordXhr(page, filter, sink) {
  page.on('response', async (res) => {
    const req = res.request()
    const type = req.resourceType()
    if (!['xhr', 'fetch'].includes(type)) return
    const url = res.url()
    if (filter && !filter(url)) return
    let body = ''
    try {
      body = (await res.text()).slice(0, 600)
    } catch {
      // 忽略：探测失败按无 robots 处理
    }
    sink.push({
      status: res.status(),
      method: req.method(),
      url,
      postData: req.postData() || '',
      body,
    })
  })
}

export function saveJson(name, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, name)
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
  return file
}

/** Node fetch 失败时用 curl 兜底 */
export async function fetchText(url, init = {}) {
  try {
    const r = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init.headers || {}) } })
    const text = await r.text()
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return text
  } catch (err) {
    if (String(err.message).includes('HTTP 4') || String(err.message).includes('HTTP 5')) throw err
    return curlText(url, {
      method: init.method || 'GET',
      headers: init.headers,
      body: init.body,
      referer: init.referer,
    })
  }
}

/** 解析 JSONP：callback({...}) 或 callback({...}); 容忍尾逗号 */
export function parseJsonp(text) {
  const i = text.indexOf('(')
  const j = text.lastIndexOf(')')
  if (i < 0 || j <= i) throw new Error(`不是 JSONP：${text.slice(0, 120)}`)
  const raw = text.slice(i + 1, j)
  try {
    return JSON.parse(raw)
  } catch {
    return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1'))
  }
}

/** 用 curl 取状态码 + 正文（Node fetch 被 WAF/TLS 挡住时兜底） */
export function curlProbe(url, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poi-'))
  const outFile = path.join(dir, 'out.txt')
  const hdrFile = path.join(dir, 'hdr.txt')
  const args = ['-s', '--ssl-no-revoke', '-m', '30', '-A', UA, '-o', outFile, '-D', hdrFile, url]
  if (options.method) args.push('-X', options.method)
  if (options.body !== undefined) args.push('--data-binary', options.body)
  const r = spawnSync('curl.exe', args, { stdio: 'ignore', timeout: 45000 })
  try {
    if (r.error) throw r.error
    const headers = fs.readFileSync(hdrFile, 'utf8')
    const body = fs.readFileSync(outFile, 'utf8')
    const status = Number((headers.match(/HTTP\/[\d.]+ (\d{3})/) || [])[1] || 0)
    return { status, body, headers }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** robots.txt 检查：返回状态码与是否 Disallow 目标路径 */
export async function checkRobots(origin, targetPath) {
  const pacer = new Pacer()
  await pacer.wait()
  const url = `${origin}/robots.txt`
  let status = 0
  let text = ''
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' })
    status = r.status
    text = await r.text()
  } catch {
    try {
      const c = curlProbe(url)
      status = c.status
      text = c.body
    } catch {
      // 忽略：探测失败按无 robots 处理
    }
  }
  const disallowAll = /^\s*Disallow:\s*\/\s*$/im.test(text)
  const disallow = new RegExp(
    `^\\s*Disallow:\\s*${targetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'im',
  ).test(text)
  return { url, status, disallowAll, disallowTarget: disallow, sample: text.slice(0, 200) }
}
