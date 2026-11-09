<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useRoute } from 'vue-router'

import MapCanvas from '@/components/MapCanvas.vue'
import MapIntro from '@/components/MapIntro.vue'
import FilterPanel from '@/components/FilterPanel.vue'
import MobileSheet from '@/components/MobileSheet.vue'
import PoiCard from '@/components/PoiCard.vue'
import DetailPanel from '@/components/DetailPanel.vue'
import FeedbackDialog from '@/components/FeedbackDialog.vue'
import {
  filterPois,
  loadPois,
  nearby as nearbyQuery,
  nearbyFromServer,
  type NearbyItem,
} from '@/api/pois'
import { hasPlayedIntro, markIntroPlayed } from '@/lib/introState'
import { scheduleQueryLog, trackQueryNow } from '@/lib/queryTracker'
import { DEFAULT_FILTERS, type Filters, type Poi } from '@/types/poi'

interface Bounds {
  north: number
  south: number
  east: number
  west: number
}

interface PanelShard {
  top: string
  left: string
  width: string
  height: string
  dx: string
  dy: string
  rot: string
  delay: string
  clip: string
}

const route = useRoute()
const pois = ref<Poi[]>([])
const loading = ref(true)
const loadError = ref('')
const filters = ref<Filters>({ ...DEFAULT_FILTERS })
const bounds = ref<Bounds | null>(null)
const boxActive = ref(false)
const selected = ref<Poi | null>(null)
const nearbyItems = ref<NearbyItem[]>([])
const nearbyLoading = ref(false)
const feedbackTarget = ref<{ poi: Poi; field?: string } | null>(null)
const mapRef = ref<InstanceType<typeof MapCanvas> | null>(null)
const isDesktop = useMediaQuery('(min-width: 1024px)')

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const forceIntro = route.query.intro === '1'
const shouldIntro = forceIntro || (!navigator.webdriver && !reducedMotion && !hasPlayedIntro())

if (shouldIntro) markIntroPlayed()

const introActive = ref(shouldIntro)
const cardsReady = ref(!shouldIntro)
const overlayDone = ref(!shouldIntro)
const mapSettled = ref(!shouldIntro)

let introFallbackTimer: number | null = null

const panelShards: PanelShard[] = [
  {
    top: '-16px',
    left: '6%',
    width: '30px',
    height: '26px',
    dx: '-40px',
    dy: '-110px',
    rot: '-44deg',
    delay: '0ms',
    clip: 'polygon(0 0, 100% 18%, 78% 100%, 8% 82%)',
  },
  {
    top: '-10px',
    left: '38%',
    width: '46px',
    height: '14px',
    dx: '0px',
    dy: '-120px',
    rot: '28deg',
    delay: '40ms',
    clip: 'polygon(0 8%, 100% 0, 84% 100%, 12% 88%)',
  },
  {
    top: '-14px',
    left: '74%',
    width: '24px',
    height: '28px',
    dx: '50px',
    dy: '-110px',
    rot: '-30deg',
    delay: '80ms',
    clip: 'polygon(10% 0, 100% 22%, 82% 100%, 0 70%)',
  },
  {
    top: '16%',
    left: '-18px',
    width: '18px',
    height: '62px',
    dx: '-120px',
    dy: '20px',
    rot: '58deg',
    delay: '30ms',
    clip: 'polygon(0 8%, 100% 0, 84% 100%, 12% 88%)',
  },
  {
    top: '52%',
    left: '-14px',
    width: '30px',
    height: '40px',
    dx: '-130px',
    dy: '10px',
    rot: '-26deg',
    delay: '110ms',
    clip: 'polygon(0 0, 100% 16%, 74% 100%)',
  },
  {
    top: '82%',
    left: '-12px',
    width: '38px',
    height: '22px',
    dx: '-100px',
    dy: '70px',
    rot: '38deg',
    delay: '160ms',
    clip: 'polygon(0 0, 100% 24%, 84% 100%, 10% 74%)',
  },
  {
    top: '10%',
    left: 'calc(100% - 4px)',
    width: '22px',
    height: '54px',
    dx: '120px',
    dy: '-30px',
    rot: '34deg',
    delay: '60ms',
    clip: 'polygon(12% 0, 100% 12%, 88% 100%, 0 78%)',
  },
  {
    top: '44%',
    left: 'calc(100% - 8px)',
    width: '28px',
    height: '38px',
    dx: '130px',
    dy: '20px',
    rot: '-32deg',
    delay: '20ms',
    clip: 'polygon(0 20%, 100% 0, 72% 100%)',
  },
  {
    top: '74%',
    left: 'calc(100% - 6px)',
    width: '24px',
    height: '30px',
    dx: '110px',
    dy: '60px',
    rot: '26deg',
    delay: '140ms',
    clip: 'polygon(0 0, 100% 16%, 80% 100%, 10% 74%)',
  },
  {
    top: 'calc(100% - 6px)',
    left: '20%',
    width: '42px',
    height: '16px',
    dx: '-20px',
    dy: '110px',
    rot: '-18deg',
    delay: '90ms',
    clip: 'polygon(0 12%, 100% 0, 88% 100%, 8% 82%)',
  },
  {
    top: 'calc(100% - 4px)',
    left: '52%',
    width: '26px',
    height: '20px',
    dx: '10px',
    dy: '120px',
    rot: '46deg',
    delay: '180ms',
    clip: 'polygon(0 0, 100% 30%, 60% 100%)',
  },
  {
    top: 'calc(100% - 8px)',
    left: '80%',
    width: '22px',
    height: '18px',
    dx: '40px',
    dy: '110px',
    rot: '-52deg',
    delay: '30ms',
    clip: 'polygon(0 20%, 100% 0, 86% 100%)',
  },
]

