<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  approveFeedback,
  fetchFeedback,
  fetchHotspots,
  fetchJobs,
  fetchOverview,
  recomputeHotspots,
  rejectFeedback,
  triggerJob,
  type AdminOverview,
  type FeedbackRow,
  type HotspotRow,
  type JobRow,
} from '@/api/admin'
import { isServerMode } from '@/api/pois'
import { clearToken, isLoggedIn, login } from '@/api/auth'
import { toast } from '@/lib/toast'

type Tab = 'overview' | 'feedback' | 'jobs' | 'hotspots'

const tab = ref<Tab>('overview')
const online = ref<boolean | null>(null)
const authed = ref(isLoggedIn())
const username = ref('operator')
const password = ref('')
const loggingIn = ref(false)
const loginError = ref('')
const loading = ref(false)
const overview = ref<AdminOverview | null>(null)
const feedback = ref<FeedbackRow[]>([])
const feedbackStatus = ref<'pending' | 'approved' | 'rejected' | 'all'>('pending')
const jobs = ref<JobRow[]>([])
const hotspots = ref<HotspotRow[]>([])
const busy = ref('')

async function onLogin(): Promise<void> {
  loggingIn.value = true
  loginError.value = ''
  try {
    await login(username.value.trim(), password.value)
    authed.value = true
    toast('登录成功', 'success')
    await refresh()
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : '登录失败'
  } finally {
    loggingIn.value = false
  }
}

function onLogout(): void {
  clearToken()
  authed.value = false
  password.value = ''
}

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'feedback', label: '反馈审核' },
  { key: 'jobs', label: '抓取任务' },
  { key: 'hotspots', label: '热点' },
]

const kpis = computed(() => [
  {
    label: '待审核反馈',
    value: overview.value?.pendingFeedback ?? 0,
    hint: `累计 ${overview.value?.totalFeedback ?? 0} 条`,
    tone: overview.value?.pendingFeedback ? 'amber' : 'ink',
  },
  {
    label: '抓取任务',
    value: overview.value?.totalJobs ?? 0,
    hint: `成功 ${overview.value?.successJobs ?? 0} / 失败 ${overview.value?.failedJobs ?? 0}`,
    tone: 'brand',
  },
  {
    label: '数据版本',
    value: overview.value?.versions ?? 0,
    hint: '变更留痕条数',
    tone: 'mint',
  },
  {
    label: '平均新鲜度',
    value: overview.value?.avgFreshHours ?? 0,
    hint: '小时（越低越新）',
    tone: 'ink',
  },
])

const statusStyle: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-600 border-amber-200',
  approved: 'bg-mint-50 text-mint-600 border-mint-500/25',
  rejected: 'bg-red-50 text-red-500 border-red-200',
  need_refetch: 'bg-brand-50 text-brand-600 border-brand-500/25',
  auto_applied: 'bg-surface-soft text-ink-500 border-line',
  success: 'bg-mint-50 text-mint-600 border-mint-500/25',
  partial: 'bg-amber-50 text-amber-600 border-amber-200',
  failed: 'bg-red-50 text-red-500 border-red-200',
  running: 'bg-brand-50 text-brand-600 border-brand-500/25',
  pending_job: 'bg-surface-soft text-ink-500 border-line',
}

const statusLabel: Record<string, string> = {
  pending: '待审核',
  approved: '已采纳',
  rejected: '已驳回',
  need_refetch: '待重抓',
  auto_applied: '已受理',
  success: '成功',
  partial: '部分成功',
  failed: '失败',
  running: '执行中',
}

