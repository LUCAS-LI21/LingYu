<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

interface LandData {
  source: string
  polygons: number[][][]
}

interface Particle {
  sx: number
  sy: number
  tx: number
  ty: number
  delay: number
  size: number
  color: string
  phase: number
}

interface Star {
  x: number
  y: number
  r: number
  phase: number
}

const emit = defineEmits<{
  (e: 'formed'): void
  (e: 'done'): void
  (e: 'skip'): void
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const fading = ref(false)

const FORM_MS = 1300
const HOLD_MS = 500
const ZOOM_MS = 1000
const FADE_MS = 340
const TOTAL_MS = FORM_MS + HOLD_MS + ZOOM_MS + FADE_MS
const ZOOM_START = FORM_MS + HOLD_MS

const FOCUS_LNG = 114.0579
const FOCUS_LAT = 22.5412

let raf = 0
let started = 0
let formed = false
let finished = false
let ctx: CanvasRenderingContext2D | null = null
let width = 0
let height = 0
let dpr = 1
let focusX = 0
let focusY = 0
let land: LandData | null = null
let particles: Particle[] = []
let links: Array<[number, number]> = []
let stars: Star[] = []

const COLORS = ['#7dd3fc', '#60a5fa', '#a5f3fc', '#e0f2fe', '#93c5fd']

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3
}

function setupCanvas(): void {
  const element = canvas.value
  if (!element) return
  width = window.innerWidth
  height = window.innerHeight
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  element.width = Math.round(width * dpr)
  element.height = Math.round(height * dpr)
  ctx = element.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function buildLandMask(): Array<{ x: number; y: number }> {
  if (!land) return []
  const maskW = 720
  const maskH = 360
  const offscreen = document.createElement('canvas')
  offscreen.width = maskW
  offscreen.height = maskH
  const maskCtx = offscreen.getContext('2d')
  if (!maskCtx) return []
  maskCtx.fillStyle = '#fff'
  for (const ring of land.polygons) {
    maskCtx.beginPath()
    ring.forEach(([lng, lat], index) => {
      const x = ((lng + 180) / 360) * maskW
      const y = ((90 - lat) / 180) * maskH
      if (index === 0) maskCtx.moveTo(x, y)
      else maskCtx.lineTo(x, y)
    })
    maskCtx.closePath()
    maskCtx.fill()
  }

  const pixels = maskCtx.getImageData(0, 0, maskW, maskH).data
  const candidates: Array<{ x: number; y: number }> = []
  for (let y = 1; y < maskH; y += 2) {
    for (let x = 1; x < maskW; x += 2) {
      if (pixels[(y * maskW + x) * 4 + 3] > 120) candidates.push({ x, y })
    }
  }
  return candidates
}

function buildScene(): void {
  setupCanvas()
  if (!ctx) return

  const maskW = 720
  const maskH = 360
  const worldW = Math.min(width * 0.9, height * 0.62 * 2)
  const worldH = worldW / 2
  const offsetX = (width - worldW) / 2
  const offsetY = height * 0.44 - worldH / 2

  focusX = offsetX + ((FOCUS_LNG + 180) / 360) * worldW
  focusY = offsetY + ((90 - FOCUS_LAT) / 180) * worldH

  const candidates = buildLandMask()
  const targetCount = width < 700 ? 2300 : 5200
  // 必须 ceil：floor 会在北半球高密度区提前取满，南半球粒子被截断
  const step = Math.max(1, Math.ceil(candidates.length / targetCount))
  const sampled: Array<{ x: number; y: number }> = []
  for (let i = 0; i < candidates.length; i += step) {
    const candidate = candidates[i]
    if (candidate) sampled.push(candidate)
  }

  particles = sampled.map((candidate) => {
    const tx = offsetX + (candidate.x / maskW) * worldW
    const ty = offsetY + (candidate.y / maskH) * worldH
    return {
      sx: Math.random() * width,
      sy: Math.random() * height,
      tx,
      ty,
      delay: Math.random() * 0.32,
      size: 0.7 + Math.random() * 1.6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? '#7dd3fc',
      phase: Math.random() * Math.PI * 2,
    }
  })

  // 少量“星座”连线，让世界地图从散点变成网络
  const buckets = new Map<string, number[]>()
  const cellSize = 16
  particles.forEach((particle, index) => {
    const key = `${Math.floor(particle.tx / cellSize)}:${Math.floor(particle.ty / cellSize)}`
    const bucket = buckets.get(key) ?? []
    bucket.push(index)
    buckets.set(key, bucket)
  })
  links = []
  for (let index = 0; index < particles.length && links.length < 260; index += 3) {
    const particle = particles[index]
    if (!particle) continue
    const gx = Math.floor(particle.tx / cellSize)
    const gy = Math.floor(particle.ty / cellSize)
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const bucket = buckets.get(`${gx + ox}:${gy + oy}`)
        if (!bucket) continue
        for (const otherIndex of bucket) {
          if (otherIndex <= index) continue
          const other = particles[otherIndex]
          if (!other) continue
          const distance = Math.hypot(particle.tx - other.tx, particle.ty - other.ty)
          if (distance < 15) {
            links.push([index, otherIndex])
            if (links.length >= 260) break
          }
        }
        if (links.length >= 260) break
      }
      if (links.length >= 260) break
    }
  }

  stars = Array.from({ length: 130 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: Math.random() * 1.1 + 0.25,
    phase: Math.random() * Math.PI * 2,
  }))
}