const SHARD_COLORS = [
  'linear-gradient(135deg, rgba(37,99,235,0.9), rgba(56,189,248,0.14))',
  'linear-gradient(160deg, rgba(14,165,233,0.86), rgba(125,211,252,0.12))',
  'linear-gradient(120deg, rgba(59,130,246,0.9), rgba(165,243,252,0.18))',
  'linear-gradient(200deg, rgba(96,165,250,0.88), rgba(30,64,175,0.16))',
]

function shardOffset(value: string): string {
  return `${Math.round(parseFloat(value) * 0.45)}px`
}

function shardStyle(shard: PanelShard, index: number): Record<string, string> {
  return {
    top: shard.top,
    left: shard.left,
    width: shard.width,
    height: shard.height,
    '--dx': shardOffset(shard.dx),
    '--dy': shardOffset(shard.dy),
    '--rot': shard.rot,
    '--delay': shard.delay,
    background: SHARD_COLORS[index % SHARD_COLORS.length] ?? SHARD_COLORS[0],
    clipPath: shard.clip,
  }
}

const visiblePois = computed(() =>
  filterPois(pois.value, { filters: filters.value, bounds: bounds.value }),
)

const selectedId = computed(() => selected.value?.id ?? null)

function clearIntroFallback(): void {
  if (introFallbackTimer !== null) {
    window.clearTimeout(introFallbackTimer)
    introFallbackTimer = null
  }
}

function settleCards(): void {
  if (!overlayDone.value || !mapSettled.value) return
  cardsReady.value = true
  clearIntroFallback()
}

function onIntroFormed(): void {
  mapRef.value?.beginZoom()
}

function onIntroDone(): void {
  overlayDone.value = true
  introActive.value = false
  settleCards()
}

function onMapSettled(): void {
  mapSettled.value = true
  settleCards()
}

function skipIntro(): void {
  clearIntroFallback()
  overlayDone.value = true
  mapSettled.value = true
  cardsReady.value = true
  introActive.value = false
  mapRef.value?.finishIntro()
}

