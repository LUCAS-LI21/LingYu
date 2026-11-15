<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { fetchCommunityPending, type PendingCommunity } from '@/api/pois'
import { SHENZHEN_DISTRICTS } from '@/types/poi'

const items = ref<PendingCommunity[]>([])
const total = ref(0)
const page = ref(1)
const size = 20
const district = ref('全部区域')
const keyword = ref('')
const loading = ref(false)
const error = ref('')

const districts = ['全部区域', ...SHENZHEN_DISTRICTS]
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / size)))

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchCommunityPending({
      district: district.value === '全部区域' ? '' : district.value,
      keyword: keyword.value.trim(),
      page: page.value,
      size,
    })
    items.value = data.items
    total.value = data.total
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '待定位小区加载失败'
  } finally {
    loading.value = false
  }
}

function search(): void {
  page.value = 1
  void load()
}

function turn(delta: number): void {
  const next = page.value + delta
  if (next < 1 || next > pageCount.value) return
  page.value = next
  void load()
}

/** 高德地图外链：地址交给用户在浏览器里打开，我们不解析、不存储坐标 */
function amapUrl(item: PendingCommunity): string {
  const query = item.address || `${item.district}${item.name}`
  return `https://uri.amap.com/search?keyword=${encodeURIComponent(query)}&city=${encodeURIComponent('深圳')}&src=poi-intel`
}

onMounted(load)
</script>

<template>
  <section class="rounded-card border border-line bg-surface p-5 shadow-card">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-ink-900">待定位小区</h2>
        <p class="mt-1 text-[11px] leading-relaxed text-ink-500">
          有名称与地址、缺坐标，暂不进地图 · 点「高德查看」在浏览器里定位（不落库）
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="keyword"
          placeholder="搜索小区名 / 地址"
          class="w-44 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink-700"
          @keyup.enter="search"
        />
        <select
          v-model="district"
          class="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink-700"
          @change="search"
        >
          <option v-for="item in districts" :key="item" :value="item">{{ item }}</option>
        </select>
        <button
          class="rounded-md bg-brand-600 px-3 py-1.5 text-xs text-white transition hover:bg-brand-700"
          @click="search"
        >
          查询
        </button>
      </div>
    </div>

    <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div class="rounded-md bg-surface-soft px-3 py-2">
        <p class="text-[10px] text-ink-400">待定位总数</p>
        <p class="text-lg font-semibold text-ink-900">{{ total.toLocaleString() }}</p>
      </div>
      <div class="rounded-md bg-surface-soft px-3 py-2">
        <p class="text-[10px] text-ink-400">数据来源</p>
        <p class="mt-1 text-[11px] font-medium text-ink-700">物业管理区域基础信息</p>
      </div>
      <div class="rounded-md bg-surface-soft px-3 py-2">
        <p class="text-[10px] text-ink-400">定位方式</p>
        <p class="mt-1 text-[11px] font-medium text-ink-700">高德外链（不存坐标）</p>
      </div>
    </div>

    <p v-if="error" class="mt-3 text-xs text-red-500">{{ error }}</p>

    <div class="mt-4 overflow-x-auto">
      <table class="w-full min-w-[760px] text-left text-xs">
        <thead class="text-[11px] text-ink-400">
          <tr class="border-b border-line">
            <th class="py-2 pr-3 font-medium">小区名称</th>
            <th class="py-2 pr-3 font-medium">地址</th>
            <th class="py-2 pr-3 font-medium">区 / 街道</th>
            <th class="py-2 pr-3 font-medium">类型</th>
            <th class="py-2 font-medium">定位</th>
          </tr>
        </thead>
        <tbody class="text-ink-600">
          <tr v-if="loading">
            <td colspan="5" class="py-6 text-center text-ink-400">加载中…</td>
          </tr>
          <tr v-else-if="items.length === 0">
            <td colspan="5" class="py-6 text-center text-ink-400">没有匹配的待定位小区</td>
          </tr>
          <tr v-for="item in items" v-else :key="item.id" class="border-b border-line/60">
            <td class="max-w-[160px] truncate py-2 pr-3 text-ink-800" :title="item.name">
              {{ item.name }}
            </td>
            <td class="max-w-[280px] truncate py-2 pr-3" :title="item.address">
              {{ item.address || '—' }}
            </td>
            <td class="whitespace-nowrap py-2 pr-3">
              {{ item.district
              }}<span v-if="item.street" class="text-ink-400"> / {{ item.street }}</span>
            </td>
            <td class="whitespace-nowrap py-2 pr-3">{{ item.attribute || '—' }}</td>
            <td class="whitespace-nowrap py-2">
              <a
                :href="amapUrl(item)"
                target="_blank"
                rel="noopener noreferrer"
                class="text-brand-600 hover:underline"
                >高德查看</a
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="mt-3 flex items-center justify-between text-[11px] text-ink-400">
      <span>第 {{ page }} / {{ pageCount }} 页 · 共 {{ total.toLocaleString() }} 条</span>
      <div class="flex gap-2">
        <button
          class="rounded-md border border-line px-2 py-1 transition hover:bg-surface-soft disabled:opacity-40"
          :disabled="page <= 1"
          @click="turn(-1)"
        >
          上一页
        </button>
        <button
          class="rounded-md border border-line px-2 py-1 transition hover:bg-surface-soft disabled:opacity-40"
          :disabled="page >= pageCount"
          @click="turn(1)"
        >
          下一页
        </button>
      </div>
    </div>
  </section>
</template>
