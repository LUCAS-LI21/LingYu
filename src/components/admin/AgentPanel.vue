<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  applyAgentRun,
  fetchAgentRuns,
  fetchAgentStatus,
  proposeAgentField,
  type AgentProposal,
  type AgentProposeResult,
  type AgentRunRow,
  type AgentStatus,
} from '@/api/agent'
import { searchPois } from '@/api/pois'
import { toast } from '@/lib/toast'
import type { Poi } from '@/types/poi'

const emit = defineEmits<{ (e: 'unauthorized'): void }>()

type RunFilter = 'all' | 'ready' | 'needs_review' | 'applied' | 'failed'

interface ParsedRun extends AgentRunRow {
  proposal: AgentProposal | null
}

const status = ref<AgentStatus | null>(null)
const statusLoading = ref(true)
const runs = ref<AgentRunRow[]>([])
const runsLoading = ref(false)
const error = ref('')

const keyword = ref('')
const results = ref<Poi[]>([])
const searching = ref(false)
const searchTouched = ref(false)
const selected = ref<Poi | null>(null)
const field = ref('')
const proposing = ref(false)
const proposal = ref<AgentProposeResult | null>(null)
const proposalApplied = ref(false)

const filter = ref<RunFilter>('all')
const expandedId = ref<number | null>(null)
const applyingId = ref<number | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | null = null

const fieldOptions = computed(() => {
  if (!selected.value) return []
  return selected.value.type === 'bank'
    ? [
        { value: 'address', label: '详细地址' },
        { value: 'phone', label: '联系电话' },
        { value: 'openingHours', label: '营业时间' },
      ]
    : [{ value: 'address', label: '详细地址' }]
})

const fieldLabel: Record<string, string> = {
  address: '详细地址',
  phone: '联系电话',
  openingHours: '营业时间',
}

const statusLabel: Record<string, string> = {
  ready: '可采纳',
  needs_review: '需复核',
  rejected: '未抽到',
  failed: '失败',
  applied: '已采纳',
  running: '运行中',
  skipped: '已跳过',
  disabled: '未启用',
}

const statusStyle: Record<string, string> = {
  ready: 'border-mint-500/25 bg-mint-50 text-mint-600',
  needs_review: 'border-amber-200 bg-amber-50 text-amber-600',
  rejected: 'border-red-200 bg-red-50 text-red-500',
  failed: 'border-red-200 bg-red-50 text-red-500',
  applied: 'border-brand-500/25 bg-brand-50 text-brand-600',
  running: 'border-brand-500/25 bg-brand-50 text-brand-600',
  skipped: 'border-line bg-surface-soft text-ink-500',
  disabled: 'border-line bg-surface-soft text-ink-500',
}

const filterOptions: Array<{ key: RunFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'ready', label: '可采纳' },
  { key: 'needs_review', label: '需复核' },
  { key: 'applied', label: '已采纳' },
  { key: 'failed', label: '失败' },
]

function parseProposal(raw: string | null): AgentProposal | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<AgentProposal>
    return {
      value: String(data.value ?? ''),
      evidence: String(data.evidence ?? ''),
      sourceUrl: String(data.sourceUrl ?? ''),
      confidence: Number(data.confidence ?? 0),
      problems: Array.isArray(data.problems) ? data.problems.map((item) => String(item)) : [],
    }
  } catch {
    return null
  }
}

const parsedRuns = computed<ParsedRun[]>(() =>
  runs.value.map((row) => ({ ...row, proposal: parseProposal(row.result_json) })),
)

const filteredRuns = computed(() => {
  if (filter.value === 'all') return parsedRuns.value
  if (filter.value === 'failed') {
    return parsedRuns.value.filter((run) => run.status === 'failed' || run.status === 'rejected')
  }
  return parsedRuns.value.filter((run) => run.status === filter.value)
})

const filterCounts = computed<Record<RunFilter, number>>(() => {
  const counts: Record<RunFilter, number> = {
    all: parsedRuns.value.length,
    ready: 0,
    needs_review: 0,
    applied: 0,
    failed: 0,
  }
  for (const run of parsedRuns.value) {
    if (run.status === 'ready') counts.ready += 1
    else if (run.status === 'needs_review') counts.needs_review += 1
    else if (run.status === 'applied') counts.applied += 1
    else if (run.status === 'failed' || run.status === 'rejected') counts.failed += 1
  }
  return counts
})