onMounted(async () => {
  if (shouldIntro) {
    introFallbackTimer = window.setTimeout(() => {
      overlayDone.value = true
      mapSettled.value = true
      cardsReady.value = true
      introActive.value = false
      mapRef.value?.finishIntro()
    }, 6000)
  }
  try {
    pois.value = await loadPois()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '数据加载失败'
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  clearIntroFallback()
})

function trackPoiQuery(poi: Poi): void {
  const span = 0.01
  trackQueryNow({
    keyword: poi.name,
    types: [poi.type],
    bounds: {
      west: poi.lng - span,
      south: poi.lat - span,
      east: poi.lng + span,
      north: poi.lat + span,
    },
  })
}

function onSelect(poi: Poi): void {
  selected.value = poi
  nearbyItems.value = []
  trackPoiQuery(poi)
}

function onBoxSelect(nextBounds: Bounds): void {
  bounds.value = nextBounds
  boxActive.value = false
  trackQueryNow({
    keyword: filters.value.keyword,
    district: filters.value.district,
    types: filters.value.layers,
    bounds: nextBounds,
  })
}

watch(
  () => filters.value.keyword,
  (value) => {
    if (!value.trim()) return
    scheduleQueryLog({
      keyword: value,
      district: filters.value.district,
      types: filters.value.layers,
      bounds: bounds.value ?? undefined,
    })
  },
)

watch(
  () => filters.value.district,
  (value) => {
    if (value === '全部区域') return
    scheduleQueryLog({
      keyword: filters.value.keyword,
      district: value,
      types: filters.value.layers,
    })
  },
)

function clearBox(): void {
  bounds.value = null
  boxActive.value = false
  mapRef.value?.stopBox()
}

function startBox(): void {
  boxActive.value = true
  mapRef.value?.startBox()
}

function locate(poi: Poi): void {
  selected.value = poi
  mapRef.value?.focusOn(poi.lng, poi.lat, 16)
  trackPoiQuery(poi)
}

async function handleNearby(payload: {
  poi: Poi
  radius: number
  branchType: 'all' | 'atm'
}): Promise<void> {
  nearbyLoading.value = true
  try {
    // 优先走后端 ST_Distance_Sphere，失败再本地算
    const remote = await nearbyFromServer(payload.poi, payload.radius, payload.branchType)
    nearbyItems.value =
      remote ?? nearbyQuery(pois.value, payload.poi, payload.radius, ['bank'], payload.branchType)
  } finally {
    nearbyLoading.value = false
  }
}

function closeDetail(): void {
  selected.value = null
  nearbyItems.value = []
}
</script>

<template>
  <div class="relative h-[calc(100vh-3.5rem)] w-full overflow-hidden bg-canvas">
    <MapCanvas
      ref="mapRef"
      :pois="visiblePois"
      :selected-id="selectedId"
      :cinematic="shouldIntro"
      class="absolute inset-0"
      @select="onSelect"
      @nearby="(poi) => locate(poi)"
      @bounds="onBoxSelect"
      @intro-done="onMapSettled"
    />

    <!-- 供 E2E 与无障碍读取的隐藏计数器（桌面/移动布局都可用） -->
    <span class="sr-only" data-testid="result-count">{{ visiblePois.length }}</span>

    <!-- 左：筛选 -->
    <aside
      class="intro-panel absolute bottom-4 left-4 top-4 z-[1000] hidden w-[248px] lg:block"
      :class="{ 'is-revealed': cardsReady }"
    >
      <span
        v-for="(shard, index) in panelShards"
        :key="index"
        class="intro-shard"
        :style="shardStyle(shard, index)"
        aria-hidden="true"
      />
      <div
        class="intro-card flex h-full flex-col rounded-card border border-line bg-surface/95 p-4 shadow-float backdrop-blur"
        :class="{ 'is-revealed': cardsReady }"
      >
        <div v-if="loading" class="space-y-3">
          <div v-for="i in 5" :key="i" class="h-8 animate-pulse rounded-lg bg-surface-soft" />
        </div>
        <FilterPanel v-else v-model="filters" :total="visiblePois.length" />
      </div>
    </aside>

    <!-- 中上：命令条 -->
    <div
      class="intro-card absolute left-4 right-4 top-4 z-[1000] flex items-center gap-2 rounded-card border border-line bg-surface/95 p-2 shadow-float backdrop-blur lg:left-[268px] lg:right-[380px]"
      :class="{ 'is-revealed': cardsReady }"
    >
      <div class="relative flex-1">
        <svg
          class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" stroke-linecap="round" />
        </svg>
        <input
          v-model="filters.keyword"
          class="h-9 w-full rounded-[10px] border border-line bg-surface pl-9 pr-3 text-xs text-ink-700 outline-none transition placeholder:text-ink-400 focus:border-brand-500"
          placeholder="搜索网点 / 小区名称"
        />
      </div>

      <div
        class="flex h-9 shrink-0 items-center rounded-[10px] border border-line bg-surface sm:hidden lg:flex"
      >
        <button
          class="grid h-9 w-8 place-items-center text-ink-500 transition hover:text-brand-600"
          aria-label="放大"
          @click="mapRef?.zoomIn()"
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M12 5v14M5 12h14" stroke-linecap="round" />
          </svg>
        </button>
        <span class="h-4 w-px bg-line" />
        <button
          class="grid h-9 w-8 place-items-center text-ink-500 transition hover:text-brand-600"
          aria-label="缩小"
          @click="mapRef?.zoomOut()"
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M5 12h14" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <button
        class="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-xs transition"
        :class="
          boxActive
            ? 'border-brand-500 bg-brand-50 text-brand-600'
            : 'border-line bg-surface text-ink-600 hover:border-line-strong'
        "
        @click="boxActive ? clearBox() : startBox()"
      >
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        >
          <path
            d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"
            stroke-linecap="round"
          />
        </svg>
        框选
      </button>

      <button
        class="hidden h-9 shrink-0 items-center rounded-[10px] border border-line bg-surface px-3 text-xs text-ink-600 transition hover:border-line-strong sm:flex"
        @click="mapRef?.fitAll()"
      >
        全览
      </button>

      <div
        v-if="bounds"
        class="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-brand-500/40 bg-brand-50 px-2.5 text-xs text-brand-600"
      >
        已框选
        <button class="text-brand-600/70 hover:text-brand-700" @click="clearBox">清除</button>
      </div>
    </div>

    <!-- 右：结果 / 详情 -->
    <aside
      class="intro-panel absolute bottom-4 right-4 top-4 z-[1000] hidden w-[360px] lg:flex"
      :class="{ 'is-revealed': cardsReady }"
    >
      <span
        v-for="(shard, index) in panelShards"
        :key="index"
        class="intro-shard"
        :style="shardStyle(shard, index)"
        aria-hidden="true"
      />
      <div
        class="intro-card flex h-full w-full flex-col overflow-hidden rounded-card border border-line bg-surface/95 shadow-float backdrop-blur"
        :class="{ 'is-revealed': cardsReady }"
      >
        <DetailPanel
          v-if="selected && isDesktop"
          :poi="selected"
          :nearby="nearbyItems"
          :loading="nearbyLoading"
          @close="closeDetail"
          @locate="locate"
          @feedback="(payload) => (feedbackTarget = payload)"
          @nearby="handleNearby"
        />

        <template v-else>
          <header class="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 class="text-sm font-semibold text-ink-900">查询结果</h2>
            <span class="text-[11px] text-ink-400">
              <span class="font-medium text-ink-700">{{ visiblePois.length }}</span> 个点位
            </span>
          </header>

          <div class="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            <template v-if="loading">
              <div
                v-for="i in 6"
                :key="i"
                class="h-16 animate-pulse rounded-soft bg-surface-soft"
              />
            </template>

            <div
              v-else-if="loadError"
              class="rounded-soft border border-dashed border-line-strong px-3 py-6 text-center"
            >
              <p class="text-xs text-ink-500">{{ loadError }}</p>
            </div>

            <template v-else-if="visiblePois.length">
              <PoiCard
                v-for="poi in visiblePois.slice(0, 60)"
                :key="poi.id"
                :poi="poi"
                :active="poi.id === selectedId"
                @click="locate(poi)"
              />
              <p v-if="visiblePois.length > 60" class="pt-1 text-center text-[11px] text-ink-400">
                仅展示前 60 个，继续缩小范围可看到更多
              </p>
            </template>

            <div
              v-else
              class="rounded-soft border border-dashed border-line-strong px-3 py-8 text-center"
            >
              <p class="text-xs text-ink-500">当前条件下没有点位</p>
              <p class="mt-1 text-[11px] text-ink-400">试试取消筛选或切换图层</p>
            </div>
          </div>
        </template>
      </div>
    </aside>

    <!-- 移动端详情：底部面板，避免 360px 侧栏在窄屏上挤压地图 -->
    <MobileSheet :open="Boolean(selected) && !isDesktop" @close="closeDetail">
      <DetailPanel
        v-if="selected"
        :poi="selected"
        :nearby="nearbyItems"
        :loading="nearbyLoading"
        @close="closeDetail"
        @locate="locate"
        @feedback="(payload) => (feedbackTarget = payload)"
        @nearby="handleNearby"
      />
    </MobileSheet>

    <!-- 图例 -->
    <div
      class="intro-card absolute bottom-4 left-4 z-[900] hidden items-center gap-3 rounded-full border border-line bg-surface/90 px-3 py-1.5 text-[11px] text-ink-500 shadow-card backdrop-blur lg:left-[268px] lg:flex"
      :class="{ 'is-revealed': cardsReady }"
    >
      <span class="flex items-center gap-1.5"
        ><span class="h-2 w-2 rounded-full bg-brand-500" />银行网点</span
      >
      <span class="flex items-center gap-1.5"
        ><span class="h-2 w-2 rounded-full bg-amber-500" />小区</span
      >
    </div>

    <!-- 移动端列表 -->
    <div
      class="intro-card absolute inset-x-0 bottom-0 z-[1000] max-h-[42%] overflow-y-auto rounded-t-card border-t border-line bg-surface p-3 shadow-float lg:hidden"
      :class="{ 'is-revealed': cardsReady }"
    >
      <div class="mb-2 flex items-center justify-between">
        <span class="text-xs font-medium text-ink-700">查询结果</span>
        <span class="text-[11px] text-ink-400">{{ visiblePois.length }} 个</span>
      </div>
      <div class="space-y-2">
        <PoiCard
          v-for="poi in visiblePois.slice(0, 20)"
          :key="poi.id"
          :poi="poi"
          :active="poi.id === selectedId"
          @click="locate(poi)"
        />
      </div>
    </div>

    <MapIntro v-if="introActive" @formed="onIntroFormed" @done="onIntroDone" @skip="skipIntro" />

    <FeedbackDialog
      v-if="feedbackTarget"
      :poi="feedbackTarget.poi"
      :initial-field="feedbackTarget.field"
      @close="feedbackTarget = null"
      @submitted="feedbackTarget = null"
    />
  </div>
</template>

<style scoped>
.intro-card {
  position: relative;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(14px) scale(0.97);
  filter: blur(5px);
}

.intro-card.is-revealed {
  visibility: visible;
  pointer-events: auto;
  animation: intro-card-assemble 0.68s cubic-bezier(0.16, 0.84, 0.3, 1) 0.34s both;
}

.intro-card.is-revealed::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  box-shadow:
    0 0 0 1px rgba(125, 211, 252, 0.55),
    0 0 30px rgba(56, 189, 248, 0.32);
  animation: intro-card-glow 1.15s ease-out 0.1s both;
}

