<script setup lang="ts">
import { computed } from 'vue'

import { DEFAULT_FILTERS, SHENZHEN_DISTRICTS, type Filters } from '@/types/poi'

const filters = defineModel<Filters>({ required: true })
const props = defineProps<{ total: number }>()
const emit = defineEmits<{ (e: 'reset'): void }>()

const districts = ['全部区域', ...SHENZHEN_DISTRICTS]

const priceOptions = [
  { label: '不限', value: null },
  { label: '5 万以下', value: [0, 50000] },
  { label: '5–7 万', value: [50000, 70000] },
  { label: '7–9 万', value: [70000, 90000] },
  { label: '9–11 万', value: [90000, 110000] },
  { label: '11 万以上', value: [110000, 999999] },
] as const

const yearOptions = [
  { label: '不限', value: null },
  { label: '2015 年后', value: [2015, 2030] },
  { label: '2010–2015', value: [2010, 2015] },
  { label: '2005–2010', value: [2005, 2010] },
  { label: '2005 年前', value: [1990, 2005] },
] as const

const priceKey = computed(() => JSON.stringify(filters.value.priceRange))
const yearKey = computed(() => JSON.stringify(filters.value.yearRange))

function toggleLayer(layer: 'bank' | 'community'): void {
  const next = filters.value.layers.includes(layer)
    ? filters.value.layers.filter((item) => item !== layer)
    : [...filters.value.layers, layer]
  filters.value.layers = next.length ? next : [layer]
}

function setPrice(value: string): void {
  filters.value.priceRange = JSON.parse(value) as Filters['priceRange']
}

function setYear(value: string): void {
  filters.value.yearRange = JSON.parse(value) as Filters['yearRange']
}

function reset(): void {
  filters.value = JSON.parse(JSON.stringify(DEFAULT_FILTERS)) as Filters
  emit('reset')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between pb-3">
      <h2 class="text-sm font-semibold text-ink-900">筛选</h2>
      <button class="text-xs text-ink-400 transition hover:text-brand-600" @click="reset">
        重置
      </button>
    </div>

    <div class="space-y-5 overflow-y-auto pr-0.5">
      <section>
        <p class="mb-2 text-[11px] font-medium tracking-wide text-ink-400">图层</p>
        <div class="grid grid-cols-2 gap-2">
          <button
            class="flex items-center justify-center gap-1.5 rounded-[10px] border py-2 text-xs font-medium transition"
            :class="
              filters.layers.includes('bank')
                ? 'border-brand-500/60 bg-brand-50 text-brand-600 shadow-card'
                : 'border-line bg-surface text-ink-500 hover:border-line-strong'
            "
            @click="toggleLayer('bank')"
          >
            <span class="h-2 w-2 rounded-full bg-brand-500" />
            银行
          </button>
          <button
            class="flex items-center justify-center gap-1.5 rounded-[10px] border py-2 text-xs font-medium transition"
            :class="
              filters.layers.includes('community')
                ? 'border-amber-500/50 bg-amber-50 text-amber-600 shadow-card'
                : 'border-line bg-surface text-ink-500 hover:border-line-strong'
            "
            @click="toggleLayer('community')"
          >
            <span class="h-2 w-2 rounded-full bg-amber-500" />
            小区
          </button>
        </div>
      </section>

      <section>
        <p class="mb-2 text-[11px] font-medium tracking-wide text-ink-400">区域</p>
        <div class="relative">
          <select
            v-model="filters.district"
            class="w-full appearance-none rounded-[10px] border border-line bg-surface px-3 py-2 text-xs text-ink-700 outline-none transition focus:border-brand-500"
          >
            <option v-for="district in districts" :key="district" :value="district">
              {{ district }}
            </option>
          </select>
          <svg
            class="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
      </section>

      <section>
        <p
          class="mb-2 flex items-center justify-between text-[11px] font-medium tracking-wide text-ink-400"
        >
          <span>银行类型</span>
          <span class="font-normal">地图同一时间只显示一种</span>
        </p>
        <div class="flex rounded-[10px] border border-line bg-surface-soft p-0.5">
          <button
            v-for="option in [
              { label: '网点', value: 'branch' },
              { label: 'ATM', value: 'atm' },
            ]"
            :key="option.value"
            class="flex-1 rounded-lg py-1.5 text-[11px] transition"
            :class="
              filters.branchType === option.value
                ? 'bg-surface font-medium text-ink-900 shadow-card'
                : 'text-ink-500 hover:text-ink-700'
            "
            @click="filters.branchType = option.value as Filters['branchType']"
          >
            {{ option.label }}
          </button>
        </div>
      </section>

      <section>
        <p class="mb-2 text-[11px] font-medium tracking-wide text-ink-400">
          小区均价<span class="ml-1 text-[10px] font-normal text-amber-600">演示</span>
        </p>
        <div class="relative">
          <select
            :value="priceKey"
            class="w-full appearance-none rounded-[10px] border border-line bg-surface px-3 py-2 text-xs text-ink-700 outline-none transition focus:border-brand-500"
            @change="setPrice(($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="option in priceOptions"
              :key="option.label"
              :value="JSON.stringify(option.value)"
            >
              {{ option.label }}
            </option>
          </select>
          <svg
            class="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
      </section>

      <section>
        <p class="mb-2 text-[11px] font-medium tracking-wide text-ink-400">建成年份</p>
        <div class="relative">
          <select
            :value="yearKey"
            class="w-full appearance-none rounded-[10px] border border-line bg-surface px-3 py-2 text-xs text-ink-700 outline-none transition focus:border-brand-500"
            @change="setYear(($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="option in yearOptions"
              :key="option.label"
              :value="JSON.stringify(option.value)"
            >
              {{ option.label }}
            </option>
          </select>
          <svg
            class="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
      </section>
    </div>

    <div class="mt-4 border-t border-line pt-3 text-[11px] text-ink-400">
      当前命中 <span class="font-medium text-ink-700">{{ props.total }}</span> 个点位
    </div>
  </div>
</template>