const readyCount = computed(() => filterCounts.value.ready)
const canRun = computed(
  () =>
    Boolean(selected.value) &&
    Boolean(field.value) &&
    Boolean(status.value?.enabled) &&
    !proposing.value,
)

function handleError(cause: unknown): void {
  const message = cause instanceof Error ? cause.message : 'Agent 请求失败'
  if (message.includes('登录')) {
    emit('unauthorized')
    return
  }
  error.value = message
  toast(message, 'error')
}

function poiTypeLabel(poi: Poi): string {
  if (poi.type === 'community') return '住宅小区'
  return poi.branchType === 'atm' ? '银行 ATM' : '银行网点'
}

function confidenceText(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
}

function runSearch(value: string): void {
  if (searchTimer) clearTimeout(searchTimer)
  const term = value.trim()
  if (!term) {
    results.value = []
    searching.value = false
    return
  }
  searching.value = true
  searchTimer = setTimeout(async () => {
    try {
      results.value = await searchPois(term, 6)
    } catch {
      results.value = []
    } finally {
      searching.value = false
      searchTouched.value = true
    }
  }, 220)
}

function selectPoi(poi: Poi): void {
  selected.value = poi
  field.value = 'address'
  keyword.value = ''
  results.value = []
  searchTouched.value = false
  proposal.value = null
  proposalApplied.value = false
  error.value = ''
}

async function loadStatus(): Promise<void> {
  statusLoading.value = true
  try {
    status.value = await fetchAgentStatus()
  } catch (cause) {
    handleError(cause)
  } finally {
    statusLoading.value = false
  }
}

async function loadRuns(showLoading = true): Promise<void> {
  if (showLoading) runsLoading.value = true
  try {
    runs.value = await fetchAgentRuns(50)
  } catch (cause) {
    handleError(cause)
  } finally {
    runsLoading.value = false
  }
}

async function refreshAll(): Promise<void> {
  await Promise.all([loadStatus(), loadRuns()])
}

async function runPropose(): Promise<void> {
  if (!selected.value || !status.value?.enabled) return
  proposing.value = true
  proposal.value = null
  proposalApplied.value = false
  error.value = ''
  try {
    const result = await proposeAgentField(selected.value.type, selected.value.id, field.value)
    proposal.value = result
    if (result.status === 'ready') {
      toast('Agent 产出可采纳建议，请核对证据后采纳', 'success')
    } else if (result.status === 'needs_review') {
      toast('Agent 建议存在疑点，需人工复核', 'info')
    } else if (result.status === 'disabled') {
      toast(result.reason || 'Agent 未启用', 'error')
    } else if (result.status === 'failed') {
      toast(result.reason || 'Agent 运行失败', 'error')
    } else {
      toast(result.reason || 'Agent 未产出可采纳建议', 'info')
    }
    await loadRuns(false)
  } catch (cause) {
    handleError(cause)
  } finally {
    proposing.value = false
  }
}

async function adopt(runId: number): Promise<void> {
  applyingId.value = runId
  try {
    const result = await applyAgentRun(runId)
    toast(`已采纳并写入版本：${result.field} = ${result.value.slice(0, 24)}`, 'success')
    if (proposal.value?.runId === runId) proposalApplied.value = true
    await loadRuns(false)
  } catch (cause) {
    handleError(cause)
  } finally {
    applyingId.value = null
  }
}

watch(keyword, (value) => runSearch(value))

