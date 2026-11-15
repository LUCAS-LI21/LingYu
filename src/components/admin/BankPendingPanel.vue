<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { apiRequest } from '@/api/server'
import { invalidatePoiCache } from '@/api/pois'
import CoordinatePicker from '@/components/admin/CoordinatePicker.vue'

/** 待定位网点：有名称地址、缺坐标（兴业 50 条 + 用户反馈新增的网点） */
interface PendingBank {
  id: number
  name: string
  address: string
  phone: string
  openingHours: string
  district: string
  source: string
  status: string
  createdAt: string
}

const items = ref<PendingBank[]>([])
const loading = ref(false)
const error = ref('')
const toast = ref('')
const pickerOpen = ref(false)
const pickerTarget = ref<PendingBank | null>(null)
const pickerHint = ref<{ lng: number; lat: number } | null>(null)
const submitting = ref(false)

const pendingCount = computed(() => items.value.filter((item) => item.status === 'pending').length)

function flash(message: string): void {
  toast.value = message
  setTimeout(() => (toast.value = ''), 3000)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const rows = await apiRequest<Array<Record<string, unknown>>>(
      '/admin/pending?status=pending&limit=200',
    )
    items.value = (Array.isArray(rows) ? rows : []).map((row) => ({
      id: Number(row.id),
      name: String(row.name ?? ''),
      address: String(row.address ?? ''),
      phone: String(row.phone ?? ''),
      openingHours: String(row.opening_hours ?? ''),
      district: String(row.district ?? ''),
      source: String(row.source ?? ''),
      status: String(row.status ?? ''),
      createdAt: String(row.created_at ?? ''),
    }))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '待定位网点加载失败'
  } finally {
    loading.value = false
  }
}

async function openPicker(row: PendingBank): Promise<void> {
  pickerTarget.value = row
  pickerHint.value = null
  try {
    pickerHint.value = await apiRequest<{ lng: number; lat: number }>(
      `/community-pending/hint?district=${encodeURIComponent(row.district)}`,
    )
  } catch {
    pickerHint.value = null
  }
  pickerOpen.value = true
}

/** 确认坐标后调用 promote：写 poi_bank 并把这行标成 geocoded */
async function submitCoordinate(payload: { lng: number; lat: number }): Promise<void> {
  if (!pickerTarget.value) return
  submitting.value = true
  try {
    await apiRequest(
      `/admin/pending/${pickerTarget.value.id}/promote?lng=${payload.lng}&lat=${payload.lat}`,
      { method: 'POST' },
    )
    invalidatePoiCache()
    pickerOpen.value = false
    flash(`「${pickerTarget.value.name}」已转正，地图上可搜到`)
    await load()
  } catch (cause) {
    flash(cause instanceof Error ? cause.message : '转正失败')
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="rounded-card border border-line bg-surface p-5 shadow-card">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-ink-900">待定位网点</h2>
        <p class="mt-1 text-[11px] leading-relaxed text-ink-500">
          有名称地址、缺坐标的银行网点（兴业官网 + 用户反馈新增）· 标注位置后转正进地图
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="rounded-md border border-line px-3 py-1.5 text-xs text-ink-600 transition hover:bg-surface-soft"
          @click="load"
        >
          刷新
        </button>
      </div>
    </div>

    <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div class="rounded-md bg-surface-soft px-3 py-2">
        <p class="text-[10px] text-ink-400">待定位网点</p>
        <p class="text-lg font-semibold text-ink-900">{{ pendingCount }}</p>
      </div>
      <div class="rounded-md bg-surface-soft px-3 py-2">
        <p class="text-[10px] text-ink-400">数据来源</p>
        <p class="mt-1 text-[11px] font-medium text-ink-700">官网 / 用户反馈</p>
      </div>
      <div class="rounded-md bg-surface-soft px-3 py-2">
        <p class="text-[10px] text-ink-400">转正后去向</p>
        <p class="mt-1 text-[11px] font-medium text-ink-700">poi_bank（来源=管理员标注）</p>
      </div>
    </div>

    <p v-if="error" class="mt-3 text-xs text-red-500">{{ error }}</p>
    <p
      v-if="toast"
      data-testid="bank-pending-toast"
      class="mt-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-[11px] text-brand-700"
    >
      {{ toast }}
    </p>

    <div class="mt-4 overflow-x-auto">
      <table class="w-full min-w-[760px] text-left text-xs">
        <thead class="text-[11px] text-ink-400">
          <tr class="border-b border-line">
            <th class="py-2 pr-3 font-medium">网点名称</th>
            <th class="py-2 pr-3 font-medium">地址</th>
            <th class="py-2 pr-3 font-medium">电话</th>
            <th class="py-2 pr-3 font-medium">来源</th>
            <th class="py-2 font-medium">操作</th>
          </tr>
        </thead>
        <tbody class="text-ink-600">
          <tr v-if="loading">
            <td colspan="5" class="py-6 text-center text-ink-400">加载中…</td>
          </tr>
          <tr v-else-if="items.length === 0">
            <td colspan="5" class="py-6 text-center text-ink-400">没有待定位网点</td>
          </tr>
          <tr v-for="item in items" v-else :key="item.id" class="border-b border-line/60">
            <td class="max-w-[200px] truncate py-2 pr-3 text-ink-800" :title="item.name">
              {{ item.name }}
            </td>
            <td class="max-w-[280px] truncate py-2 pr-3" :title="item.address">
              {{ item.address || '—' }}
            </td>
            <td class="whitespace-nowrap py-2 pr-3">{{ item.phone || '—' }}</td>
            <td class="max-w-[140px] truncate py-2 pr-3" :title="item.source">{{ item.source }}</td>
            <td class="whitespace-nowrap py-2">
              <button
                data-testid="pick-bank-location"
                class="rounded border border-brand-300 px-2 py-0.5 text-brand-700 transition hover:bg-brand-50"
                @click="openPicker(item)"
              >
                标注位置并转正
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <CoordinatePicker
      :open="pickerOpen"
      :name="pickerTarget?.name ?? ''"
      :address="pickerTarget?.address ?? ''"
      :district="pickerTarget?.district ?? ''"
      :hint="pickerHint"
      @close="pickerOpen = false"
      @submit="submitCoordinate"
    />
  </section>
</template>