function drawFrame(now: number): void {
  if (!ctx) return
  const elapsed = now - started
  const gather = clamp(elapsed / FORM_MS, 0, 1)
  const gatherEased = easeOutCubic(gather)
  const zoom = clamp((elapsed - ZOOM_START) / ZOOM_MS, 0, 1)
  const zoomEased = zoom * zoom
  const scale = 1 + zoomEased * 8
  const zoomFade = 1 - zoomEased * 0.96

  ctx.clearRect(0, 0, width, height)

  // 背景星点
  for (const star of stars) {
    const twinkle = 0.22 + 0.28 * (0.5 + 0.5 * Math.sin(now / 820 + star.phase))
    ctx.globalAlpha = twinkle * (1 - zoom * 0.7)
    ctx.fillStyle = '#bae6fd'
    ctx.beginPath()
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2)
    ctx.fill()
  }

  // 粒子之间的细线
  if (gather > 0.35) {
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = 0.6
    for (const [fromIndex, toIndex] of links) {
      const from = particles[fromIndex]
      const to = particles[toIndex]
      if (!from || !to) continue
      const fromGather = clamp((gather - from.delay) / (1 - from.delay), 0, 1)
      const toGather = clamp((gather - to.delay) / (1 - to.delay), 0, 1)
      if (fromGather < 0.3 || toGather < 0.3) continue
      const fx = from.sx + (from.tx - from.sx) * easeOutCubic(fromGather)
      const fy = from.sy + (from.ty - from.sy) * easeOutCubic(fromGather)
      const tx = to.sx + (to.tx - to.sx) * easeOutCubic(toGather)
      const ty = to.sy + (to.ty - to.sy) * easeOutCubic(toGather)
      const x1 = focusX + (fx - focusX) * scale
      const y1 = focusY + (fy - focusY) * scale
      const x2 = focusX + (tx - focusX) * scale
      const y2 = focusY + (ty - focusY) * scale
      ctx.globalAlpha = 0.07 * gatherEased * zoomFade
      ctx.strokeStyle = '#38bdf8'
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
  }

  // 世界地图粒子
  ctx.globalCompositeOperation = 'lighter'
  for (const particle of particles) {
    const local = clamp((gather - particle.delay) / (1 - particle.delay), 0, 1)
    if (local <= 0) continue
    const eased = easeOutCubic(local)
    const px = particle.sx + (particle.tx - particle.sx) * eased
    const py = particle.sy + (particle.ty - particle.sy) * eased
    const x = focusX + (px - focusX) * scale
    const y = focusY + (py - focusY) * scale
    if (x < -40 || x > width + 40 || y < -40 || y > height + 40) continue

    const shimmer = 0.72 + 0.28 * Math.sin(now / 520 + particle.phase)
    const alpha = eased * shimmer * zoomFade
    const radius = particle.size * (0.85 + 0.35 * Math.sin(now / 700 + particle.phase))
    ctx.globalAlpha = 0.12 * alpha
    ctx.fillStyle = particle.color
    ctx.beginPath()
    ctx.arc(x, y, radius * 3.2, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = 0.9 * alpha
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  // 聚焦深圳的光环
  if (gather > 0.55 && zoom < 0.72) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 360)
    const alpha = (1 - zoom) * (0.55 - pulse * 0.2)
    ctx.globalAlpha = alpha
    ctx.strokeStyle = '#67e8f9'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(focusX, focusY, 6 + pulse * 5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = alpha * 0.55
    ctx.beginPath()
    ctx.arc(focusX, focusY, 15 + pulse * 7, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  if (elapsed >= ZOOM_START + 120) fading.value = true

  if (!formed && elapsed >= ZOOM_START) {
    formed = true
    emit('formed')
  }
  if (elapsed >= TOTAL_MS) {
    finish('done')
    return
  }
  raf = requestAnimationFrame(drawFrame)
}

function finish(reason: 'done' | 'skip'): void {
  if (finished) return
  finished = true
  cancelAnimationFrame(raf)
  if (reason === 'done') emit('done')
  else emit('skip')
}

function onResize(): void {
  buildScene()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('skip')
}

async function start(): Promise<void> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/world-land.json`)
    if (!response.ok) throw new Error(`world map ${response.status}`)
    land = (await response.json()) as LandData
    buildScene()
    if (!ctx) throw new Error('canvas unavailable')
    started = performance.now()
    raf = requestAnimationFrame(drawFrame)
  } catch {
    emit('skip')
  }
}

onMounted(() => {
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKeydown)
  void start()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    data-testid="map-intro"
    class="map-intro"
    :class="{ 'is-fading': fading }"
    role="presentation"
    @click.self="emit('skip')"
  >
    <canvas
      ref="canvas"
      class="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />

    <div class="map-intro__grid" aria-hidden="true" />
    <div class="map-intro__vignette" aria-hidden="true" />

    <header class="map-intro__brand">
      <span class="map-intro__logo">邻</span>
      <div>
        <p class="map-intro__name">邻域</p>
        <p class="map-intro__en">NEIGHBORHOOD INTELLIGENCE</p>
      </div>
    </header>

    <footer class="map-intro__footer">
      <div class="map-intro__progress"><span /></div>
      <p class="map-intro__meta">Natural Earth · Public Domain · OpenStreetMap · ODbL 1.0</p>
    </footer>

    <button type="button" class="map-intro__skip" @click="emit('skip')">
      跳过动画
      <span aria-hidden="true">→</span>
    </button>
  </div>
</template>

<style scoped>
.map-intro {
  position: fixed;
  inset: 0;
  z-index: 3000;
  overflow: hidden;
  background:
    radial-gradient(
      circle at 50% 40%,
      rgba(14, 51, 95, 0.95) 0%,
      rgba(5, 13, 28, 0.98) 52%,
      #02050c 100%
    ),
    #02050c;
  opacity: 1;
  transition: opacity 0.95s ease;
}

.map-intro.is-fading {
  opacity: 0;
}

.map-intro__grid {
  position: absolute;
  inset: 0;
  opacity: 0.22;
  background-image:
    linear-gradient(rgba(56, 189, 248, 0.09) 1px, transparent 1px),
    linear-gradient(90deg, rgba(56, 189, 248, 0.09) 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: radial-gradient(circle at 50% 45%, #000 0%, transparent 72%);
}

.map-intro__vignette {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      circle at 50% 44%,
      transparent 30%,
      rgba(2, 5, 12, 0.42) 68%,
      rgba(2, 5, 12, 0.82) 100%
    ),
    linear-gradient(to top, rgba(2, 5, 12, 0.88), transparent 28%);
}

.map-intro__brand {
  position: absolute;
  left: clamp(1.25rem, 4vw, 3.5rem);
  top: clamp(1.25rem, 4vw, 2.75rem);
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: #e0f2fe;
}

.map-intro__logo {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.6rem;
  background: linear-gradient(135deg, #2563eb, #0ea5e9);
  box-shadow: 0 0 28px rgba(56, 189, 248, 0.38);
  font-size: 0.85rem;
  font-weight: 700;
}

.map-intro__name {
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.14em;
}

.map-intro__en {
  margin-top: 0.15rem;
  font-size: 0.55rem;
  letter-spacing: 0.24em;
  color: rgba(186, 230, 253, 0.5);
}

.map-intro__footer {
  position: absolute;
  left: 50%;
  bottom: clamp(2rem, 7vh, 4.5rem);
  width: min(34rem, calc(100% - 2.5rem));
  transform: translateX(-50%);
  text-align: center;
  color: #e0f2fe;
}

.map-intro__progress {
  width: 100%;
  height: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(125, 211, 252, 0.12);
}

.map-intro__progress span {
  display: block;
  width: 100%;
  height: 100%;
  transform-origin: left center;
  background: linear-gradient(90deg, #0ea5e9, #67e8f9, #e0f2fe);
  animation: intro-progress 3.14s linear forwards;
}

.map-intro__meta {
  margin-top: 0.7rem;
  font-size: 0.56rem;
  letter-spacing: 0.16em;
  color: rgba(125, 211, 252, 0.42);
}

.map-intro__skip {
  position: absolute;
  right: clamp(1rem, 3vw, 2.5rem);
  top: clamp(1rem, 3vw, 2.25rem);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.8rem;
  border: 1px solid rgba(125, 211, 252, 0.24);
  border-radius: 999px;
  background: rgba(8, 24, 46, 0.55);
  color: rgba(224, 242, 254, 0.72);
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  backdrop-filter: blur(8px);
  transition:
    border-color 0.2s ease,
    color 0.2s ease;
}

.map-intro__skip:hover {
  border-color: rgba(125, 211, 252, 0.55);
  color: #f0f9ff;
}

@keyframes intro-progress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

@media (max-width: 640px) {
  .map-intro__en {
    display: none;
  }

  .map-intro__footer {
    bottom: 2.4rem;
  }
}
</style>
