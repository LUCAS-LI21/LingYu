<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { useRoute } from 'vue-router'

import DetailPanel from '@/components/DetailPanel.vue'
import FeedbackDialog from '@/components/FeedbackDialog.vue'
import FilterPanel from '@/components/FilterPanel.vue'
import MobileSheet from '@/components/MobileSheet.vue'
import PoiCard from '@/components/PoiCard.vue'
import { filterPois, loadPois, nearby as nearbyQuery, paginate, type NearbyItem } from '@/api/pois'
import { scheduleQueryLog, trackQueryNow } from '@/lib/queryTracker'
import { DEFAULT_FILTERS, type Filters, type Poi, type PoiType } from '@/types/poi'

const route = useRoute()
const pois = ref<Poi[]>([])
const loading = ref(true)
const filters = ref<Filters>({ ...DEFAULT_FILTERS })
const sort = ref<'default' | 'name' | 'priceAsc' | 'priceDesc' | 'yearDesc'>('default')
const page = ref(1)
const pageSize = 12
const selected = ref<Poi | null>(null)
const nearbyItems = ref<NearbyItem[]>([])
const feedbackTarget = ref<{ poi: Poi; field?: string } | null>(null)
const isDesktop = useMediaQuery('(min-width: 1024px)')

let suppressTrack = false

function applyRouteQuery(): void {
  suppressTrack = true
  const query = route.query
  const next: Filters = { ...filters.value }
  if (typeof query.keyword === 'string') next.keyword = query.keyword
  if (typeof query.district === 'string' && query.district) next.district = query.district
  if (typeof query.layers === 'string') {
    const layers = query.layers
      .split(',')
      .map((item) => item.trim())
      .filter((item): item is PoiType => item === 'bank' || item === 'community')
    if (layers.length) next.layers = layers
  }
  filters.value = next
  page.value = 1
  void nextTick(() => {
    suppressTrack = false
  })
}

function currentQueryEvent() {
  const value = filters.value
  return {
    keyword: value.keyword,
    district: value.district,
    types: value.layers,
    minPrice: value.priceRange?.[0],
    maxPrice: value.priceRange?.[1],
    minYear: value.yearRange?.[0],
    maxYear: value.yearRange?.[1],
  }
}

function trackCurrentFilters(): void {
  const value = filters.value
  if (!value.keyword.trim() && value.district === '全部区域') return
  scheduleQueryLog(currentQueryEvent())
}

watch(
  () => [
    filters.value.keyword,
    filters.value.district,
    filters.value.layers.join(','),
    filters.value.branchType,
    JSON.stringify(filters.value.priceRange),
    JSON.stringify(filters.value.yearRange),
  ],
  () => {
    if (!suppressTrack) trackCurrentFilters()
  },
)

const filtered = computed(() =>
  filterPois(pois.value, { filters: filters.value, sort: sort.value }),
)
const paged = computed(() => paginate(filtered.value, page.value, pageSize))
const maxPage = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))

onMounted(async () => {
  applyRouteQuery()
  pois.value = await loadPois()
  loading.value = false
})

watch(
  () => route.query,
  () => applyRouteQuery(),
  { deep: true },
)

function resetPage(): void {
  page.value = 1
}

function onKeywordSearch(): void {
  resetPage()
  if (!filters.value.keyword.trim() && filters.value.district === '全部区域') return
  trackQueryNow(currentQueryEvent())
}

function handleNearby(payload: { poi: Poi; radius: number; branchType: 'all' | 'atm' }): void {
  nearbyItems.value = nearbyQuery(
    pois.value,
    payload.poi,
    payload.radius,
    ['bank'],
    payload.branchType,
  )
}
</script>

