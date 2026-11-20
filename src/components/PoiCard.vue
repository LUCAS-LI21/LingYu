<script setup lang="ts">
import { computed } from 'vue'

import type { Poi } from '@/types/poi'

const props = withDefaults(
  defineProps<{
    poi: Poi
    active?: boolean
    distance?: number
    /** 列表页用更舒展的排版，地图侧栏保持紧凑 */
    size?: 'compact' | 'list'
  }>(),
  { size: 'compact' },
)

const isBank = computed(() => props.poi.type === 'bank')
const isList = computed(() => props.size === 'list')
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
    // 只展示后端真实成交参考价；没有就留空，不再展示哈希生成的演示价
    p.avgPrice ? `${p.avgPrice.toLocaleString()} 元/㎡` : '',
  ]
  return parts.filter(Boolean).join(' · ')
})
</script>

<template>
  <button
    type="button"
    data-testid="poi-card"
    class="group flex w-full items-start rounded-soft border bg-surface text-left transition-all duration-150"
    :class="[
      isList ? 'gap-4 p-4' : 'gap-3 p-3',
      active
        ? 'border-brand-500/70 shadow-card ring-1 ring-brand-500/10'
        : 'border-line hover:-translate-y-px hover:border-line-strong hover:shadow-card',
    ]"
  >
    <span
      class="mt-0.5 grid shrink-0 place-items-center"
      :class="[
        isList ? 'h-11 w-11 rounded-xl' : 'h-9 w-9 rounded-[10px]',
        isBank ? 'bg-brand-50 text-brand-600' : 'bg-amber-50 text-amber-600',
      ]"
    >
      <svg
        v-if="isBank"
        :class="isList ? 'h-5 w-5' : 'h-4 w-4'"
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
        :class="isList ? 'h-5 w-5' : 'h-4 w-4'"
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
        <span
          class="truncate font-medium text-ink-900"
          :class="isList ? 'text-[15px]' : 'text-[13px]'"
        >
          {{ poi.name }}
        </span>
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
        v-if="poi.address"
        class="block truncate"
        :class="[isList ? 'mt-1.5 text-sm' : 'mt-1 text-xs', 'text-ink-500']"
      >
        {{ poi.address }}
      </span>

      <span
        class="flex items-center gap-2 text-ink-400"
        :class="isList ? 'mt-2 text-xs' : 'mt-1 text-[11px]'"
      >
        <span>{{ poi.district }}</span>
        <span
          v-if="poi.type === 'bank' && !poi.address"
          class="shrink-0 tabular-nums text-ink-400/80"
        >
          #{{ poi.id.slice(-4) }}
        </span>
        <span v-if="subtitle" class="truncate">{{ subtitle }}</span>
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
