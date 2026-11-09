/**
 * 用系统 curl 发请求的兜底方案。
 *
 * 为什么需要：部分银行站点仍在用「不安全的重协商」，Node/undici 的 OpenSSL 会直接拒绝
 * （ERR_SSL_UNSAFE_LEGACY_RENEGOTIATION_DISABLED），而 Windows 的 curl（schannel）能正常握手。
 *
 * 注意：沙箱限制 Node 捕获子进程管道，因此 curl 输出重定向到文件再读。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

/**
 * @param {string} url
 * @param {{method?: string, headers?: Record<string,string>, body?: string, referer?: string}} options
 */
export function curlJson(url, options = {}) {
  const text = curlText(url, options)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`返回非 JSON：${text.slice(0, 120)}`)
  }
}

/** 返回原始文本（JSONP、HTML 等用） */
export function curlText(url, options = {}) {
  const { method = 'GET', headers = {}, body, referer } = options
  const dir = mkdtempSync(join(tmpdir(), 'poi-'))
  const outFile = join(dir, 'out.txt')
  const bodyFile = join(dir, 'body.txt')
  const args = ['-s', '--ssl-no-revoke', '-m', '40', '-o', outFile, '-X', method, url]
  args.push('-H', `User-Agent: ${UA}`)
  if (referer) args.push('-H', `Referer: ${referer}`)
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`)
  if (body !== undefined) {
    writeFileSync(bodyFile, body, 'utf8')
    args.push('--data-binary', `@${bodyFile}`)
  }

  const result = spawnSync('curl.exe', args, { stdio: 'ignore', timeout: 60000 })
  try {
    if (result.error) throw result.error
    return readFileSync(outFile, 'utf8')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export { UA }