<template>
  <div class="mx-auto w-full max-w-[1200px] px-4 py-6">
    <header class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight text-ink-900">列表查询</h1>
        <p class="mt-1 text-xs text-ink-500">
          按区域、类型、价格与年份筛选，支持排序与分页
          <span class="text-ink-400/80">· OSM 部分网点只记录品牌名，用 #编号 区分</span>
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div class="relative">
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
            data-testid="list-search"
            class="h-9 w-48 rounded-[10px] border border-line bg-surface pl-9 pr-3 text-xs text-ink-700 outline-none transition placeholder:text-ink-400 focus:border-brand-500 sm:w-56"
            placeholder="搜索名称 / 地址"
            @input="resetPage"
            @keyup.enter="onKeywordSearch"
          />
        </div>
        <span class="text-xs text-ink-400">
          共 <span class="font-medium text-ink-700">{{ filtered.length }}</span> 条
        </span>
        <select
          v-model="sort"
          class="h-9 rounded-[10px] border border-line bg-surface px-3 text-xs text-ink-700 outline-none transition focus:border-brand-500"
          @change="resetPage"
        >
          <option value="default">默认排序</option>
          <option value="priceDesc">均价从高到低</option>
          <option value="priceAsc">均价从低到高</option>
          <option value="yearDesc">建成年份从新到旧</option>
          <option value="name">名称排序</option>
        </select>
      </div>
    </header>

    <div class="grid gap-5 lg:grid-cols-[248px_1fr]">
      <aside class="lg:sticky lg:top-20 lg:self-start">
        <div class="rounded-card border border-line bg-surface p-4 shadow-card">
          <FilterPanel v-model="filters" :total="filtered.length" @reset="resetPage" />
        </div>
      </aside>

      <section>
        <div v-if="loading" class="grid gap-3 sm:grid-cols-2">
          <div v-for="i in 6" :key="i" class="h-[72px] animate-pulse rounded-soft bg-surface" />
        </div>

        <div v-else-if="paged.items.length" class="grid gap-3 sm:grid-cols-2">
          <PoiCard
            v-for="poi in paged.items"
            :key="poi.id"
            :poi="poi"
            :active="poi.id === selected?.id"
            @click="selected = poi"
          />
        </div>

        <div
          v-else
          class="rounded-card border border-dashed border-line-strong bg-surface px-6 py-16 text-center"
        >
          <p class="text-sm text-ink-600">没有符合条件的点位</p>
          <p class="mt-1 text-xs text-ink-400">试着放宽价格区间或切换图层</p>
        </div>

        <nav v-if="!loading && maxPage > 1" class="mt-5 flex items-center justify-center gap-1.5">
          <button
            class="h-8 rounded-lg border border-line bg-surface px-3 text-xs text-ink-600 transition hover:border-line-strong disabled:opacity-40"
            :disabled="page === 1"
            @click="page -= 1"
          >
            上一页
          </button>
          <span class="px-2 text-xs text-ink-500">{{ page }} / {{ maxPage }}</span>
          <button
            class="h-8 rounded-lg border border-line bg-surface px-3 text-xs text-ink-600 transition hover:border-line-strong disabled:opacity-40"
            :disabled="page >= maxPage"
            @click="page += 1"
          >
            下一页
          </button>
        </nav>
      </section>
    </div>

    <!-- 详情抽屉 -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-x-6 opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="translate-x-6 opacity-0"
    >
      <div
        v-if="selected && isDesktop"
        class="fixed inset-y-3 right-3 top-[3.75rem] z-[1500] w-[360px] max-w-[calc(100vw-1.5rem)]"
      >
        <div class="h-full overflow-hidden rounded-card border border-line bg-surface shadow-float">
          <DetailPanel
            :poi="selected"
            :nearby="nearbyItems"
            @close="selected = null"
            @locate="selected = null"
            @feedback="(payload) => (feedbackTarget = payload)"
            @nearby="handleNearby"
          />
        </div>
      </div>
    </Transition>

    <!-- 移动端详情：底部面板，与地图页保持一致的交互 -->
    <MobileSheet :open="Boolean(selected) && !isDesktop" @close="selected = null">
      <DetailPanel
        v-if="selected"
        :poi="selected"
        :nearby="nearbyItems"
        @close="selected = null"
        @locate="selected = null"
        @feedback="(payload) => (feedbackTarget = payload)"
        @nearby="handleNearby"
      />
    </MobileSheet>

    <FeedbackDialog
      v-if="feedbackTarget"
      :poi="feedbackTarget.poi"
      :initial-field="feedbackTarget.field"
      @close="feedbackTarget = null"
      @submitted="feedbackTarget = null"
    />
  </div>
</template>
