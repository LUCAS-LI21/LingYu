<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  fetchHotspots,
  fetchOverview,
  recomputeHotspots,
  type AdminOverview,
  type HotspotRow,
} from '@/api/admin'

const emit = defineEmits<{ (e: 'unauthorized'): void }>()

const hotspots = ref<HotspotRow[]>([])
const overview = ref<AdminOverview | null>(null)
const loading = ref(false)
const autoRefresh = ref(true)
const lastUpdated = ref('')
const error = ref('')

const POLL_MS = 10_000
let timer: number | null = null
let inFlight = false

const latestDate = computed(() => hotspots.value[0]?.statDate ?? '')
const latestRows = computed(() =>
  hotspots.value.filter((item) => item.statDate === latestDate.value),
)
const totalQueries = computed(() =>
  latestRows.value.reduce((sum, item) => sum + item.queryCount, 0),
)
const zeroQueries = computed(() =>
  latestRows.value.reduce((sum, item) => sum + item.zeroResultCount, 0),
)
const maxQuery = computed(() => Math.max(1, ...latestRows.value.map((item) => item.queryCount)))
const pendingFeedback = computed(() => overview.value?.pendingFeedback ?? 0)
const topGrid = computed(() => latestRows.value[0] ?? null)

function clockNow(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function handleError(cause: unknown): void {
  const message = cause instanceof Error ? cause.message : '查询行为加载失败'
  if (message.includes('登录')) {
    emit('unauthorized')
    return
  }
  error.value = message
}

async function refresh(showSpinner = true): Promise<void> {
  if (inFlight) return
  inFlight = true
  if (showSpinner) loading.value = true
  error.value = ''
  try {
    // 先按 query_log 重算热点，再取聚合结果；这样新查询 10s 内即可看到
    await recomputeHotspots()
    const [rows, ov] = await Promise.all([fetchHotspots(), fetchOverview()])
    hotspots.value = rows
    overview.value = ov
    lastUpdated.value = clockNow()
  } catch (cause) {
    handleError(cause)
  } finally {
    inFlight = false
    loading.value = false
  }
}

function stopPolling(): void {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

function startPolling(): void {
  stopPolling()
  if (!autoRefresh.value) return
  timer = window.setInterval(() => {
    if (document.visibilityState !== 'hidden') void refresh(false)
  }, POLL_MS)
}

watch(autoRefresh, () => {
  if (autoRefresh.value) {
    void refresh(false)
    startPolling()
    return
  }
  stopPolling()
})

onMounted(() => {
  void refresh()
  startPolling()
})

onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="space-y-4">
    <div class="rounded-card border border-line bg-surface shadow-card">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div class="flex flex-wrap items-center gap-2">
          <span class="relative flex h-2 w-2">
            <span
              class="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint-500 opacity-60"
            />
            <span class="relative inline-flex h-2 w-2 rounded-full bg-mint-500" />
          </span>
          <p class="text-sm font-semibold text-ink-900">查询行为（实时聚合）</p>
          <span class="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] text-brand-600">
            每 10 秒重算
          </span>
          <span v-if="lastUpdated" class="text-[11px] text-ink-400">
            · 更新于 {{ lastUpdated }}
          </span>
        </div>
        <div class="flex items-center gap-3">
          <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-500">
            <input
              v-model="autoRefresh"
              data-testid="behavior-auto"
              type="checkbox"
              class="h-3.5 w-3.5 rounded border-line accent-brand-500"
            />
            自动刷新
          </label>
          <button
            data-testid="behavior-refresh"
            class="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-600 transition hover:border-brand-500/50 hover:text-brand-600 disabled:opacity-50"
            :disabled="loading"
            @click="refresh()"
          >
            {{ loading ? '重算中…' : '立即重算' }}
          </button>
        </div>
      </div>

      <div class="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-soft border border-line bg-surface-soft p-3">
          <p class="text-[11px] text-ink-500">热点网格</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-ink-900">
            {{ latestRows.length }}
          </p>
          <p class="mt-0.5 text-[10px] text-ink-400">最新统计日有查询的区域</p>
        </div>
        <div class="rounded-soft border border-line bg-surface-soft p-3">
          <p class="text-[11px] text-ink-500">查询总量</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-ink-900">
            {{ totalQueries.toLocaleString() }}
          </p>
          <p class="mt-0.5 text-[10px] text-ink-400">query_log 聚合次数</p>
        </div>
        <div class="rounded-soft border border-line bg-surface-soft p-3">
          <p class="text-[11px] text-ink-500">零结果查询</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-amber-600">
            {{ zeroQueries.toLocaleString() }}
          </p>
          <p class="mt-0.5 text-[10px] text-ink-400">优先补采的强信号</p>
        </div>
        <div class="rounded-soft border border-line bg-surface-soft p-3">
          <p class="text-[11px] text-ink-500">待审核反馈</p>
          <p class="mt-1 text-xl font-semibold tabular-nums text-brand-600">
            {{ pendingFeedback }}
          </p>
          <p class="mt-0.5 text-[10px] text-ink-400">与反馈队列同步</p>
        </div>
      </div>

      <p
        v-if="error"
        class="mx-4 mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600"
      >
        {{ error }}
      </p>
    </div>

    <div class="rounded-card border border-line bg-surface shadow-card">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <p class="text-sm font-semibold text-ink-900">热门查询区域</p>
          <p class="mt-0.5 text-[11px] text-ink-400">
            按「查询次数 + 2 × 零结果次数」排序，用于优先更新数据（FR-O-01）
          </p>
        </div>
        <p v-if="topGrid" class="text-[11px] text-ink-400">
          {{ latestDate }} · Top 1：<span class="font-medium text-ink-700">{{ topGrid.grid }}</span>
        </p>
      </div>

      <div v-if="loading && latestRows.length === 0" class="space-y-2 px-4 py-4">
        <div v-for="i in 5" :key="i" class="h-12 animate-pulse rounded-soft bg-surface-soft" />
      </div>

      <div v-else-if="latestRows.length === 0" class="px-4 py-14 text-center text-xs text-ink-400">
        暂无查询记录：用户在前台搜索、框选或查看点位后，会写入 query_log 并聚合到这里
      </div>

      <ul v-else class="divide-y divide-line">
        <li
          v-for="(item, index) in latestRows"
          :key="`${item.grid}-${item.statDate}`"
          class="flex flex-wrap items-center gap-3 px-4 py-3"
        >
          <span
            class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-[11px] font-medium text-brand-600"
          >
            {{ index + 1 }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-xs font-medium text-ink-900">{{ item.grid }}</p>
              <span class="text-[10px] text-ink-400">{{ item.statDate }}</span>
              <span
                class="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600"
              >
                优先级 {{ item.priority }}
              </span>
            </div>
            <span class="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-soft">
              <span
                class="block h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600"
                :style="{ width: `${Math.max(4, (item.queryCount / maxQuery) * 100)}%` }"
              />
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-3 text-[11px]">
            <span class="text-ink-500">查询 {{ item.queryCount }}</span>
            <span class="text-amber-600">零结果 {{ item.zeroResultCount }}</span>
            <span class="text-ink-400">{{ item.updatedAt }}</span>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
