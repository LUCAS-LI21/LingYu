<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { fetchLandParcels, type LandParcel } from '@/api/pois'
import { SHENZHEN_DISTRICTS } from '@/types/poi'

const items = ref<LandParcel[]>([])
const total = ref(0)
const district = ref('全部区域')
const loading = ref(false)
const error = ref('')

const districts = ['全部区域', ...SHENZHEN_DISTRICTS]

const totalArea = computed(() => items.value.reduce((sum, item) => sum + (item.areaHa ?? 0), 0))

const housingTypes = computed(() => {
  const map = new Map<string, number>()
  for (const item of items.value) {
    const key = item.housingType || '未标注'
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchLandParcels(district.value === '全部区域' ? '' : district.value, 100)
    items.value = data.items
    total.value = data.total
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '存量用地加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="rounded-card border border-line bg-surface p-5 shadow-card">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-ink-900">存量住宅用地</h2>
        <p class="mt-1 text-[11px] leading-relaxed text-ink-500">
          政府开放数据（宗地级）· 与 POI 是两套语义，单独存放，不参与地图展示
        </p>
      </div>
      <div class="flex items-center gap-2">
        <select
          v-model="district"
          class="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink-700"
          @change="load"
        >
          <option v-for="item in districts" :key="item" :value="item">{{ item }}</option>
        </select>
        <button
          class="rounded-md border border-line px-3 py-1.5 text-xs text-ink-600 transition hover:bg-surface-soft"
          @click="load"
        >
          刷新
        </button>
      </div>
    </div>

    <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div class="rounded-md bg-surface-soft px-3 py-2">
        <p class="text-[10px] text-ink-400">宗地总数</p>
        <p class="text-lg font-semibold text-ink-900">{{ total.toLocaleString() }}</p>
      </div>
      <div class="rounded-md bg-surface-soft px-3 py-2">
        <p class="text-[10px] text-ink-400">当前列表</p>
        <p class="text-lg font-semibold text-ink-900">{{ items.length }}</p>
      </div>
      <div class="rounded-md bg-surface-soft px-3 py-2">
        <p class="text-[10px] text-ink-400">合计面积</p>
        <p class="text-lg font-semibold text-ink-900">{{ totalArea.toFixed(1) }} ha</p>
      </div>
      <div class="rounded-md bg-surface-soft px-3 py-2">
        <p class="text-[10px] text-ink-400">住房类型</p>
        <p class="text-lg font-semibold text-ink-900">{{ housingTypes.length }}</p>
      </div>
    </div>

    <p v-if="error" class="mt-3 text-xs text-red-500">{{ error }}</p>

    <div class="mt-4 overflow-x-auto">
      <table class="w-full min-w-[720px] text-left text-xs">
        <thead class="text-[11px] text-ink-400">
          <tr class="border-b border-line">
            <th class="py-2 pr-3 font-medium">宗地号</th>
            <th class="py-2 pr-3 font-medium">位置</th>
            <th class="py-2 pr-3 font-medium">街道</th>
            <th class="py-2 pr-3 text-right font-medium">面积(ha)</th>
            <th class="py-2 pr-3 font-medium">住房类型</th>
            <th class="py-2 pr-3 font-medium">状态</th>
            <th class="py-2 font-medium">建设单位</th>
          </tr>
        </thead>
        <tbody class="text-ink-600">
          <tr v-if="loading">
            <td colspan="7" class="py-6 text-center text-ink-400">加载中…</td>
          </tr>
          <tr v-else-if="items.length === 0">
            <td colspan="7" class="py-6 text-center text-ink-400">该区域暂无宗地数据</td>
          </tr>
          <tr v-for="item in items" v-else :key="item.id" class="border-b border-line/60">
            <td class="py-2 pr-3 font-mono text-[11px] text-ink-500">{{ item.id }}</td>
            <td class="max-w-[220px] truncate py-2 pr-3" :title="item.location">
              {{ item.location || '—' }}
            </td>
            <td class="py-2 pr-3 whitespace-nowrap">{{ item.districtStreet || '—' }}</td>
            <td class="py-2 pr-3 text-right tabular-nums">
              {{ item.areaHa === null ? '—' : item.areaHa.toFixed(2) }}
            </td>
            <td class="py-2 pr-3 whitespace-nowrap">{{ item.housingType || '—' }}</td>
            <td class="py-2 pr-3 whitespace-nowrap">{{ item.buildStatus || '—' }}</td>
            <td class="max-w-[180px] truncate py-2" :title="item.developer">
              {{ item.developer || '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="mt-3 text-[10px] text-ink-400">
      数据来源：深圳市政府数据开放平台 29200/00303565 · 共 {{ total }} 宗，列表按供地时间倒序
    </p>
  </section>
</template>