async function refresh(): Promise<void> {
  if (!online.value) return
  loading.value = true
  try {
    if (tab.value === 'overview') {
      overview.value = await fetchOverview()
    } else if (tab.value === 'feedback') {
      const data = await fetchFeedback(feedbackStatus.value)
      feedback.value = data.items
    } else if (tab.value === 'jobs') {
      jobs.value = (await fetchJobs()).items
    } else {
      hotspots.value = await fetchHotspots()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载失败'
    if (message.includes('登录')) {
      authed.value = false
    }
    toast(message, 'error')
  } finally {
    loading.value = false
  }
}

async function switchTab(next: Tab): Promise<void> {
  tab.value = next
  await refresh()
}

async function setFeedbackStatus(next: string): Promise<void> {
  feedbackStatus.value = next as typeof feedbackStatus.value
  await refresh()
}

async function onApprove(row: FeedbackRow): Promise<void> {
  busy.value = row.code
  try {
    const result = await approveFeedback(row.code)
    toast(result.status === 'approved' ? '已采纳并生效' : '已标记待重抓', 'success')
    await refresh()
  } catch (error) {
    toast(error instanceof Error ? error.message : '操作失败', 'error')
  } finally {
    busy.value = ''
  }
}

async function onReject(row: FeedbackRow): Promise<void> {
  busy.value = row.code
  try {
    await rejectFeedback(row.code, '信息与现有数据不符')
    toast('已驳回', 'info')
    await refresh()
  } catch (error) {
    toast(error instanceof Error ? error.message : '操作失败', 'error')
  } finally {
    busy.value = ''
  }
}

async function onTriggerJob(): Promise<void> {
  busy.value = 'job'
  try {
    const result = await triggerJob()
    toast(`任务 #${result.jobId} 已创建，抓取中…`, 'success')
    tab.value = 'jobs'
    await refresh()
  } catch (error) {
    toast(error instanceof Error ? error.message : '触发失败', 'error')
  } finally {
    busy.value = ''
  }
}

async function onRecompute(): Promise<void> {
  busy.value = 'hot'
  try {
    const result = await recomputeHotspots()
    toast(`热点已重算，影响 ${result.affected} 个网格`, 'success')
    await refresh()
  } catch (error) {
    toast(error instanceof Error ? error.message : '重算失败', 'error')
  } finally {
    busy.value = ''
  }
}

onMounted(async () => {
  online.value = await isServerMode()
  // 未登录时不打运营接口，避免一进来就弹 401
  if (online.value && authed.value) {
    await refresh()
  }
})
</script>

<template>
  <div class="mx-auto w-full max-w-[1200px] px-4 py-6">
    <header class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight text-ink-900">运营后台</h1>
        <p class="mt-1 text-xs text-ink-500">
          反馈审核 · 抓取任务 · 热点调度，构成数据闭环的运营侧
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="h-9 rounded-[10px] border border-line bg-surface px-3 text-xs text-ink-600 transition hover:border-line-strong"
          @click="refresh"
        >
          刷新
        </button>
        <button
          v-if="authed"
          class="h-9 rounded-[10px] border border-line bg-surface px-3 text-xs text-ink-600 transition hover:border-line-strong"
          @click="onLogout"
        >
          退出
        </button>
        <button
          class="h-9 rounded-[10px] bg-brand-500 px-3 text-xs font-medium text-white shadow-card transition hover:bg-brand-600 disabled:opacity-60"
          :disabled="busy === 'job' || !online || !authed"
          @click="onTriggerJob"
        >
          {{ busy === 'job' ? '抓取中…' : '触发抓取' }}
        </button>
      </div>
    </header>

    <div
      v-if="online === false"
      class="rounded-card border border-dashed border-line-strong bg-surface px-5 py-10 text-center shadow-card"
    >
      <p class="text-sm text-ink-700">后端未连接</p>
      <p class="mt-1 text-xs text-ink-400">
        运营后台需要 Spring Boot 服务（默认 http://127.0.0.1:8080）
      </p>
    </div>

    <div
      v-else-if="!authed"
      class="mx-auto max-w-sm rounded-card border border-line bg-surface p-6 shadow-float"
    >
      <h2 class="text-sm font-semibold text-ink-900">运营登录</h2>
      <p class="mt-1 text-[11px] text-ink-400">
        后台接口需要鉴权，请使用运营账号登录（口令由部署方提供）
      </p>

      <div class="mt-4 space-y-3">
        <label class="block">
          <span class="mb-1 block text-[11px] text-ink-400">账号</span>
          <input
            v-model="username"
            class="h-9 w-full rounded-[10px] border border-line bg-surface px-3 text-xs text-ink-700 outline-none focus:border-brand-500"
            @keyup.enter="onLogin"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] text-ink-400">口令</span>
          <input
            v-model="password"
            type="password"
            class="h-9 w-full rounded-[10px] border border-line bg-surface px-3 text-xs text-ink-700 outline-none focus:border-brand-500"
            placeholder="请输入口令"
            @keyup.enter="onLogin"
          />
        </label>
      </div>

      <p v-if="loginError" class="mt-3 text-[11px] text-red-500">{{ loginError }}</p>

      <button
        class="mt-4 h-9 w-full rounded-[10px] bg-brand-500 text-xs font-medium text-white shadow-card transition hover:bg-brand-600 disabled:opacity-60"
        :disabled="loggingIn"
        @click="onLogin"
      >
        {{ loggingIn ? '登录中…' : '登录' }}
      </button>
    </div>

    <template v-else>
      <nav class="mb-4 flex gap-1 rounded-[12px] border border-line bg-surface-soft p-1">
        <button
          v-for="item in tabs"
          :key="item.key"
          class="flex-1 rounded-[9px] py-2 text-xs transition"
          :class="
            tab === item.key
              ? 'bg-surface font-medium text-ink-900 shadow-card'
              : 'text-ink-500 hover:text-ink-700'
          "
          @click="switchTab(item.key)"
        >
          {{ item.label }}
        </button>
      </nav>

      <!-- 概览 -->
      <div v-if="tab === 'overview'" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div
          v-for="kpi in kpis"
          :key="kpi.label"
          class="rounded-card border border-line bg-surface p-4 shadow-card"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs text-ink-500">{{ kpi.label }}</span>
            <span
              class="h-2 w-2 rounded-full"
              :class="{
                'bg-mint-500': kpi.tone === 'mint',
                'bg-brand-500': kpi.tone === 'brand',
                'bg-amber-500': kpi.tone === 'amber',
                'bg-ink-400': kpi.tone === 'ink',
              }"
            />
          </div>
          <p class="mt-2 text-2xl font-semibold tracking-tight text-ink-900">{{ kpi.value }}</p>
          <p class="mt-0.5 text-[11px] text-ink-400">{{ kpi.hint }}</p>
        </div>
      </div>

      <!-- 反馈 -->
      <div
        v-else-if="tab === 'feedback'"
        class="rounded-card border border-line bg-surface shadow-card"
      >
        <div class="flex items-center gap-2 border-b border-line px-4 py-3">
          <button
            v-for="option in [
              { key: 'pending', label: '待审核' },
              { key: 'approved', label: '已采纳' },
              { key: 'rejected', label: '已驳回' },
              { key: 'all', label: '全部' },
            ]"
            :key="option.key"
            class="rounded-lg px-2.5 py-1 text-[11px] transition"
            :class="
              feedbackStatus === option.key
                ? 'bg-brand-50 font-medium text-brand-600'
                : 'text-ink-500 hover:bg-surface-soft'
            "
            @click="setFeedbackStatus(option.key)"
          >
            {{ option.label }}
          </button>
        </div>

        <div v-if="feedback.length === 0" class="px-4 py-12 text-center text-xs text-ink-400">
          暂无反馈
        </div>

        <ul v-else class="divide-y divide-line">
          <li v-for="row in feedback" :key="row.code" class="px-4 py-3">
            <div class="flex flex-wrap items-start gap-3">
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-2 text-[13px] font-medium text-ink-900">
                  {{ row.poiName || row.poiId }}
                  <span
                    class="rounded-full border px-1.5 py-0.5 text-[10px]"
                    :class="statusStyle[row.status] ?? 'border-line text-ink-500'"
                  >
                    {{ statusLabel[row.status] ?? row.status }}
                  </span>
                </p>
                <p class="mt-1 text-xs text-ink-500">
                  {{ row.field }}{{ row.newValue ? ` → ${row.newValue}` : '' }} ·
                  {{ row.description }}
                </p>
                <p class="mt-1 text-[11px] text-ink-400">
                  {{ row.code }} · {{ row.poiType === 'bank' ? '银行' : '小区' }} ·
                  {{ row.createdAt }}
                </p>
              </div>
              <div v-if="row.status === 'pending'" class="flex shrink-0 gap-2">
                <button
                  class="rounded-lg border border-line px-3 py-1.5 text-[11px] text-ink-500 transition hover:bg-surface-soft"
                  :disabled="busy === row.code"
                  @click="onReject(row)"
                >
                  驳回
                </button>
                <button
                  class="rounded-lg bg-brand-500 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
                  :disabled="busy === row.code"
                  @click="onApprove(row)"
                >
                  采纳生效
                </button>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <!-- 任务 -->
      <div
        v-else-if="tab === 'jobs'"
        class="rounded-card border border-line bg-surface shadow-card"
      >
        <div v-if="jobs.length === 0" class="px-4 py-12 text-center text-xs text-ink-400">
          暂无任务
        </div>
        <ul v-else class="divide-y divide-line">
          <li v-for="job in jobs" :key="job.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
            <span class="text-xs font-medium text-ink-900">#{{ job.id }}</span>
            <span
              class="rounded-full border px-1.5 py-0.5 text-[10px]"
              :class="statusStyle[job.status] ?? 'border-line text-ink-500'"
            >
              {{ statusLabel[job.status] ?? job.status }}
            </span>
            <span class="text-[11px] text-ink-500">抓取 {{ job.fetchedCount }}</span>
            <span class="text-[11px] text-mint-600">新增 {{ job.insertedCount }}</span>
            <span class="text-[11px] text-brand-600">更新 {{ job.updatedCount }}</span>
            <span class="text-[11px] text-ink-400">{{ job.createdAt }}</span>
            <span v-if="job.errorSummary" class="w-full truncate text-[11px] text-red-500">
              {{ job.errorSummary }}
            </span>
          </li>
        </ul>
      </div>

      <!-- 热点 -->
      <div v-else class="rounded-card border border-line bg-surface shadow-card">
        <div class="flex items-center justify-between border-b border-line px-4 py-3">
          <p class="text-xs text-ink-500">按「查询次数 + 2 × 零结果次数」计算优先级</p>
          <button
            class="rounded-lg border border-line px-3 py-1.5 text-[11px] text-ink-600 transition hover:border-brand-500/50 hover:text-brand-600 disabled:opacity-60"
            :disabled="busy === 'hot'"
            @click="onRecompute"
          >
            {{ busy === 'hot' ? '重算中…' : '重算热点' }}
          </button>
        </div>
        <div v-if="hotspots.length === 0" class="px-4 py-12 text-center text-xs text-ink-400">
          暂无热点数据，先在地图上查询几次再重算
        </div>
        <ul v-else class="divide-y divide-line">
          <li
            v-for="item in hotspots"
            :key="`${item.grid}-${item.statDate}`"
            class="flex items-center gap-3 px-4 py-2.5"
          >
            <span
              class="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-[11px] font-medium text-brand-600"
            >
              {{ item.priority }}
            </span>
            <span class="min-w-0 flex-1 text-xs text-ink-700">{{ item.grid }}</span>
            <span class="text-[11px] text-ink-500">查询 {{ item.queryCount }}</span>
            <span class="text-[11px] text-amber-600">零结果 {{ item.zeroResultCount }}</span>
            <span class="text-[11px] text-ink-400">{{ item.updatedAt }}</span>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
