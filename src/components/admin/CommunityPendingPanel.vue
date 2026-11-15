<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { fetchCommunityPending, type PendingCommunity } from '@/api/pois'
import CoordinatePicker from '@/components/admin/CoordinatePicker.vue'
import { apiRequest } from '@/api/server'
import { invalidatePoiCache } from '@/api/pois'
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

// ---------- 标注位置（众包坐标） ----------
const pickerOpen = ref(false)
const pickerTarget = ref<PendingCommunity | null>(null)
const pickerHint = ref<{ lng: number; lat: number } | null>(null)
const toast = ref('')

interface SubmissionRow {
  id: number
  pending_id: string
  name: string
  address: string
  district: string
  lng: number
  lat: number
  submitter: string
}

const submissions = ref<SubmissionRow[]>([])

function flash(message: string): void {
  toast.value = message
  setTimeout(() => (toast.value = ''), 2500)
}

async function loadSubmissions(): Promise<void> {
  try {
    submissions.value = await apiRequest<SubmissionRow[]>(
      '/admin/coordinate-submissions?status=pending&limit=20',
    )
  } catch {
    submissions.value = []
  }
}

async function openPicker(item: PendingCommunity): Promise<void> {
  pickerTarget.value = item
  pickerHint.value = null
  try {
    pickerHint.value = await apiRequest<{ lng: number; lat: number }>(
      `/community-pending/hint?district=${encodeURIComponent(item.district)}`,
    )
  } catch {
    pickerHint.value = null
  }
  pickerOpen.value = true
}

async function submitCoordinate(payload: { lng: number; lat: number }): Promise<void> {
  if (!pickerTarget.value) return
  try {
    await apiRequest(
      `/admin/community-pending/${encodeURIComponent(pickerTarget.value.id)}/locate`,
      {
        method: 'POST',
        body: JSON.stringify({ ...payload, note: '管理员标注' }),
      },
    )
    pickerOpen.value = false
    invalidatePoiCache()
    flash('已标注并转正，地图上可搜到该小区')
    await load()
  } catch (cause) {
    flash(cause instanceof Error ? cause.message : '标注失败')
  }
}

async function reviewSubmission(id: number, action: 'approve' | 'reject'): Promise<void> {
  try {
    await apiRequest(`/admin/coordinate-submissions/${id}/${action}`, { method: 'POST' })
    invalidatePoiCache()
    flash(action === 'approve' ? '已通过并转正' : '已驳回')
    await loadSubmissions()
    if (action === 'approve') await load()
  } catch (cause) {
    flash(cause instanceof Error ? cause.message : '操作失败')
  }
}

onMounted(() => {
  void load()
  void loadSubmissions()
})
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

    <p
      v-if="toast"
      data-testid="locate-toast"
      class="mt-3 rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-[11px] text-brand-700"
    >
      {{ toast }}
    </p>

    <!-- 用户提交的坐标待审 -->
    <div
      v-if="submissions.length"
      class="mt-4 rounded-soft border border-amber-200 bg-amber-50/60 p-3"
    >
      <p class="text-[11px] font-medium text-amber-700">
        待审坐标 {{ submissions.length }} 条（用户提交，通过后转正进地图）
      </p>
      <ul class="mt-2 space-y-1.5">
        <li
          v-for="item in submissions"
          :key="item.id"
          class="flex flex-wrap items-center gap-2 text-[11px] text-ink-600"
        >
          <span class="font-medium text-ink-800">{{ item.name }}</span>
          <span class="truncate text-ink-500">{{ item.address }}</span>
          <span class="tabular-nums text-ink-400">{{ item.lng }}, {{ item.lat }}</span>
          <button
            class="rounded border border-brand-300 px-2 py-0.5 text-brand-700 transition hover:bg-brand-50"
            @click="reviewSubmission(item.id, 'approve')"
          >
            通过
          </button>
          <button
            class="rounded border border-line px-2 py-0.5 text-ink-500 transition hover:bg-surface"
            @click="reviewSubmission(item.id, 'reject')"
          >
            驳回
          </button>
        </li>
      </ul>
    </div>

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
              <div class="flex items-center gap-2">
                <button
                  data-testid="pick-location"
                  class="rounded border border-brand-300 px-2 py-0.5 text-brand-700 transition hover:bg-brand-50"
                  @click="openPicker(item)"
                >
                  标注位置
                </button>
                <a
                  :href="amapUrl(item)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-ink-500 hover:text-brand-600 hover:underline"
                  >高德查看</a
                >
              </div>
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
