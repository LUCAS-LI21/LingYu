<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { buildStats, loadPois, statsFromServer, type Stats } from '@/api/pois'

const stats = ref<Stats | null>(null)
const loading = ref(true)

onMounted(async () => {
  // 后端在线用后端聚合（SQL GROUP BY），否则用本地统计兜底
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
</script>

<template>
  <div class="mx-auto w-full max-w-[1200px] px-4 py-6">
    <header class="mb-5">
      <h1 class="text-xl font-semibold tracking-tight text-ink-900">数据洞察</h1>
      <p class="mt-1 text-xs text-ink-500">基于本地库统计，随数据采集自动更新</p>
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
          <span class="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-600"
            >演示属性</span
          >
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
        <p class="mt-3 text-[11px] leading-relaxed text-ink-400">
          OSM 不提供均价字段，图为按名称哈希生成的稳定演示值，仅用于演示图表能力。
        </p>
      </section>

      <!-- 密度排行 -->
      <section class="rounded-card border border-line bg-surface p-5 shadow-card lg:col-span-2">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-ink-900">银行密度热点（2km 网格）</h2>
          <span class="text-[11px] text-ink-400">用于驱动采集优先级</span>
        </div>
        <ul class="grid gap-3 sm:grid-cols-2">
          <li
            v-for="cell in stats?.gridTop"
            :key="cell.label"
            class="flex items-center gap-3 rounded-soft border border-line bg-surface-soft px-3 py-2"
          >
            <span
              class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-[11px] font-medium text-brand-600"
            >
              {{ cell.value }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-[11px] text-ink-600">{{ cell.label }}</span>
              <span class="mt-1 block h-1 overflow-hidden rounded-full bg-white">
                <span
                  class="block h-full rounded-full bg-brand-500/70"
                  :style="{ width: `${(cell.value / maxGrid) * 100}%` }"
                />
              </span>
            </span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
