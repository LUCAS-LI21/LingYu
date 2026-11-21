/**
 * 自动录演示视频 + 生成字幕。
 *
 * 依赖：Playwright（已装，自带录屏 ffmpeg）。产物：
 *   docs/demo/demo.webm   视频
 *   docs/demo/demo.srt    字幕（中文，按步骤时间轴）
 *   docs/demo/player.html 播放页（视频 + 字幕轨）
 *
 * 用法：
 *   1) 先确保 http://127.0.0.1:8081 可访问（docker compose up -d）
 *   2) node scripts/record-demo.mjs
 */
import { chromium } from '@playwright/test'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:8081'
const OUT = 'docs/demo'
const RAW = join(OUT, 'raw')

const captions = []
let startedAt = 0

function mark(text) {
  captions.push({ ms: Date.now() - startedAt, text })
}

function srtTime(ms) {
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0')
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
  const f = String(ms % 1000).padStart(3, '0')
  return `${h}:${m}:${s},${f}`
}

function writeSubtitles(durationMs) {
  const lines = []
  captions.forEach((cap, i) => {
    const next = captions[i + 1]?.ms ?? durationMs
    lines.push(String(i + 1))
    lines.push(`${srtTime(cap.ms)} --> ${srtTime(Math.max(cap.ms + 500, next - 100))}`)
    lines.push(cap.text)
    lines.push('')
  })
  writeFileSync(join(OUT, 'demo.srt'), lines.join('\n'), 'utf8')
}

function writePlayer(durationMs) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const rows = captions
    .map((c) => `<tr><td>${srtTime(c.ms)}</td><td>${esc(c.text)}</td></tr>`)
    .join('\n')
  writeFileSync(
    join(OUT, 'player.html'),
    `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>邻域 POI 演示</title>
<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px}
video{width:100%;max-width:1100px;border-radius:12px;background:#000}
table{border-collapse:collapse;margin-top:16px;font-size:13px}td{padding:4px 10px;border-bottom:1px solid #1e293b;color:#cbd5e1}
h1{font-size:18px}</style></head>
<body><h1>邻域 POI · 演示视频（约 ${Math.round(durationMs / 1000)} 秒）</h1>
<video controls src="demo.webm"><track kind="subtitles" src="demo.srt" default></video>
<table>${rows}</table></body></html>`,
    'utf8',
  )
}

async function main() {
  rmSync(RAW, { recursive: true, force: true })
  mkdirSync(RAW, { recursive: true })

  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: RAW, size: { width: 1280, height: 720 } },
  })
  const page = await context.newPage()
  const video = page.video()

  const shot = async (name) => page.screenshot({ path: join(OUT, `${name}.png`) })
  const wait = (ms) => page.waitForTimeout(ms)

  startedAt = Date.now()

  // 1) 开场动画
  mark('邻域 POI · 深圳银行网点与小区情报系统')
  await page.goto(`${BASE}/?intro=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await wait(9000)
  mark('开场动画：从全球数据到深圳本地')
  await shot('01-intro')

  // 2) 地图 + ATM 互斥
  mark('地图查询：银行网点 1,491 个')
  await wait(2500)
  await page.getByRole('button', { name: 'ATM', exact: true }).first().click()
  await wait(2000)
  mark('ATM 与网点互斥展示，368 台自助设备')
  await shot('02-map-atm')

  // 3) 点一个 ATM 点位
  const pin = page.locator('.poi-pin').first()
  if (await pin.count()) {
    await pin.click({ force: true })
    await wait(1800)
    mark('点开点位：地址 / 营业时间 / 数据来源')
    await shot('03-detail-atm')
  }

  // 4) 小区 + 周边配套
  mark('小区：3,569 个，支持按完整度排序')
  await page.getByRole('button', { name: '小区', exact: true }).first().click()
  await wait(2200)
  await page.getByRole('button', { name: '网点', exact: true }).first().click()
  await wait(1500)
  const card = page.getByTestId('poi-card').first()
  if (await card.count()) {
    await card.click()
    await wait(1600)
    mark('小区详情：建成年份 / 成交参考价 / 物业费')
    await shot('04-detail-community')
    const fac = page.getByTestId('live-facilities-action')
    if (await fac.isVisible().catch(() => false)) {
      await fac.click()
      await wait(3000)
      mark('周边配套（L2）：学校 / 医院 / 地铁 / 商场，不落库')
      await shot('05-facilities')
    }
  }

  // 5) 列表页
  mark('列表：默认按数据完整度排序，品牌轮转')
  await page.goto(`${BASE}/list`, { waitUntil: 'domcontentloaded' })
  await wait(3500)
  await shot('06-list')
  const sortSelect = page.locator('select').first()
  if (await sortSelect.count()) {
    await sortSelect.selectOption('priceDesc').catch(() => {})
    await wait(1800)
    mark('排序：数据完整度 / 均价 / 年份 / 名称')
    await shot('07-list-sort')
  }

  // 6) 洞察
  mark('数据洞察：品牌分布 / 价格分布 / 分区对比')
  await page.goto(`${BASE}/stats`, { waitUntil: 'domcontentloaded' })
  await wait(3500)
  await shot('08-stats')
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }),
  )
  await wait(1800)
  mark('用户查询热点：query_log → hot_region，驱动定时重抓')
  await shot('09-hotspots')

  // 7) 反馈闭环
  mark('用户纠错：提交后进入审核队列')
  await page.goto(`${BASE}/list`, { waitUntil: 'domcontentloaded' })
  await wait(3000)
  const firstCard = page.getByTestId('poi-card').first()
  if (await firstCard.count()) {
    await firstCard.click()
    await wait(1200)
    const btn = page.getByRole('button', { name: '提交纠错' })
    if (await btn.isVisible().catch(() => false)) {
      await btn.click()
      await wait(1200)
      const desc = page.getByPlaceholder('请描述你看到的情况，例如：该网点已搬迁至对面')
      if (await desc.isVisible().catch(() => false)) {
        await desc.fill('演示视频：该网点已搬迁至对面')
        await page.getByRole('button', { name: '提交反馈' }).click()
        await wait(2200)
        mark('拿到受理编号，可凭编号查询处理进度')
        await shot('10-feedback')
      }
    }
  }

  await wait(1500)
  const duration = Date.now() - startedAt
  await context.close()
  await browser.close()

  const raw = await video?.path()
  if (raw) {
    copyFileSync(raw, join(OUT, 'demo.webm'))
  }
  writeSubtitles(duration)
  writePlayer(duration)
  console.log(`视频：${join(OUT, 'demo.webm')}`)
  console.log(`字幕：${join(OUT, 'demo.srt')}（${captions.length} 条）`)
  console.log(`时长：约 ${Math.round(duration / 1000)} 秒`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
