<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import AgentPanel from '@/components/admin/AgentPanel.vue'
import QueryBehaviorPanel from '@/components/admin/QueryBehaviorPanel.vue'
import ComplianceDoc from '@/components/ComplianceDoc.vue'
import CorrectionComposer from '@/components/CorrectionComposer.vue'
import {
  approveFeedback,
  fetchFeedback,
  fetchJobs,
  fetchOverview,
  rejectFeedback,
  triggerJob,
  type AdminOverview,
  type FeedbackRow,
  type JobRow,
} from '@/api/admin'
import { isServerMode } from '@/api/pois'
import { clearToken, isLoggedIn, login } from '@/api/auth'
import { toast } from '@/lib/toast'

type Tab = 'overview' | 'feedback' | 'agent' | 'behavior' | 'correction' | 'jobs' | 'compliance'

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
const feedbackStatus = ref<'pending' | 'approved' | 'rejected' | 'need_refetch' | 'all'>('pending')
const feedbackPage = ref(1)
const feedbackSize = ref(10)
const feedbackTotal = ref(0)
const expandedCode = ref('')
const rejectNote = ref('')
const jobs = ref<JobRow[]>([])
const jobsAutoRefresh = ref(true)
const jobsRefreshing = ref(false)
const jobsUpdatedAt = ref('')
const busy = ref('')

/** 自动刷新间隔：任务从 pending/running 到终态应在 5s 内可见（FR-D-03） */
const JOBS_POLL_MS = 5000
const ACTIVE_JOB_STATUSES = ['pending', 'pending_job', 'running'] as const

const feedbackPages = computed(() =>
  Math.max(1, Math.ceil(feedbackTotal.value / feedbackSize.value)),
)
const feedbackFrom = computed(() =>
  feedbackTotal.value === 0 ? 0 : (feedbackPage.value - 1) * feedbackSize.value + 1,
)
const feedbackTo = computed(() =>
  Math.min(feedbackPage.value * feedbackSize.value, feedbackTotal.value),
)
const jobsActive = computed(() =>
  jobs.value.some((job) => (ACTIVE_JOB_STATUSES as readonly string[]).includes(job.status)),
)

let jobsTimer: number | null = null

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
  { key: 'agent', label: 'Agent 建议' },
  { key: 'behavior', label: '查询行为' },
  { key: 'correction', label: '数据纠错' },
  { key: 'jobs', label: '抓取任务' },
  { key: 'compliance', label: '数据说明' },
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
  pending_job: '排队中',
}

const feedbackTypeLabel: Record<string, string> = {
  error: '信息有误',
  closed: '已关闭',
  add: '补充 / 新增',
}

function handleLoadError(error: unknown): void {
  const message = error instanceof Error ? error.message : '加载失败'
  if (message.includes('登录')) {
    authed.value = false
  }
  toast(message, 'error')
}

async function loadFeedbackPage(): Promise<void> {
  const data = await fetchFeedback(feedbackStatus.value, feedbackPage.value, feedbackSize.value)
  const total = data.total ?? data.items.length
  const lastPage = Math.max(1, Math.ceil(total / feedbackSize.value))
  if (feedbackPage.value > lastPage) {
    // 审核后当前页可能被抽空，退回最后一页而不是停在空列表
    feedbackPage.value = lastPage
    const retry = await fetchFeedback(feedbackStatus.value, lastPage, feedbackSize.value)
    feedback.value = retry.items
    feedbackTotal.value = retry.total ?? retry.items.length
    return
  }
  feedback.value = data.items
  feedbackTotal.value = total
}

