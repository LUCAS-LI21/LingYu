<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { NearbyItem } from '@/api/pois'
import type { BankPoi, Poi } from '@/types/poi'

const props = defineProps<{
  poi: Poi
  nearby: NearbyItem[]
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'locate', poi: Poi): void
  (e: 'feedback', poi: Poi): void
  (e: 'nearby', payload: { poi: Poi; radius: number; branchType: 'all' | 'atm' }): void
}>()

const radius = ref(1000)
const branchType = ref<'all' | 'atm'>('all')
const queried = ref(false)

watch(
  () => props.poi.id,
  () => {
    queried.value = false
  },
)

const isBank = computed(() => props.poi.type === 'bank')
const bank = computed(() => (props.poi.type === 'bank' ? (props.poi as BankPoi) : null))

const rows = computed(() => {
  const poi = props.poi
  if (poi.type === 'bank') {
    return [
      { label: '地址', value: poi.address || '暂无' },
      { label: '类型', value: poi.branchType === 'atm' ? 'ATM 自助银行' : '营业网点' },
      { label: '品牌', value: poi.brand || '暂无' },
      { label: '营业时间', value: poi.openingHours || '待核实' },
      { label: '联系电话', value: poi.phone || '暂无' },
    ]
  }
  return [
    { label: '地址', value: poi.address || '暂无' },
    { label: '建成年份', value: poi.builtYear ? `${poi.builtYear} 年` : '暂无' },
    { label: '参考均价', value: poi.avgPrice ? `${poi.avgPrice.toLocaleString()} 元/㎡` : '暂无' },
    { label: '物业费', value: poi.propertyFee ? `${poi.propertyFee.toFixed(1)} 元/㎡·月` : '暂无' },
  ]
})

function runNearby(): void {
  queried.value = true
  emit('nearby', { poi: props.poi, radius: radius.value, branchType: branchType.value })
}

function queryNearby(type: 'all' | 'atm'): void {
  branchType.value = type
  runNearby()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex items-start gap-3 border-b border-line px-4 py-3.5">
      <span
        class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
        :class="isBank ? 'bg-brand-50 text-brand-600' : 'bg-amber-50 text-amber-600'"
      >
        <svg
          v-if="isBank"
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        >
          <path d="M3 10l9-6 9 6" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M5 10v9M19 10v9M9 19v-5h6v5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M3 19h18" stroke-linecap="round" />
        </svg>
        <svg
          v-else
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        >
          <path d="M4 20V9l8-5 8 5v11" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M9 20v-6h6v6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>

      <div class="min-w-0 flex-1">
        <h2 class="truncate text-sm font-semibold text-ink-900">{{ poi.name }}</h2>
        <p class="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
          <span>{{ isBank ? (bank?.branchType === 'atm' ? 'ATM' : '银行网点') : '小区' }}</span>
          <span class="h-2.5 w-px bg-line-strong" />
          <span>{{ poi.district }}</span>
        </p>
      </div>

      <button
        class="grid h-7 w-7 place-items-center rounded-lg text-ink-400 transition hover:bg-surface-soft hover:text-ink-700"
        aria-label="关闭"
        @click="emit('close')"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
        </svg>
      </button>
    </header>

    <div class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <dl class="space-y-2.5">
        <div v-for="row in rows" :key="row.label" class="flex gap-3 text-xs">
          <dt class="w-16 shrink-0 text-ink-400">{{ row.label }}</dt>
          <dd
            class="min-w-0 flex-1 text-ink-700"
            :class="{ 'text-ink-400': row.value === '暂无' || row.value === '待核实' }"
          >
            {{ row.value }}
          </dd>
        </div>
      </dl>

      <div class="rounded-soft border border-line bg-surface-soft px-3 py-2.5">
        <p class="text-[11px] font-medium text-ink-700">数据来源</p>
        <p class="mt-1 text-[11px] leading-relaxed text-ink-500">
          {{ poi.source }}<span v-if="poi.license"> · {{ poi.license }}</span>
          <template v-if="poi.type === 'community' && poi.demoAttributes">
            <br />
            <span class="text-amber-600">均价/年份为演示数据，不构成投资建议</span>
          </template>
        </p>
      </div>

      <section v-if="poi.type === 'community'" class="space-y-2.5">
        <div class="flex items-center justify-between">
          <p class="text-xs font-medium text-ink-700">周边银行</p>
          <div class="flex rounded-lg border border-line bg-surface-soft p-0.5">
            <button
              v-for="option in [
                { label: '500m', value: 500 },
                { label: '1km', value: 1000 },
                { label: '3km', value: 3000 },
              ]"
              :key="option.value"
              class="rounded-md px-2 py-0.5 text-[10px] transition"
              :class="
                radius === option.value ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500'
              "
              @click="radius = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="flex gap-2">
          <button
            class="flex-1 rounded-lg border border-line bg-surface py-1.5 text-[11px] text-ink-600 transition hover:border-brand-500/50 hover:text-brand-600"
            @click="queryNearby('all')"
          >
            查周边银行
          </button>
          <button
            class="flex-1 rounded-lg border border-line bg-surface py-1.5 text-[11px] text-ink-600 transition hover:border-brand-500/50 hover:text-brand-600"
            @click="queryNearby('atm')"
          >
            只看 ATM
          </button>
        </div>

        <div v-if="queried" class="space-y-1.5">
          <p class="text-[11px] text-ink-400">
            半径 {{ radius >= 1000 ? `${radius / 1000}km` : `${radius}m` }} 内共
            <span class="font-medium text-ink-700">{{ nearby.length }}</span> 个结果
          </p>
          <div
            v-if="nearby.length === 0"
            class="rounded-soft border border-dashed border-line-strong px-3 py-4"
          >
            <p class="text-[11px] text-ink-500">该区域本地库暂无数据</p>
            <button
              class="mt-2 text-[11px] font-medium text-brand-600 hover:underline"
              @click="emit('feedback', poi)"
            >
              请求补充采集
            </button>
          </div>
          <button
            v-for="item in nearby.slice(0, 6)"
            :key="item.poi.id"
            class="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left transition hover:border-brand-500/40"
            @click="emit('locate', item.poi)"
          >
            <span class="min-w-0 flex-1 truncate text-[11px] text-ink-700">{{
              item.poi.name
            }}</span>
            <span class="shrink-0 text-[10px] text-ink-400">
              {{
                item.distance < 1000
                  ? `${Math.round(item.distance)}m`
                  : `${(item.distance / 1000).toFixed(1)}km`
              }}
            </span>
          </button>
        </div>
      </section>
    </div>

    <footer class="flex gap-2 border-t border-line px-4 py-3">
      <button
        class="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-surface py-2 text-xs text-ink-600 transition hover:border-brand-500/50 hover:text-brand-600"
        @click="emit('feedback', poi)"
      >
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        >
          <path
            d="M12 9v4m0 4h.01M10.3 3.9L2.5 17a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        提交纠错
      </button>
      <button
        class="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-brand-500 py-2 text-xs font-medium text-white shadow-card transition hover:bg-brand-600"
        @click="emit('locate', poi)"
      >
        地图定位
      </button>
    </footer>
  </div>
</template>
