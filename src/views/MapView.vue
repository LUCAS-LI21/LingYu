<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import MapCanvas from '@/components/MapCanvas.vue'
import FilterPanel from '@/components/FilterPanel.vue'
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
import { DEFAULT_FILTERS, type Filters, type Poi } from '@/types/poi'

interface Bounds {
  north: number
  south: number
  east: number
  west: number
}

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

const visiblePois = computed(() =>
  filterPois(pois.value, { filters: filters.value, bounds: bounds.value }),
)

const selectedId = computed(() => selected.value?.id ?? null)

onMounted(async () => {
  try {
    pois.value = await loadPois()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '数据加载失败'
  } finally {
    loading.value = false
  }
})

function onSelect(poi: Poi): void {
  selected.value = poi
  nearbyItems.value = []
}

function onBoxSelect(nextBounds: Bounds): void {
  bounds.value = nextBounds
  boxActive.value = false
}

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
      class="absolute inset-0"
      @select="onSelect"
      @nearby="(poi) => locate(poi)"
      @bounds="onBoxSelect"
    />

    <!-- 供 E2E 与无障碍读取的隐藏计数器（桌面/移动布局都可用） -->
    <span class="sr-only" data-testid="result-count">{{ visiblePois.length }}</span>

    <!-- 左：筛选 -->
    <aside class="absolute bottom-4 left-4 top-4 z-[1000] hidden w-[248px] lg:block">
      <div
        class="flex h-full flex-col rounded-card border border-line bg-surface/95 p-4 shadow-float backdrop-blur"
      >
        <div v-if="loading" class="space-y-3">
          <div v-for="i in 5" :key="i" class="h-8 animate-pulse rounded-lg bg-surface-soft" />
        </div>
        <FilterPanel v-else v-model="filters" :total="visiblePois.length" />
      </div>
    </aside>

    <!-- 中上：命令条 -->
    <div
      class="absolute left-4 right-4 top-4 z-[1000] flex items-center gap-2 rounded-card border border-line bg-surface/95 p-2 shadow-float backdrop-blur lg:left-[268px] lg:right-[380px]"
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
    <aside class="absolute bottom-4 right-4 top-4 z-[1000] hidden w-[360px] lg:flex">
      <div
        class="flex h-full w-full flex-col overflow-hidden rounded-card border border-line bg-surface/95 shadow-float backdrop-blur"
      >
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

    <!-- 图例 -->
    <div
      class="absolute bottom-4 left-4 z-[900] hidden items-center gap-3 rounded-full border border-line bg-surface/90 px-3 py-1.5 text-[11px] text-ink-500 shadow-card backdrop-blur lg:left-[268px] lg:flex"
    >
      <span class="flex items-center gap-1.5"
        ><span class="h-2 w-2 rounded-full bg-brand-500" />银行网点</span
      >
      <span class="flex items-center gap-1.5"
        ><span class="h-2 w-2 rounded-full bg-amber-500" />小区</span
      >
      <span class="h-3 w-px bg-line-strong" />
      <span>数据：OpenStreetMap · ODbL</span>
    </div>

    <!-- 移动端列表 -->
    <div
      class="absolute inset-x-0 bottom-0 z-[1000] max-h-[42%] overflow-y-auto rounded-t-card border-t border-line bg-surface p-3 shadow-float lg:hidden"
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

    <FeedbackDialog
      v-if="feedbackTarget"
      :poi="feedbackTarget.poi"
      :initial-field="feedbackTarget.field"
      @close="feedbackTarget = null"
      @submitted="feedbackTarget = null"
    />
  </div>
</template>
