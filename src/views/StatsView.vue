<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { buildStats, loadPois, statsFromServer, type Stats } from '@/api/pois'
import { fetchHotspots, type Hotspots } from '@/api/server'
import {
  clearRecentQueries,
  listRecentQueries,
  recentQueryLabel,
  trackQueryNow,
  type RecentQuery,
} from '@/lib/queryTracker'
import { SHENZHEN_DISTRICTS, type PoiType } from '@/types/poi'

const router = useRouter()
const stats = ref<Stats | null>(null)
/** 查询热点：query_log 聚合结果，前台也展示，形成「搜索 → 热点 → 采集优先级」的可见闭环 */
const hotspots = ref<Hotspots | null>(null)
const loading = ref(true)

const keyword = ref('')
const district = ref('全部区域')
const poiType = ref<'all' | PoiType>('all')
const searchError = ref('')
const recentQueries = ref<RecentQuery[]>([])

const districts = ['全部区域', ...SHENZHEN_DISTRICTS]

onMounted(async () => {
  recentQueries.value = listRecentQueries()
  // 后端在线用后端聚合（SQL GROUP BY），否则用本地统计兜底
  hotspots.value = await fetchHotspots().catch(() => null)
  const remote = await statsFromServer()
  stats.value = remote ?? buildStats(await loadPois())
  loading.value = false
})

const maxBrand = computed(() => Math.max(1, ...(stats.value?.brands.map((b) => b.value) ?? [1])))
const maxPrice = computed(() =>
  Math.max(1, ...(stats.value?.priceBuckets.map((b) => b.value) ?? [1])),
)
const maxGrid = computed(() => Math.max(1, ...(stats.value?.gridTop.map((b) => b.value) ?? [1])))

const cards = computed(() => [
  { label: '银行网点', value: stats.value?.branch ?? 0, hint: '含柜台网点', tone: 'brand' },
  { label: 'ATM 自助', value: stats.value?.atm ?? 0, hint: '24 小时可用', tone: 'mint' },
  { label: '住宅小区', value: stats.value?.community ?? 0, hint: '含村/花园/新村', tone: 'amber' },
  { label: '覆盖区域', value: stats.value?.districts ?? 0, hint: '有数据的行政区', tone: 'ink' },
])

const byDistrict = computed(() => stats.value?.byDistrict ?? [])

/** 区域图按两者的最大值定标，保证条形可比 */
const maxDistrict = computed(() =>
  Math.max(1, ...byDistrict.value.map((row) => Math.max(row.bank, row.community))),
)
const hotBrands = computed(() => stats.value?.brands.slice(0, 6) ?? [])

function submitSearch(): void {
  const term = keyword.value.trim()
  if (!term && district.value === '全部区域') {
    searchError.value = '请输入关键词，或先选择一个区域'
    return
  }
  searchError.value = ''
  const types: PoiType[] = poiType.value === 'all' ? ['bank', 'community'] : [poiType.value]
  // 记录本次查询：后端 query_log → 热点聚合 → 抓取优先级（FR-Q-11 / FR-O-01）
  trackQueryNow({ keyword: term, district: district.value, types })
  recentQueries.value = listRecentQueries()

  const query: Record<string, string> = { layers: types.join(',') }
  if (term) query.keyword = term
  if (district.value !== '全部区域') query.district = district.value
  void router.push({ path: '/list', query })
}

function applyRecent(item: RecentQuery): void {
  keyword.value = item.keyword
  district.value = item.district
  poiType.value = item.types.length === 1 ? item.types[0]! : 'all'
  submitSearch()
}

function searchBrand(brand: string): void {
  keyword.value = brand
  district.value = '全部区域'
  poiType.value = 'bank'
  submitSearch()
}

function onClearRecent(): void {
  clearRecentQueries()
  recentQueries.value = []
}
</script>