onMounted(() => {
  void loadStatus()
  void loadRuns()
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div class="space-y-4">
    <!-- Agent 状态 -->
    <section class="rounded-card border border-line bg-surface shadow-card">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p class="text-sm font-semibold text-ink-900">数据接入 Agent</p>
          <p class="mt-0.5 text-[11px] text-ink-400">
            搜索 + 抽取 + 复核，只产出建议；管理员采纳后才写主表与版本
          </p>
        </div>
        <div class="flex items-center gap-2">
          <span
            class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]"
            :class="
              status?.enabled
                ? 'border-mint-500/25 bg-mint-50 text-mint-600'
                : 'border-amber-200 bg-amber-50 text-amber-600'
            "
          >
            <span
              class="h-1.5 w-1.5 rounded-full"
              :class="status?.enabled ? 'bg-mint-500' : 'bg-amber-500'"
            />
            {{ statusLoading ? '检测中…' : status?.enabled ? '已启用' : '未启用' }}
          </span>
          <button
            class="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-600 transition hover:border-brand-500/50 hover:text-brand-600 disabled:opacity-50"
            :disabled="statusLoading || runsLoading"
            @click="refreshAll"
          >
            刷新
          </button>
        </div>
      </div>

      <div class="grid gap-3 px-4 py-3 sm:grid-cols-3">
        <div>
          <p class="text-[10px] text-ink-400">模型</p>
          <p class="mt-0.5 text-xs font-medium text-ink-700">{{ status?.model || '—' }}</p>
        </div>
        <div class="sm:col-span-2">
          <p class="text-[10px] text-ink-400">接口</p>
          <p class="mt-0.5 truncate text-xs text-ink-500">{{ status?.baseUrl || '—' }}</p>
        </div>
      </div>

      <p
        v-if="status && !status.enabled"
        class="mx-4 mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700"
      >
        未配置 DEEPSEEK_API_KEY：可以查看历史运行记录，但无法触发新的补全。
      </p>
      <p
        v-if="error"
        class="mx-4 mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600"
      >
        {{ error }}
      </p>
    </section>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,390px)_minmax(0,1fr)]">
      <!-- 触发一次补全 -->
      <section class="rounded-card border border-line bg-surface p-4 shadow-card">
        <div class="mb-3">
          <p class="text-sm font-semibold text-ink-900">运行一次补全</p>
          <p class="mt-0.5 text-[11px] text-ink-400">选择点位与字段，Agent 大约需要 5–15 秒</p>
        </div>

        <div class="relative">
          <svg
            class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" stroke-linecap="round" />
          </svg>
          <input
            v-model="keyword"
            data-testid="agent-search"
            class="h-9 w-full rounded-[10px] border border-line bg-surface pl-9 pr-3 text-xs text-ink-700 outline-none transition placeholder:text-ink-400 focus:border-brand-500"
            placeholder="搜索点位名称 / 地址"
          />
        </div>

        <div
          v-if="selected"
          class="mt-3 rounded-soft border border-brand-500/25 bg-brand-50/50 p-3"
        >
          <p class="truncate text-xs font-medium text-ink-900">{{ selected.name }}</p>
          <p class="mt-0.5 truncate text-[11px] text-ink-500">
            {{ selected.address || '地址待补充' }}
          </p>
          <p class="mt-1.5 flex items-center gap-2 text-[10px] text-ink-400">
            <span class="rounded bg-surface px-1 py-0.5 ring-1 ring-line">{{
              poiTypeLabel(selected)
            }}</span>
            <span>{{ selected.district }}</span>
            <span>#{{ selected.id.slice(-4) }}</span>
          </p>
        </div>

        <div v-if="searching" class="mt-3 space-y-1.5">
          <div v-for="i in 3" :key="i" class="h-11 animate-pulse rounded-lg bg-surface-soft" />
        </div>
        <ul v-else-if="results.length" class="mt-3 space-y-1.5">
          <li v-for="poi in results" :key="poi.id">
            <button
              type="button"
              data-testid="agent-entity-result"
              class="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-left transition hover:border-brand-500/40 hover:bg-brand-50/30"
              @click="selectPoi(poi)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[11px] font-medium text-ink-700">{{
                  poi.name
                }}</span>
                <span class="mt-0.5 block truncate text-[10px] text-ink-400">{{
                  poi.address || '地址待补充'
                }}</span>
              </span>
              <span class="shrink-0 text-[10px] text-ink-400">{{ poi.district }}</span>
            </button>
          </li>
        </ul>
        <p
          v-else-if="searchTouched && keyword.trim()"
          class="mt-3 rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-[11px] text-ink-400"
        >
          没有匹配点位
        </p>

        <label class="mt-3 block">
          <span class="mb-1.5 block text-[11px] font-medium text-ink-400">补全字段</span>
          <select
            v-model="field"
            :disabled="!selected"
            class="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-xs text-ink-700 outline-none transition focus:border-brand-500 disabled:bg-surface-soft disabled:text-ink-400"
          >
            <option v-if="!selected" value="">请先选择点位</option>
            <option v-for="item in fieldOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
        </label>

        <button
          type="button"
          data-testid="agent-run"
          class="mt-4 flex w-full items-center justify-center gap-2 rounded-[10px] bg-brand-500 px-4 py-2 text-xs font-medium text-white shadow-card transition hover:bg-brand-600 disabled:opacity-50"
          :disabled="!canRun"
          @click="runPropose"
        >
          <span
            v-if="proposing"
            class="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
          {{ proposing ? 'Agent 运行中…' : '运行 Agent 补全' }}
        </button>
        <p v-if="proposing" class="mt-2 text-center text-[10px] text-ink-400">
          正在搜索网页并做两次模型调用，请勿重复点击
        </p>
      </section>

      <!-- 本次运行结果 -->
      <section class="rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p class="text-sm font-semibold text-ink-900">本次运行结果</p>
            <p class="mt-0.5 text-[11px] text-ink-400">建议不写库，采纳后才生效</p>
          </div>
          <span
            v-if="proposal"
            class="rounded-full border px-2 py-0.5 text-[10px]"
            :class="statusStyle[proposal.status] ?? 'border-line text-ink-500'"
          >
            {{ statusLabel[proposal.status] ?? proposal.status }}
          </span>
        </div>

        <div
          v-if="!proposal"
          class="rounded-soft border border-dashed border-line-strong px-4 py-12 text-center text-[11px] leading-relaxed text-ink-400"
        >
          选择左侧点位并运行后，这里展示候选值、证据、来源和复核问题。
        </div>

        <div v-else data-testid="agent-result" class="space-y-3">
          <div class="rounded-soft border border-line bg-surface-soft px-3 py-2.5">
            <p class="text-[10px] text-ink-400">点位 / 字段</p>
            <p class="mt-0.5 text-xs font-medium text-ink-900">
              {{ proposal.name || selected?.name || proposal.entityId }} ·
              {{ fieldLabel[proposal.field ?? field] ?? proposal.field }}
            </p>
            <p v-if="proposal.runId" class="mt-0.5 text-[10px] text-ink-400">
              运行 #{{ proposal.runId }}
            </p>
          </div>

          <div v-if="proposal.proposal" class="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div class="rounded-soft border border-brand-500/20 bg-brand-50/40 px-3 py-2.5">
              <p class="text-[10px] text-brand-600">候选值</p>
              <p class="mt-1 break-words text-sm font-medium text-ink-900">
                {{ proposal.proposal.value || '—' }}
              </p>
            </div>
            <div class="rounded-soft border border-line bg-surface-soft px-3 py-2.5 text-center">
              <p class="text-[10px] text-ink-400">置信度</p>
              <p class="mt-1 text-sm font-semibold tabular-nums text-ink-900">
                {{ confidenceText(proposal.proposal.confidence) }}
              </p>
            </div>
          </div>

          <div
            v-if="proposal.proposal?.evidence"
            class="rounded-soft border border-line px-3 py-2.5"
          >
            <p class="text-[10px] text-ink-400">证据原文</p>
            <p
              class="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-600"
            >
              {{ proposal.proposal.evidence }}
            </p>
          </div>

          <div v-if="proposal.proposal?.sourceUrl" class="text-[11px]">
            <span class="text-ink-400">来源：</span>
            <a
              :href="proposal.proposal.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="break-all text-brand-600 hover:underline"
            >
              {{ proposal.proposal.sourceUrl }}
            </a>
          </div>

          <div
            v-if="proposal.proposal?.problems?.length"
            class="rounded-soft border border-amber-200 bg-amber-50/70 px-3 py-2.5"
          >
            <p class="text-[10px] font-medium text-amber-700">复核问题</p>
            <ul class="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-amber-700">
              <li v-for="problem in proposal.proposal.problems" :key="problem">{{ problem }}</li>
            </ul>
          </div>

          <p v-if="proposal.reason" class="text-[11px] leading-relaxed text-ink-500">
            {{ proposal.reason }}
          </p>

          <div class="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <button
              v-if="proposal.status === 'ready' && proposal.runId && !proposalApplied"
              data-testid="agent-apply"
              class="rounded-[10px] bg-brand-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
              :disabled="applyingId === proposal.runId"
              @click="adopt(proposal.runId)"
            >
              {{ applyingId === proposal.runId ? '写入中…' : '采纳并写入版本' }}
            </button>
            <span v-if="proposalApplied" class="text-[11px] font-medium text-mint-600">
              已采纳并写入版本记录
            </span>
            <span class="text-[10px] leading-relaxed text-ink-400">
              采纳会更新主表并写入 poi_version，operator 记为 agent:审核人@来源域名
            </span>
          </div>
        </div>
      </section>
    </div>

    <!-- 历史运行记录 -->
    <section class="rounded-card border border-line bg-surface shadow-card">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <p class="text-sm font-semibold text-ink-900">Agent 运行记录</p>
          <p class="mt-0.5 text-[11px] text-ink-400">可采纳 {{ readyCount }} 条 · 最近 50 次运行</p>
        </div>
        <div class="flex flex-wrap items-center gap-1">
          <button
            v-for="option in filterOptions"
            :key="option.key"
            class="rounded-lg px-2 py-1 text-[11px] transition"
            :class="
              filter === option.key
                ? 'bg-brand-50 font-medium text-brand-600'
                : 'text-ink-500 hover:bg-surface-soft'
            "
            @click="filter = option.key"
          >
            {{ option.label }} {{ filterCounts[option.key] }}
          </button>
          <button
            class="ml-1 rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-600 transition hover:border-brand-500/50 hover:text-brand-600 disabled:opacity-50"
            :disabled="runsLoading"
            @click="loadRuns()"
          >
            {{ runsLoading ? '刷新中…' : '刷新' }}
          </button>
        </div>
      </div>

      <div v-if="runsLoading && runs.length === 0" class="space-y-2 px-4 py-4">
        <div v-for="i in 4" :key="i" class="h-16 animate-pulse rounded-soft bg-surface-soft" />
      </div>

      <div
        v-else-if="filteredRuns.length === 0"
        class="px-4 py-12 text-center text-xs text-ink-400"
      >
        暂无 Agent 运行记录
      </div>

      <ul v-else data-testid="agent-runs" class="divide-y divide-line">
        <li v-for="run in filteredRuns" :key="run.id" class="px-4 py-3">
          <div class="flex flex-wrap items-start gap-3">
            <div class="min-w-0 flex-1">
              <p class="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink-900">
                #{{ run.id }}
                <span
                  class="rounded-full border px-1.5 py-0.5 text-[10px]"
                  :class="statusStyle[run.status] ?? 'border-line text-ink-500'"
                >
                  {{ statusLabel[run.status] ?? run.status }}
                </span>
                <span class="text-[10px] text-ink-400">
                  {{ run.entity_type === 'bank' ? '银行' : '小区' }} ·
                  {{ fieldLabel[run.field] ?? run.field }}
                </span>
              </p>
              <p class="mt-1 truncate text-[11px] text-ink-500">
                {{ run.entity_id }}
                <span v-if="run.proposal?.value"> · {{ run.proposal.value }}</span>
              </p>
              <p class="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-ink-400">
                <span>{{ run.created_at }}</span>
                <span v-if="run.reviewed_by">审核：{{ run.reviewed_by }}</span>
                <span v-if="run.proposal">
                  置信度 {{ confidenceText(run.proposal.confidence) }}
                </span>
              </p>
            </div>
            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <a
                v-if="run.proposal?.sourceUrl"
                :href="run.proposal.sourceUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-brand-600 transition hover:border-brand-500/40 hover:underline"
              >
                来源
              </a>
              <button
                class="rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-ink-500 transition hover:bg-surface-soft"
                @click="expandedId = expandedId === run.id ? null : run.id"
              >
                {{ expandedId === run.id ? '收起' : '详情' }}
              </button>
              <button
                v-if="run.status === 'ready'"
                data-testid="agent-run-apply"
                class="rounded-lg bg-brand-500 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
                :disabled="applyingId === run.id"
                @click="adopt(run.id)"
              >
                {{ applyingId === run.id ? '写入中…' : '采纳' }}
              </button>
            </div>
          </div>

          <div
            v-if="expandedId === run.id"
            class="mt-3 space-y-2 rounded-soft border border-line bg-surface-soft p-3"
          >
            <div v-if="run.proposal">
              <p class="text-[10px] text-ink-400">证据原文</p>
              <p
                class="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-600"
              >
                {{ run.proposal.evidence || '—' }}
              </p>
              <p v-if="run.proposal.sourceUrl" class="mt-2 text-[10px]">
                <a
                  :href="run.proposal.sourceUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="break-all text-brand-600 hover:underline"
                >
                  {{ run.proposal.sourceUrl }}
                </a>
              </p>
              <ul
                v-if="run.proposal.problems.length"
                class="mt-2 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-amber-700"
              >
                <li v-for="problem in run.proposal.problems" :key="problem">{{ problem }}</li>
              </ul>
            </div>
            <p v-else class="text-[11px] text-ink-400">没有结构化结果或结果解析失败</p>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