function clockNow(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

async function loadJobsPage(): Promise<void> {
  const data = await fetchJobs()
  jobs.value = data.items
  jobsUpdatedAt.value = clockNow()
}

async function refresh(): Promise<void> {
  if (!online.value || !authed.value) return
  loading.value = true
  try {
    if (tab.value === 'overview') {
      overview.value = await fetchOverview()
    } else if (tab.value === 'feedback') {
      await loadFeedbackPage()
    } else if (tab.value === 'jobs') {
      await loadJobsPage()
    }
  } catch (error) {
    handleLoadError(error)
  } finally {
    loading.value = false
  }
}

function canAutoRefreshJobs(): boolean {
  if (tab.value !== 'jobs' || !jobsAutoRefresh.value || !online.value || !authed.value) return false
  return document.visibilityState !== 'hidden'
}

function stopJobsPolling(): void {
  if (jobsTimer !== null) {
    window.clearInterval(jobsTimer)
    jobsTimer = null
  }
}

async function pollJobs(): Promise<void> {
  if (!canAutoRefreshJobs() || jobsRefreshing.value || loading.value) return
  jobsRefreshing.value = true
  try {
    await loadJobsPage()
  } catch (error) {
    // 网络抖动留给下一轮；仅在登录失效时打断用户
    if (error instanceof Error && error.message.includes('登录')) {
      authed.value = false
      toast(error.message, 'error')
    }
  } finally {
    jobsRefreshing.value = false
  }
}

function startJobsPolling(): void {
  stopJobsPolling()
  if (!canAutoRefreshJobs()) return
  jobsTimer = window.setInterval(() => {
    void pollJobs()
  }, JOBS_POLL_MS)
}

async function refreshJobsNow(): Promise<void> {
  if (jobsRefreshing.value || loading.value) return
  jobsRefreshing.value = true
  try {
    await loadJobsPage()
  } catch (error) {
    handleLoadError(error)
  } finally {
    jobsRefreshing.value = false
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible' && canAutoRefreshJobs()) {
    void pollJobs()
  }
}

watch([tab, online, authed, jobsAutoRefresh], () => {
  if (canAutoRefreshJobs()) {
    startJobsPolling()
  } else {
    stopJobsPolling()
  }
})

async function switchTab(next: Tab): Promise<void> {
  tab.value = next
  if (next === 'overview' || next === 'feedback' || next === 'jobs') {
    await refresh()
  }
}

async function setFeedbackStatus(next: string): Promise<void> {
  feedbackStatus.value = next as typeof feedbackStatus.value
  feedbackPage.value = 1
  expandedCode.value = ''
  await refresh()
}

async function goFeedbackPage(next: number): Promise<void> {
  const target = Math.min(Math.max(1, next), feedbackPages.value)
  if (target === feedbackPage.value) return
  feedbackPage.value = target
  expandedCode.value = ''
  await refresh()
}

async function onFeedbackSizeChange(): Promise<void> {
  feedbackPage.value = 1
  await refresh()
}

function toggleExpanded(code: string): void {
  expandedCode.value = expandedCode.value === code ? '' : code
  rejectNote.value = ''
}

async function syncOverview(): Promise<void> {
  try {
    overview.value = await fetchOverview()
  } catch {
    // 概览同步失败不影响审核结果
  }
}

async function onApprove(row: FeedbackRow): Promise<void> {
  busy.value = row.code
  try {
    const result = await approveFeedback(row.code)
    toast(result.status === 'approved' ? '已采纳并生效' : '已标记待重抓', 'success')
    expandedCode.value = ''
    await refresh()
    await syncOverview()
  } catch (error) {
    toast(error instanceof Error ? error.message : '操作失败', 'error')
  } finally {
    busy.value = ''
  }
}

async function onReject(row: FeedbackRow): Promise<void> {
  busy.value = row.code
  try {
    const note = rejectNote.value.trim() || '信息与现有数据不符'
    await rejectFeedback(row.code, note)
    toast('已驳回', 'info')
    expandedCode.value = ''
    rejectNote.value = ''
    await refresh()
    await syncOverview()
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

function onUnauthorized(): void {
  authed.value = false
  toast('登录已过期，请重新登录', 'error')
}

async function onCorrectionSubmitted(): Promise<void> {
  await syncOverview()
}

onMounted(async () => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  online.value = await isServerMode()
  // 未登录时不打运营接口，避免一进来就弹 401
  if (online.value && authed.value) {
    await refresh()
  }
})

onBeforeUnmount(() => {
  stopJobsPolling()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div class="mx-auto w-full max-w-[1200px] px-4 py-6">
    <header class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight text-ink-900">管理后台</h1>
        <p class="mt-1 text-xs text-ink-500">
          查询行为 · 反馈审核 · Agent 建议 · 数据纠错 · 抓取任务 · 数据说明，一个后台完成运营闭环
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="tab === 'overview' || tab === 'feedback' || tab === 'jobs'"
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
      <h2 class="text-sm font-semibold text-ink-900">管理后台登录</h2>
      <p class="mt-1 text-[11px] text-ink-400">
        管理接口需要鉴权，请使用运营账号登录（口令由部署方提供）
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
      <nav
        class="mb-4 flex gap-1 overflow-x-auto rounded-[12px] border border-line bg-surface-soft p-1"
      >
        <button
          v-for="item in tabs"
          :key="item.key"
          class="min-w-[82px] shrink-0 flex-1 whitespace-nowrap rounded-[9px] px-3 py-2 text-xs transition"
          :class="
            tab === item.key
              ? 'bg-surface font-medium text-ink-900 shadow-card'
              : 'text-ink-500 hover:text-ink-700'
          "
          @click="switchTab(item.key)"
        >
          {{ item.label }}
          <span
            v-if="item.key === 'feedback' && overview?.pendingFeedback"
            class="ml-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600"
          >
            {{ overview?.pendingFeedback }}
          </span>
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
        <div
          class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3"
        >
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-for="option in [
                { key: 'pending', label: '待审核' },
                { key: 'approved', label: '已采纳' },
                { key: 'rejected', label: '已驳回' },
                { key: 'need_refetch', label: '待重抓' },
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
          <span class="text-[11px] text-ink-400">
            <template v-if="loading">加载中…</template>
            <template v-else>共 {{ feedbackTotal }} 条</template>
          </span>
        </div>

        <div v-if="loading && feedback.length === 0" class="space-y-2 px-4 py-4">
          <div v-for="i in 3" :key="i" class="h-16 animate-pulse rounded-soft bg-surface-soft" />
        </div>

        <div v-else-if="feedback.length === 0" class="px-4 py-12 text-center text-xs text-ink-400">
          暂无反馈
        </div>

        <ul v-else class="divide-y divide-line" :class="{ 'opacity-60': loading }">
          <li v-for="row in feedback" :key="row.code" class="px-4 py-3">
            <div class="flex flex-wrap items-start gap-3">
              <div class="min-w-0 flex-1">
                <p class="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink-900">
                  {{ row.poiName || row.poiId }}
                  <span
                    class="rounded-full border px-1.5 py-0.5 text-[10px]"
                    :class="statusStyle[row.status] ?? 'border-line text-ink-500'"
                  >
                    {{ statusLabel[row.status] ?? row.status }}
                  </span>
                  <span class="rounded bg-surface-soft px-1.5 py-0.5 text-[10px] text-ink-500">
                    {{ feedbackTypeLabel[row.type] ?? row.type }}
                  </span>
                </p>
                <p class="mt-1 text-xs text-ink-500">
                  {{ row.field }}{{ row.newValue ? ` → ${row.newValue}` : '' }} ·
                  {{ row.description }}
                </p>
                <p class="mt-1 text-[11px] text-ink-400">
                  {{ row.code }} · {{ row.poiType === 'bank' ? '银行' : '小区' }} ·
                  {{ row.createdAt }}
                  <span v-if="row.contact"> · {{ row.contact }}</span>
                </p>
              </div>
              <div class="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  class="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-500 transition hover:bg-surface-soft"
                  @click="toggleExpanded(row.code)"
                >
                  {{ expandedCode === row.code ? '收起' : '详情' }}
                </button>
                <template v-if="row.status === 'pending'">
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
                </template>
              </div>
            </div>

            <div
              v-if="expandedCode === row.code"
              class="mt-3 rounded-soft border border-line bg-surface-soft p-3"
            >
              <dl class="grid gap-2 text-[11px] sm:grid-cols-2">
                <div>
                  <dt class="text-ink-400">点位</dt>
                  <dd class="mt-0.5 text-ink-700">
                    {{ row.poiName || row.poiId }}（{{ row.poiType === 'bank' ? '银行' : '小区' }}）
                  </dd>
                </div>
                <div>
                  <dt class="text-ink-400">字段 / 新值</dt>
                  <dd class="mt-0.5 text-ink-700">
                    {{ row.field }} → {{ row.newValue || '未填写' }}
                  </dd>
                </div>
                <div class="sm:col-span-2">
                  <dt class="text-ink-400">问题说明</dt>
                  <dd class="mt-0.5 leading-relaxed text-ink-700">{{ row.description }}</dd>
                </div>
                <div>
                  <dt class="text-ink-400">联系方式</dt>
                  <dd class="mt-0.5 text-ink-700">{{ row.contact || '未留' }}</dd>
                </div>
                <div>
                  <dt class="text-ink-400">审核记录</dt>
                  <dd class="mt-0.5 text-ink-700">
                    {{ row.reviewer || '—'
                    }}<span v-if="row.reviewNote"> · {{ row.reviewNote }}</span>
                  </dd>
                </div>
              </dl>
              <label v-if="row.status === 'pending'" class="mt-3 block">
                <span class="mb-1 block text-[11px] text-ink-400">驳回理由（选填）</span>
                <input
                  v-model="rejectNote"
                  class="h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-[11px] text-ink-700 outline-none focus:border-brand-500"
                  placeholder="例如：已电话核实，与原数据不符"
                />
              </label>
            </div>
          </li>
        </ul>

        <div
          v-if="feedbackTotal > 0"
          class="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 rounded-b-card border-t border-line bg-surface/95 px-4 py-3 backdrop-blur"
        >
          <p class="text-[11px] text-ink-400">
            第 {{ feedbackFrom }}–{{ feedbackTo }} 条 · 共 {{ feedbackTotal }} 条
          </p>
          <div class="flex items-center gap-1.5">
            <select
              v-model.number="feedbackSize"
              data-testid="feedback-page-size"
              class="h-7 rounded-lg border border-line bg-surface px-1.5 text-[11px] text-ink-600 outline-none focus:border-brand-500"
              @change="onFeedbackSizeChange"
            >
              <option :value="10">10 条/页</option>
              <option :value="20">20 条/页</option>
              <option :value="50">50 条/页</option>
            </select>
            <button
              data-testid="feedback-prev"
              class="h-7 rounded-lg border border-line bg-surface px-2.5 text-[11px] text-ink-600 transition hover:border-line-strong disabled:opacity-40"
              :disabled="feedbackPage === 1 || loading"
              @click="goFeedbackPage(feedbackPage - 1)"
            >
              上一页
            </button>
            <span class="min-w-16 text-center text-[11px] tabular-nums text-ink-500">
              {{ feedbackPage }} / {{ feedbackPages }}
            </span>
            <button
              data-testid="feedback-next"
              class="h-7 rounded-lg border border-line bg-surface px-2.5 text-[11px] text-ink-600 transition hover:border-line-strong disabled:opacity-40"
              :disabled="feedbackPage >= feedbackPages || loading"
              @click="goFeedbackPage(feedbackPage + 1)"
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      <!-- 任务 -->
      <div
        v-else-if="tab === 'jobs'"
        class="rounded-card border border-line bg-surface shadow-card"
      >
        <div
          class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3"
        >
          <div class="flex items-center gap-2 text-[11px] text-ink-500">
            <span class="relative flex h-2 w-2">
              <span
                v-if="jobsActive"
                class="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60"
              />
              <span
                class="relative inline-flex h-2 w-2 rounded-full"
                :class="jobsActive ? 'bg-brand-500' : 'bg-ink-400/50'"
              />
            </span>
            <span>{{ jobsActive ? '任务执行中，状态自动刷新' : '当前无进行中的任务' }}</span>
            <span v-if="jobsUpdatedAt" class="text-ink-400">· 更新于 {{ jobsUpdatedAt }}</span>
          </div>
          <div class="flex items-center gap-3">
            <label class="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-500">
              <input
                v-model="jobsAutoRefresh"
                data-testid="jobs-auto-refresh"
                type="checkbox"
                class="h-3.5 w-3.5 rounded border-line accent-brand-500"
              />
              每 5 秒自动刷新
            </label>
            <button
              data-testid="jobs-refresh"
              class="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-600 transition hover:border-brand-500/50 hover:text-brand-600 disabled:opacity-50"
              :disabled="jobsRefreshing || loading"
              @click="refreshJobsNow"
            >
              {{ jobsRefreshing ? '刷新中…' : '立即刷新' }}
            </button>
          </div>
        </div>

        <div v-if="jobs.length === 0" class="px-4 py-12 text-center text-xs text-ink-400">
          暂无任务
        </div>
        <ul v-else class="divide-y divide-line">
          <li
            v-for="job in jobs"
            :key="job.id"
            class="flex flex-wrap items-center gap-3 px-4 py-3"
            :class="{ 'bg-brand-50/40': job.status === 'running' }"
          >
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
            <span v-if="job.failedCount > 0" class="text-[11px] text-red-500">
              失败 {{ job.failedCount }}
            </span>
            <span class="text-[11px] text-ink-400">{{ job.createdAt }}</span>
            <span v-if="job.finishedAt" class="text-[11px] text-ink-400">
              完成于 {{ job.finishedAt }}
            </span>
            <span v-if="job.errorSummary" class="w-full truncate text-[11px] text-red-500">
              {{ job.errorSummary }}
            </span>
          </li>
        </ul>
      </div>

      <!-- Agent 建议：运行数据接入 Agent 并人工采纳 -->
      <div v-else-if="tab === 'agent'">
        <AgentPanel @unauthorized="onUnauthorized" />
      </div>

      <!-- 查询行为：query_log 实时聚合 + 热点重算 -->
      <div v-else-if="tab === 'behavior'">
        <QueryBehaviorPanel @unauthorized="onUnauthorized" />
      </div>

      <!-- 数据纠错：与用户后台共用同一套表单 -->
      <div v-else-if="tab === 'correction'">
        <CorrectionComposer
          mode="admin"
          @review="switchTab('feedback')"
          @submitted="onCorrectionSubmitted"
        />
      </div>

      <!-- 数据说明：与用户后台共用同一份合规文档 -->
      <div v-else class="rounded-card border border-line bg-surface p-5 shadow-card">
        <ComplianceDoc />
      </div>
    </template>
  </div>
</template>
