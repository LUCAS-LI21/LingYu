/**
 * 银行官网数据导入客户端（供各银行适配器复用）。
 *
 * 统一走 /api/v1/admin/import，保证：
 * - 写入 source / license（可溯源）
 * - 按「同名 + 165m」去重
 * - 变更写 poi_version
 *
 * 用法：
 *   import { importRows } from './lib/import-client.mjs'
 *   await importRows({ source: '中国建设银行官网', rows: [...], type: 'bank' })
 */

const API = process.env.API_BASE || 'http://127.0.0.1:8080'

async function login() {
  const response = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.OPERATOR_USERNAME || 'operator',
      password: process.env.OPERATOR_PASSWORD || 'operator123',
    }),
  })
  const body = await response.json()
  const token = body?.data?.token
  if (!token) throw new Error('登录失败：检查 OPERATOR_USERNAME / OPERATOR_PASSWORD')
  return token
}

/**
 * @param {object} options
 * @param {string} options.source  来源名（会写进 source 列）
 * @param {string} [options.license] 许可说明
 * @param {'bank'|'community'} [options.type]
 * @param {Array<object>} options.rows 每行 {name,address,lng,lat,phone,openingHours,district,brand,branchType}
 * @param {number} [options.batch]
 * @param {boolean} [options.overwrite] 是否覆盖已有非空值（默认 false，只补空）
 * @param {boolean} [options.dryRun]
 */
export async function importRows({
  source,
  license = '公开信息（官网）',
  type = 'bank',
  rows,
  batch = 200,
  overwrite = false,
  dryRun = false,
}) {
  if (dryRun) {
    console.log(`[dry-run] ${rows.length} 行，前 2 行：`, JSON.stringify(rows.slice(0, 2), null, 1))
    return { inserted: 0, updated: 0, skipped: 0, unchanged: 0 }
  }

  const token = await login()
  const totals = { inserted: 0, updated: 0, skipped: 0, unchanged: 0 }

  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch)
    const response = await fetch(`${API}/api/v1/admin/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ source, license, type, overwrite, rows: chunk }),
    })
    const body = await response.json()
    if (body.code !== 0) throw new Error(`导入失败：${body.message}`)
    const d = body.data
    totals.inserted += d.inserted
    totals.updated += d.updated
    totals.skipped += d.skipped
    totals.unchanged += d.unchanged ?? 0
    console.log(
      `[import] 第 ${Math.floor(i / batch) + 1} 批：新增 ${d.inserted} / 更新 ${d.updated} / 未变 ${d.unchanged ?? 0} / 跳过 ${d.skipped}`,
    )
    if (d.errors?.length) console.log('  样例：', d.errors.slice(0, 3).join('；'))
  }

  console.log(
    `[import] 完成：新增 ${totals.inserted}，更新 ${totals.updated}，未变 ${totals.unchanged}，跳过 ${totals.skipped}`,
  )
  return totals
}

export function toNumber(value) {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/** 深圳范围校验，挡住明显错误的坐标 */
export function inShenzhen(lng, lat) {
  return lng >= 113.6 && lng <= 114.7 && lat >= 22.3 && lat <= 22.9
}
