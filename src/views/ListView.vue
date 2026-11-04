<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import DetailPanel from '@/components/DetailPanel.vue'
import FeedbackDialog from '@/components/FeedbackDialog.vue'
import FilterPanel from '@/components/FilterPanel.vue'
import PoiCard from '@/components/PoiCard.vue'
import { filterPois, loadPois, nearby as nearbyQuery, paginate, type NearbyItem } from '@/api/pois'
import { DEFAULT_FILTERS, type Filters, type Poi } from '@/types/poi'

const pois = ref<Poi[]>([])
const loading = ref(true)
const filters = ref<Filters>({ ...DEFAULT_FILTERS })
const sort = ref<'default' | 'name' | 'priceAsc' | 'priceDesc' | 'yearDesc'>('default')
const page = ref(1)
const pageSize = 12
const selected = ref<Poi | null>(null)
const nearbyItems = ref<NearbyItem[]>([])
const feedbackTarget = ref<Poi | null>(null)

const filtered = computed(() =>
  filterPois(pois.value, { filters: filters.value, sort: sort.value }),
)
const paged = computed(() => paginate(filtered.value, page.value, pageSize))
const maxPage = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))

onMounted(async () => {
  pois.value = await loadPois()
  loading.value = false
})

function resetPage(): void {
  page.value = 1
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

      <div class="flex items-center gap-2">
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
        v-if="selected"
        class="fixed inset-y-3 right-3 top-[3.75rem] z-[1500] w-[360px] max-w-[calc(100vw-1.5rem)]"
      >
        <div class="h-full overflow-hidden rounded-card border border-line bg-surface shadow-float">
          <DetailPanel
            :poi="selected"
            :nearby="nearbyItems"
            @close="selected = null"
            @locate="selected = null"
            @feedback="(poi) => (feedbackTarget = poi)"
            @nearby="handleNearby"
          />
        </div>
      </div>
    </Transition>

    <FeedbackDialog
      v-if="feedbackTarget"
      :poi="feedbackTarget"
      @close="feedbackTarget = null"
      @submitted="feedbackTarget = null"
    />
  </div>
</template>
