/**
 * 完整版演示视频（含后台审核闭环），带中文字幕。
 *
 * 覆盖：开场动画 → 地图（网点/ATM 互斥、点位详情）→ 小区详情（周边银行/实时 ATM/周边配套 L2）
 *       → 列表（完整度排序、品牌轮转、筛选）→ 洞察（KPI/区域/品牌/价格/大家都在搜）
 *       → 用户提交纠错 → 后台登录 → 审核采纳 → Agent 质量巡检
 *
 * 产物：docs/demo/demo-full.webm / demo-full.srt / demo-full.html
 * 用法：node scripts/record-demo-full.mjs（需 8081 前端 + 18080/8080 后端）
 */
import { chromium } from '@playwright/test'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:8081'
const API = process.env.DEMO_API || 'http://127.0.0.1:18080'
const PASSWORD = process.env.OPERATOR_PASSWORD || ''
const OUT = 'docs/demo'
const RAW = join(OUT, 'raw-full')

const captions = []
let startedAt = 0
function mark(text) {
  const now = Date.now() - startedAt
  const last = captions[captions.length - 1]
  // 相邻字幕过近会互相覆盖：用后一条替换前一条，而不是叠在一起
  if (last && now - last.ms < 900) {
    last.text = text
    return
  }
  captions.push({ ms: now, text })
}

function srtTime(ms) {
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0')
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
  const f = String(ms % 1000).padStart(3, '0')
  return `${h}:${m}:${s},${f}`
}

function writeSubtitles(durationMs, name) {
  const lines = []
  captions.forEach((cap, i) => {
    const next = captions[i + 1]?.ms ?? durationMs
    lines.push(String(i + 1))
    lines.push(`${srtTime(cap.ms)} --> ${srtTime(Math.max(cap.ms + 600, next - 120))}`)
    lines.push(cap.text)
    lines.push('')
  })
  writeFileSync(join(OUT, `${name}.srt`), lines.join('\n'), 'utf8')
}

