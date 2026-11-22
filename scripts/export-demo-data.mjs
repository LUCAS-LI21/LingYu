/**
 * 导出静态演示数据（给 GitHub Pages 用）。
 *
 * Pages 只能托管静态文件，跑不了 Spring Boot；把本地后端的三份聚合结果导出成 JSON，
 * 构建时带上 VITE_DEMO_DATA=1，前端就会直接读这些文件——评委能看到全量真实数据，
 * 只是不能写（反馈/后台仍需后端，走 Codespaces）。
 *
 * 用法：先启动本机后端（8080），执行 node scripts/export-demo-data.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = process.env.API_BASE || 'http://127.0.0.1:8080'
const OUT = 'public/demo-data'

async function getJson(path) {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`)
  const body = await res.json()
  if (body.code !== 0) throw new Error(`${path} -> ${body.message}`)
  return body.data
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const [pois, stats, hotspots] = await Promise.all([
    getJson('/api/v1/pois?size=20000&lite=true'),
    getJson('/api/v1/stats'),
    getJson('/api/v1/hotspots?limit=8'),
  ])
  writeFileSync(join(OUT, 'pois.json'), JSON.stringify(pois), 'utf8')
  writeFileSync(join(OUT, 'stats.json'), JSON.stringify(stats), 'utf8')
  writeFileSync(join(OUT, 'hotspots.json'), JSON.stringify(hotspots), 'utf8')
  console.log(`导出完成：pois=${pois.items?.length ?? 0} 条，stats/hotspots 各 1 份`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