<template>
  <div class="mx-auto w-full max-w-[1200px] px-4 py-6">
    <header class="mb-5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold tracking-tight text-ink-900">数据洞察</h1>
          <p class="mt-1 text-xs text-ink-500">基于本地库统计，随数据采集自动更新</p>
        </div>
      </div>

      <form
        class="mt-4 flex flex-col gap-2 rounded-card border border-line bg-surface p-2 shadow-card sm:flex-row sm:items-center"
        @submit.prevent="submitSearch"
      >
        <div class="relative min-w-0 flex-1">
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
            v-model="keyword"
            data-testid="stats-search"
            class="h-10 w-full rounded-[10px] border border-line bg-surface pl-9 pr-3 text-xs text-ink-700 outline-none transition placeholder:text-ink-400 focus:border-brand-500"
            placeholder="搜索银行 / 小区名称、品牌或地址"
            @input="searchError = ''"
          />
        </div>

        <select
          v-model="district"
          class="h-10 rounded-[10px] border border-line bg-surface px-3 text-xs text-ink-700 outline-none transition focus:border-brand-500 sm:w-32"
          @change="searchError = ''"
        >
          <option v-for="item in districts" :key="item" :value="item">{{ item }}</option>
        </select>

        <select
          v-model="poiType"
          class="h-10 rounded-[10px] border border-line bg-surface px-3 text-xs text-ink-700 outline-none transition focus:border-brand-500 sm:w-28"
          @change="searchError = ''"
        >
          <option value="all">全部类型</option>
          <option value="bank">银行</option>
          <option value="community">小区</option>
        </select>

        <button
          type="submit"
          data-testid="stats-search-submit"
          class="h-10 shrink-0 rounded-[10px] bg-brand-500 px-5 text-xs font-medium text-white shadow-card transition hover:bg-brand-600"
        >
          搜索
        </button>
      </form>

      <p v-if="searchError" class="mt-2 text-[11px] text-amber-600">{{ searchError }}</p>

      <div
        v-if="recentQueries.length"
        class="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-400"
      >
        <span>最近搜索</span>
        <button
          v-for="item in recentQueries.slice(0, 5)"
          :key="`${item.keyword}-${item.district}-${item.at}`"
          class="rounded-full border border-line bg-surface px-2 py-0.5 text-ink-500 transition hover:border-brand-500/40 hover:text-brand-600"
          @click="applyRecent(item)"
        >
          {{ recentQueryLabel(item) }}
        </button>
        <button class="text-ink-400 transition hover:text-red-500" @click="onClearRecent">
          清空
        </button>
      </div>

      <div
        v-if="hotBrands.length"
        class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-400"
      >
        <span>热门品牌</span>
        <button
          v-for="brand in hotBrands"
          :key="brand.label"
          class="rounded-full bg-surface-soft px-2 py-0.5 text-ink-500 transition hover:bg-brand-50 hover:text-brand-600"
          @click="searchBrand(brand.label)"
        >
          {{ brand.label }}
        </button>
      </div>
    </header>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div
        v-for="card in cards"
        :key="card.label"
        class="rounded-card border border-line bg-surface p-4 shadow-card"
      >
        <div class="flex items-center justify-between">
          <span class="text-xs text-ink-500">{{ card.label }}</span>
          <span
            class="h-2 w-2 rounded-full"
            :class="{
              'bg-brand-500': card.tone === 'brand',
              'bg-mint-500': card.tone === 'mint',
              'bg-amber-500': card.tone === 'amber',
              'bg-ink-400': card.tone === 'ink',
            }"
          />
        </div>
        <p v-if="loading" class="mt-2 h-8 w-16 animate-pulse rounded bg-surface-soft" />
        <p v-else class="mt-1 text-2xl font-semibold tracking-tight text-ink-900">
          {{ card.value.toLocaleString() }}
        </p>
        <p class="mt-0.5 text-[11px] text-ink-400">{{ card.hint }}</p>
      </div>
    </div>

    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      <!-- 区域分布：银行 vs 小区 -->
      <section
        v-if="byDistrict.length"
        data-testid="district-stats"
        class="rounded-card border border-line bg-surface p-5 shadow-card lg:col-span-2"
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-ink-900">区域分布</h2>
          <span class="text-[11px] text-ink-400">按行政区 · 银行 / 小区</span>
        </div>
        <ul class="space-y-2.5">
          <li v-for="row in byDistrict" :key="row.label" class="flex items-center gap-3">
            <span class="w-20 shrink-0 text-xs text-ink-600">{{ row.label }}</span>
            <span class="flex-1 space-y-1">
              <span class="flex items-center gap-2">
                <span class="h-2 flex-1 overflow-hidden rounded-full bg-surface-soft">
                  <span
                    class="block h-full rounded-full bg-brand-500 transition-all duration-500"
                    :style="{ width: `${(row.bank / maxDistrict) * 100}%` }"
                  />
                </span>
                <span class="w-10 text-right text-[11px] tabular-nums text-ink-500">{{
                  row.bank
                }}</span>
              </span>
              <span class="flex items-center gap-2">
                <span class="h-2 flex-1 overflow-hidden rounded-full bg-surface-soft">
                  <span
                    class="block h-full rounded-full bg-amber-500 transition-all duration-500"
                    :style="{ width: `${(row.community / maxDistrict) * 100}%` }"
                  />
                </span>
                <span class="w-10 text-right text-[11px] tabular-nums text-ink-400">{{
                  row.community
                }}</span>
              </span>
            </span>
          </li>
        </ul>
        <div class="mt-3 flex gap-4 text-[11px] text-ink-400">
          <span class="flex items-center gap-1">
            <span class="h-2 w-2 rounded-full bg-brand-500" />银行网点
          </span>
          <span class="flex items-center gap-1">
            <span class="h-2 w-2 rounded-full bg-amber-500" />住宅小区
          </span>
        </div>
      </section>

      <!-- 品牌分布 -->
      <section class="rounded-card border border-line bg-surface p-5 shadow-card">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-ink-900">银行品牌分布</h2>
          <span class="text-[11px] text-ink-400">Top 8</span>
        </div>
        <div v-if="loading" class="space-y-3">
          <div v-for="i in 6" :key="i" class="h-5 animate-pulse rounded bg-surface-soft" />
        </div>
        <ul v-else class="space-y-3">
          <li v-for="brand in stats?.brands" :key="brand.label" class="flex items-center gap-3">
            <span class="w-28 shrink-0 truncate text-xs text-ink-600">{{ brand.label }}</span>
            <span class="h-2 flex-1 overflow-hidden rounded-full bg-surface-soft">
              <span
                class="block h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-all duration-500"
                :style="{ width: `${(brand.value / maxBrand) * 100}%` }"
              />
            </span>
            <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-ink-500">{{
              brand.value
            }}</span>
          </li>
        </ul>
      </section>

      <!-- 均价分布 -->
      <section class="rounded-card border border-line bg-surface p-5 shadow-card">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-ink-900">小区均价分布</h2>
        </div>
        <div v-if="loading" class="h-40 animate-pulse rounded bg-surface-soft" />
        <div v-else class="flex h-40 items-end gap-2">
          <div
            v-for="bucket in stats?.priceBuckets"
            :key="bucket.label"
            class="flex flex-1 flex-col items-center gap-2"
          >
            <span class="text-[11px] tabular-nums text-ink-500">{{ bucket.value }}</span>
            <div
              class="w-full rounded-t-md bg-gradient-to-t from-amber-500/70 to-amber-500 transition-all duration-500"
              :style="{ height: `${Math.max(6, (bucket.value / maxPrice) * 120)}px` }"
            />
            <span class="text-[10px] text-ink-400">{{ bucket.label }}</span>
          </div>
        </div>
      </section>

      <!-- 查询热点：query_log 聚合，前台可见（此前只在运营后台） -->
      <section class="rounded-card border border-line bg-surface p-5 shadow-card">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-ink-900">用户查询热点（2km 网格）</h2>
          <span class="text-[11px] text-ink-400"
            >近 7 天共 {{ hotspots?.totalQueries ?? 0 }} 次查询</span
          >
        </div>
        <ul class="space-y-2">
          <li
            v-for="(item, index) in hotspots?.items ?? []"
            :key="item.grid"
            class="flex items-center gap-3 text-[11px]"
          >
            <span class="w-4 shrink-0 tabular-nums text-ink-300">{{ index + 1 }}</span>
            <span class="min-w-0 flex-1 truncate text-ink-600">
              网格 {{ item.grid
              }}<span v-if="item.zeroResultCount > 0" class="text-amber-600">
                · 空结果 {{ item.zeroResultCount }} 次</span
              >
            </span>
            <span class="shrink-0 tabular-nums text-ink-700">{{ item.queryCount }} 次</span>
          </li>
          <li v-if="!(hotspots?.items ?? []).length" class="text-[11px] text-ink-400">
            暂无查询记录：前台搜索、框选或查看点位后会写入 query_log
          </li>
        </ul>
      </section>

      <!-- 密度排行 -->
      <section class="rounded-card border border-line bg-surface p-5 shadow-card lg:col-span-2">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-sm font-semibold text-ink-900">银行网点最密集的区域</h2>
          </div>
          <span class="shrink-0 text-[11px] text-ink-400">取前 6 名</span>
        </div>
        <ul class="mt-4 grid gap-3 sm:grid-cols-2">
          <li
            v-for="cell in stats?.gridTop"
            :key="cell.label"
            class="flex items-center gap-3 rounded-soft border border-line bg-surface-soft px-3 py-2.5"
          >
            <span
              class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-[11px] font-semibold text-brand-600"
              :title="`${cell.value} 家银行`"
            >
              {{ cell.value }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-[11px] text-ink-600">中心 {{ cell.label }}</span>
              <span class="mt-1 block h-1 overflow-hidden rounded-full bg-white">
                <span
                  class="block h-full rounded-full bg-brand-500/70"
                  :style="{ width: `${(cell.value / maxGrid) * 100}%` }"
                />
              </span>
            </span>
            <span class="shrink-0 text-[10px] text-ink-400">家</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