function writePlayer(durationMs, name, title) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const rows = captions.map((c) => `<tr><td>${srtTime(c.ms)}</td><td>${esc(c.text)}</td></tr>`).join('\n')
  writeFileSync(
    join(OUT, `${name}.html`),
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px}
video{width:100%;max-width:1100px;border-radius:12px;background:#000}
table{border-collapse:collapse;margin-top:16px;font-size:13px}td{padding:4px 10px;border-bottom:1px solid #1e293b;color:#cbd5e1}
h1{font-size:18px}</style></head><body><h1>${title}（约 ${Math.round(durationMs / 1000)} 秒）</h1>
<video controls src="${name}.webm"><track kind="subtitles" src="${name}.srt" default></video>
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
  const wait = (ms) => page.waitForTimeout(ms)
  const shot = async (n) => page.screenshot({ path: join(OUT, `${n}.png`) })
  startedAt = Date.now()

  // ---------- 1. 开场 ----------
  mark('邻域 POI · 以小区和银行为基线的智慧数据洞察与服务平台')
  await page.goto(`${BASE}/?intro=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await wait(8500)
  mark('开场动画：从全球数据到深圳本地')
  await shot('full-01-intro')

  // ---------- 2. 地图：网点 / ATM / 详情 ----------
  mark('地图查询：1,506 个银行网点')
  await wait(1800)
  await page.getByRole('button', { name: 'ATM', exact: true }).first().click()
  await wait(2000)
  mark('切到 ATM：368 台自助设备，与网点互斥展示')
  await shot('full-02-atm')
  const pin = page.locator('.poi-pin:visible').first()
  if (await pin.count()) {
    await pin.click({ force: true })
    await page.locator('.leaflet-popup-content').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
    await wait(2400)
    mark('点开任意点位：地址 / 营业时间 / 服务类型 / 数据来源')
    await shot('full-03-pin-detail')
  }
  await page.keyboard.press('Escape').catch(() => {})
  await wait(800)

  // ---------- 3. 小区详情 + 关联查询 + 周边配套 ----------
  mark('切到小区：3,569 个住宅小区')
  await page.getByRole('button', { name: '小区', exact: true }).first().click()
  await wait(1800)
  await page.getByRole('button', { name: '网点', exact: true }).first().click()
  await wait(1200)
  const card = page.getByTestId('poi-card').first()
  if (await card.count()) {
    await card.click()
    await wait(1800)
    mark('小区详情：建成年份 / 成交参考价 / 物业费，字段级来源可查')
    await shot('full-04-community')
  }
  const liveAtm = page.getByTestId('live-around-action')
  if (await liveAtm.isVisible().catch(() => false)) {
    await liveAtm.click()
    await wait(2600)
    mark('1km 内周边银行：库内数据实时排序')
  }
  const fac = page.getByTestId('live-facilities-action')
  if (await fac.isVisible().catch(() => false)) {
    await fac.click()
    await wait(3000)
    mark('周边配套（L2）：学校 / 医院 / 地铁 / 商场，实时查询不落库')
    await shot('full-05-facilities')
  }

  // ---------- 4. 列表：完整度排序 + 品牌轮转 + 筛选 ----------
  mark('列表：默认按数据完整度排序，品牌轮转不霸屏')
  await page.goto(`${BASE}/list`, { waitUntil: 'domcontentloaded' })
  await wait(5000)
  await shot('full-06-list')
  const selects = page.locator('select')
  if ((await selects.count()) >= 2) {
    await selects.nth(1).selectOption({ index: 3 }).catch(() => {})
    await wait(1800)
    mark('按区域/均价/建成年份组合筛选')
  }
  const sortSelect = selects.first()
  if (await sortSelect.count()) {
    await sortSelect.selectOption('priceDesc').catch(() => {})
    await wait(1600)
    mark('排序：完整度 / 均价 / 年份 / 名称')
    await shot('full-07-sort')
  }

  // ---------- 5. 洞察 ----------
  mark('数据洞察：区域分布 / 品牌 / 均价 / 大家都在搜')
  await page.goto(`${BASE}/stats`, { waitUntil: 'domcontentloaded' })
  await wait(5200)
  await shot('full-08-stats')
  await page.evaluate(() => window.scrollTo({ top: 850, behavior: 'smooth' }))
  await wait(2200)
  mark('热门搜索来自真实查询日志，驱动定时抓取优先级')
  await shot('full-09-hotsearch')

  // ---------- 6. 用户提交纠错 ----------
  mark('用户参与：提交纠错，进入审核队列')
  await page.goto(`${BASE}/list`, { waitUntil: 'domcontentloaded' })
  await wait(3200)
  const firstCard = page.getByTestId('poi-card').first()
  let feedbackCode = ''
  if (await firstCard.count()) {
    await firstCard.click()
    await wait(1400)
    const btn = page.getByRole('button', { name: '提交纠错' })
    if (await btn.isVisible().catch(() => false)) {
      await btn.click()
      await wait(1400)
      const desc = page.getByPlaceholder('请描述你看到的情况，例如：该网点已搬迁至对面')
      if (await desc.isVisible().catch(() => false)) {
        const fieldSelect = page.locator('select').last()
        await fieldSelect.selectOption({ index: 1 }).catch(() => {})
        await desc.fill('演示视频：该网点营业时间与官网不一致')
        await page.getByRole('button', { name: '提交反馈' }).click()
        await wait(2600)
        const text = await page.evaluate(() => document.body.innerText)
        feedbackCode = (text.match(/FB\d+/) || [''])[0]
        mark(`提交成功，受理编号 ${feedbackCode || 'FB…'}，可凭编号查进度`)
        await shot('full-10-feedback')
      }
    }
  }

  // ---------- 7. 后台审核采纳 ----------
  mark('运营后台：登录后审核反馈')
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  await wait(2500)
  const pwd = page.locator('input[placeholder="请输入口令"]')
  if (await pwd.isVisible().catch(() => false)) {
    await pwd.fill(PASSWORD)
    await page.getByRole('button', { name: '登录' }).click()
    await wait(2600)
  }
  await page.getByRole('button', { name: /反馈审核/ }).click().catch(() => {})
  await wait(3600)
  mark('审核通过：写主表 + 记录版本 + 字段来源，前台立即生效')
  await shot('full-11-admin-review')
  if (feedbackCode) {
    const row = page.locator('li', { hasText: feedbackCode }).first()
    if (await row.count()) {
      await row.getByRole('button', { name: '采纳生效' }).click().catch(() => {})
      await wait(2800)
      mark('采纳成功：数据版本 +1，地图与列表同步更新')
      await shot('full-12-admin-approved')
    }
  }

  // ---------- 8. Agent 质量巡检 ----------
  mark('数据接入 Agent：来源白名单 + 质量巡检')
  await page.getByRole('button', { name: /Agent/ }).first().click().catch(() => {})
  await wait(3000)
  await shot('full-13-agent')
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await wait(600)

  // ---------- 9. 收尾 ----------
  await page.goto(`${BASE}/list`, { waitUntil: 'domcontentloaded' })
  await wait(2500)
  mark('仓库：github.com/LUCAS-LI21/LingYu · 在线体验：lucas-li21.github.io/LingYu')
  await wait(2200)

  const duration = Date.now() - startedAt
  await context.close()
  await browser.close()

  const raw = await video?.path()
  if (raw) copyFileSync(raw, join(OUT, 'demo-full.webm'))
  writeSubtitles(duration, 'demo-full')
  writePlayer(duration, 'demo-full', '邻域 POI 完整演示')
  console.log(`视频：${join(OUT, 'demo-full.webm')}`)
  console.log(`字幕：${join(OUT, 'demo-full.srt')}（${captions.length} 条）`)
  console.log(`时长：约 ${Math.round(duration / 1000)} 秒`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
