<script setup lang="ts">
import { computed } from 'vue'

import type { Poi } from '@/types/poi'

const props = defineProps<{
  poi: Poi
  active?: boolean
  distance?: number
}>()

const isBank = computed(() => props.poi.type === 'bank')
const distanceText = computed(() => {
  if (props.distance === undefined) return ''
  return props.distance < 1000
    ? `${Math.round(props.distance)} m`
    : `${(props.distance / 1000).toFixed(1)} km`
})

const subtitle = computed(() => {
  const p = props.poi
  if (p.type === 'bank') {
    return [p.brand && p.brand !== p.name ? p.brand : '', p.openingHours]
      .filter(Boolean)
      .join(' · ')
  }
  const parts = [
    p.builtYear ? `${p.builtYear} 年` : '',
    p.avgPrice ? `${p.avgPrice.toLocaleString()} 元/㎡` : '',
  ]
  return parts.filter(Boolean).join(' · ')
})
</script>

<template>
  <button
    type="button"
    data-testid="poi-card"
    class="group flex w-full items-start gap-3 rounded-soft border bg-surface p-3 text-left transition-all duration-150"
    :class="
      active
        ? 'border-brand-500/70 shadow-card ring-1 ring-brand-500/10'
        : 'border-line hover:-translate-y-px hover:border-line-strong hover:shadow-card'
    "
  >
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

    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-1.5">
        <span class="truncate text-[13px] font-medium text-ink-900">{{ poi.name }}</span>
        <span
          v-if="poi.type === 'bank' && poi.branchType === 'atm'"
          class="shrink-0 rounded border border-line px-1 text-[10px] leading-4 text-ink-500"
        >
          ATM
        </span>
        <span
          v-if="distanceText"
          class="shrink-0 rounded bg-brand-50 px-1 text-[10px] leading-4 text-brand-600"
        >
          {{ distanceText }}
        </span>
      </span>

      <span
        class="mt-1 block truncate text-xs"
        :class="poi.address ? 'text-ink-500' : 'text-ink-400/70'"
      >
        {{ poi.address || '地址待补充' }}
      </span>

      <span class="mt-1 flex items-center gap-2 text-[11px] text-ink-400">
        <span>{{ poi.district }}</span>
        <span
          v-if="poi.type === 'bank' && !poi.address"
          class="shrink-0 tabular-nums text-ink-400/80"
        >
          #{{ poi.id.slice(-4) }}
        </span>
        <span v-if="subtitle" class="truncate">{{ subtitle }}</span>
        <!-- 均价已有官方参考价时不再标「演示属性」，否则会误导；其余字段的演示标识在详情页说明 -->
        <span
          v-if="
            poi.type === 'community' && poi.demoAttributes && poi.avgPriceSource !== 'gov_reference'
          "
          class="shrink-0 text-amber-600"
        >
          演示属性
        </span>
      </span>
    </span>

    <svg
      class="mt-2 h-3.5 w-3.5 shrink-0 text-ink-400 opacity-0 transition group-hover:opacity-100"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M9 18l6-6-6-6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>
</template>