.intro-panel .intro-shard {
  position: absolute;
  z-index: 1200;
  border: 1px solid rgba(224, 242, 254, 0.75);
  border-radius: 2px;
  opacity: 0;
  pointer-events: none;
  box-shadow:
    0 0 22px rgba(37, 99, 235, 0.5),
    inset 0 0 14px rgba(255, 255, 255, 0.28);
  transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(0.45);
}

.intro-panel.is-revealed .intro-shard {
  animation: intro-shard-fly 1.3s cubic-bezier(0.16, 0.84, 0.3, 1) forwards;
  animation-delay: var(--delay);
}

@keyframes intro-card-assemble {
  0% {
    opacity: 0;
    transform: translateY(14px) scale(0.97);
    filter: blur(5px);
  }
  55% {
    opacity: 1;
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}

@keyframes intro-card-glow {
  0% {
    opacity: 0;
  }
  22% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

@keyframes intro-shard-fly {
  0% {
    opacity: 0.95;
    transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(0.45);
  }
  55% {
    opacity: 0.85;
  }
  82% {
    opacity: 0.4;
  }
  100% {
    opacity: 0;
    transform: translate(0, 0) rotate(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .intro-card {
    visibility: visible;
    opacity: 1;
    transform: none;
    filter: none;
  }

  .intro-shard {
    display: none;
  }
}
</style>
