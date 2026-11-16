<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  loadPois,
  searchPois,
  submitFeedback,
  type FeedbackPayload,
  type FeedbackRecord,
} from '@/api/pois'
import { feedbackStatusText } from '@/lib/feedbackHistory'
import { toast } from '@/lib/toast'
import type { Poi } from '@/types/poi'

const props = withDefaults(
  defineProps<{
    mode?: 'user' | 'admin'
    initialPoi?: Poi | null
    initialContact?: string
  }>(),
  { mode: 'user', initialPoi: null, initialContact: '' },
)

const emit = defineEmits<{
  (e: 'submitted', record: FeedbackRecord): void
  (e: 'review'): void
  (e: 'history'): void
}>()

const keyword = ref('')
const results = ref<Poi[]>([])
const searching = ref(false)
const searchTouched = ref(false)
const selected = ref<Poi | null>(props.initialPoi)
const type = ref<FeedbackPayload['type']>('error')
const field = ref('')
const newValue = ref('')
const description = ref('')
const contact = ref(props.initialContact)
const submitting = ref(false)
const record = ref<FeedbackRecord | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | null = null

const fieldOptions = computed(() => {
  if (!selected.value) return []
  return selected.value.type === 'bank'
    ? ['地址', '电话', '营业时间', '名称']
    : ['地址', '建成年份', '均价', '物业费', '名称']
})

const typeOptions: Array<{ value: FeedbackPayload['type']; label: string; hint: string }> = [
  { value: 'error', label: '信息有误', hint: '字段写错了，提交正确值' },
  { value: 'closed', label: '已关闭', hint: '网点/小区已不存在，审核后下架' },
  { value: 'add', label: '补充 / 新增', hint: '缺失信息或需要重新采集' },
]

const isAdmin = computed(() => props.mode === 'admin')
const canSubmit = computed(
  () =>
    Boolean(selected.value) &&
    Boolean(description.value.trim()) &&
    Boolean(field.value) &&
    // 「补充/新增」必须给出新点位名称，否则后端只能拿问题说明当名字
    (type.value !== 'add' || Boolean(newValue.value.trim())),
)

function poiTypeLabel(poi: Poi): string {
  if (poi.type === 'community') return '住宅小区'
  return poi.branchType === 'atm' ? '银行 ATM' : '银行网点'
}

function formatAddress(poi: Poi): string {
  return poi.address?.trim() || '地址待补充'
}

function runSearch(term: string): void {
  if (searchTimer) clearTimeout(searchTimer)
  const value = term.trim()
  if (!value) {
    results.value = []
    searching.value = false
    return
  }
  searching.value = true
  searchTimer = setTimeout(async () => {
    try {
      results.value = await searchPois(value, 8)
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
  results.value = []
  keyword.value = ''
  searchTouched.value = false
  if (!fieldOptions.value.includes(field.value)) field.value = '地址'
}

function clearPoi(): void {
  selected.value = null
  field.value = ''
  results.value = []
}

function resetForm(): void {
  record.value = null
  selected.value = null
  type.value = 'error'
  field.value = ''
  newValue.value = ''
  description.value = ''
  keyword.value = ''
  results.value = []
  searchTouched.value = false
}

async function handleSubmit(): Promise<void> {
  if (!selected.value) {
    toast('请先搜索并选择要点位', 'error')
    return
  }
  if (!description.value.trim()) {
    toast('请填写问题说明', 'error')
    return
  }
  submitting.value = true
  try {
    const saved = await submitFeedback({
      poiType: selected.value.type,
      poiId: selected.value.id,
      poiName: selected.value.name,
      type: type.value,
      field: field.value,
      newValue: newValue.value.trim(),
      description: description.value.trim(),
      contact: contact.value.trim(),
    })
    record.value = saved
    toast(`反馈已提交：${saved.code}`, 'success')
    emit('submitted', saved)
  } catch (error) {
    toast(error instanceof Error ? error.message : '提交失败，请稍后重试', 'error')
  } finally {
    submitting.value = false
  }
}

watch(keyword, (value) => runSearch(value))

watch(type, () => {
  if (!selected.value) return
  if (!fieldOptions.value.includes(field.value)) field.value = '地址'
})

watch(
  selected,
  (poi) => {
    if (!poi) return
    if (!fieldOptions.value.includes(field.value)) field.value = '地址'
  },
  { immediate: true },
)

onMounted(() => {
  // 预加载全量点位，之后搜索在本地完成，输入不反复打后端
  void loadPois().catch(() => {})
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<template>
  <div class="space-y-4">
    <!-- 模式说明：用户端 / 管理端共用同一套表单，仅文案与提交后动作不同 -->
    <div
      class="flex flex-wrap items-center gap-2 rounded-soft border border-line bg-surface-soft px-3.5 py-2.5"
    >
      <span
        class="rounded-full px-2 py-0.5 text-[10px] font-medium"
        :class="isAdmin ? 'bg-brand-50 text-brand-600' : 'bg-mint-50 text-mint-600'"
      >
        {{ isAdmin ? '管理员代录' : '用户提交' }}
      </span>
      <p class="text-[11px] leading-relaxed text-ink-500">
        {{
          isAdmin
            ? '与用户后台共用同一套纠错表单；提交后同样进入审核队列，可由运营复核。'
            : '纠错、关闭、补充都会进入运营审核队列；低风险字段会先以「用户提供」展示。'
        }}
      </p>
    </div>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <!-- 1. 选择点位 -->
      <section class="rounded-card border border-line bg-surface p-4 shadow-card">
        <div class="mb-3 flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold text-ink-900">1. 选择点位</p>
            <p class="mt-0.5 text-[11px] text-ink-400">按名称 / 地址 / 区域搜索</p>
          </div>
          <span class="text-[10px] text-ink-400">{{ isAdmin ? '全量库' : '本地库' }}</span>
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
            data-testid="correction-search"
            class="h-9 w-full rounded-[10px] border border-line bg-surface pl-9 pr-3 text-xs text-ink-700 outline-none transition placeholder:text-ink-400 focus:border-brand-500"
            placeholder="例如：招商银行、车公庙、万科"
          />
        </div>

        <div
          v-if="selected"
          class="mt-3 rounded-soft border border-brand-500/25 bg-brand-50/50 p-3"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate text-xs font-medium text-ink-900">{{ selected.name }}</p>
              <p class="mt-0.5 truncate text-[11px] text-ink-500">{{ formatAddress(selected) }}</p>
            </div>
            <button
              class="shrink-0 text-[11px] text-brand-600 transition hover:underline"
              @click="clearPoi"
            >
              换一个
            </button>
          </div>
          <p class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-400">
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
              data-testid="correction-result"
              class="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-left transition hover:border-brand-500/40 hover:bg-brand-50/30"
              @click="selectPoi(poi)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[11px] font-medium text-ink-700">{{
                  poi.name
                }}</span>
                <span class="mt-0.5 block truncate text-[10px] text-ink-400">{{
                  formatAddress(poi)
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
          没有匹配点位，试试更短的关键词
        </p>
        <p
          v-else-if="!selected"
          class="mt-3 rounded-lg border border-dashed border-line-strong px-3 py-4 text-[11px] leading-relaxed text-ink-400"
        >
          搜索结果会显示名称、地址与类型；点选后再填写右侧纠错内容。
        </p>
      </section>

      <!-- 2. 填写内容 / 成功回执 -->
      <section class="rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
        <template v-if="!record">
          <div class="mb-3">
            <p class="text-sm font-semibold text-ink-900">2. 填写纠正内容</p>
            <p class="mt-0.5 text-[11px] text-ink-400">
              {{ selected ? `当前点位：${selected.name}` : '先选择左侧点位' }}
            </p>
          </div>

          <div>
            <p class="mb-1.5 text-[11px] font-medium text-ink-400">反馈类型</p>
            <div class="grid gap-2 sm:grid-cols-3">
              <button
                v-for="option in typeOptions"
                :key="option.value"
                type="button"
                class="rounded-[10px] border px-3 py-2 text-left transition"
                :class="
                  type === option.value
                    ? 'border-brand-500/60 bg-brand-50'
                    : 'border-line bg-surface hover:border-line-strong'
                "
                @click="type = option.value"
              >
                <span
                  class="block text-xs font-medium"
                  :class="type === option.value ? 'text-brand-600' : 'text-ink-700'"
                  >{{ option.label }}</span
                >
                <span class="mt-0.5 block text-[10px] leading-relaxed text-ink-400">{{
                  option.hint
                }}</span>
              </button>
            </div>
          </div>

          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1.5 block text-[11px] font-medium text-ink-400">问题字段</span>
              <select
                v-model="field"
                :disabled="!selected || type === 'closed'"
                class="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-xs text-ink-700 outline-none transition focus:border-brand-500 disabled:bg-surface-soft disabled:text-ink-400"
              >
                <option v-if="!selected" value="">请先选择点位</option>
                <option v-for="item in fieldOptions" :key="item" :value="item">{{ item }}</option>
              </select>
            </label>
            <label class="block">
              <span class="mb-1.5 block text-[11px] font-medium text-ink-400">
                {{ type === 'add' ? '新点位名称（必填）' : '正确值（选填）' }}
              </span>
              <input
                v-model="newValue"
                :disabled="!selected || type === 'closed'"
                class="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-xs text-ink-700 outline-none transition placeholder:text-ink-400 focus:border-brand-500 disabled:bg-surface-soft"
                :placeholder="type === 'add' ? '例如：兴业银行深圳科技园支行' : '例如：09:00-18:00'"
              />
            </label>
          </div>

          <label class="mt-3 block">
            <span class="mb-1.5 block text-[11px] font-medium text-ink-400">问题说明（必填）</span>
            <textarea
              v-model="description"
              data-testid="correction-description"
              rows="4"
              class="w-full resize-none rounded-[10px] border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-ink-700 outline-none transition placeholder:text-ink-400 focus:border-brand-500"
              :placeholder="
                type === 'closed'
                  ? '例如：该网点已撤并，原址已改为其他商铺'
                  : '例如：该小区实际建成年份是 2008 年，不是 2012 年'
              "
            />
          </label>

          <label class="mt-3 block">
            <span class="mb-1.5 block text-[11px] font-medium text-ink-400">联系方式（选填）</span>
            <input
              v-model="contact"
              class="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-xs text-ink-700 outline-none transition placeholder:text-ink-400 focus:border-brand-500"
              placeholder="邮箱或手机号，便于回访"
            />
          </label>

          <div
            class="mt-4 rounded-soft bg-surface-soft px-3 py-2 text-[11px] leading-relaxed text-ink-400"
          >
            <p v-if="type === 'closed'">
              「已关闭」审核通过后点位会从默认查询中下架；管理员可在后台恢复。
            </p>
            <p v-else-if="type === 'add'">
              「补充 / 新增」审核通过后：名称进「待定位网点 /
              小区」队列，同时以当前点位为锚点生成定向抓取任务。若知道地址，可在问题说明里写「地址：xxx」，会一并带入。
            </p>
            <p v-else>
              字段变更会写入版本记录；名称与坐标类变更必须人工审核，低风险字段可能自动生效。
            </p>
          </div>

          <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p class="text-[10px] text-ink-400">
              {{
                selected
                  ? `将提交到：${selected.name}（#${selected.id.slice(-4)}）`
                  : '尚未选择点位'
              }}
            </p>
            <button
              type="button"
              data-testid="correction-submit"
              class="rounded-[10px] bg-brand-500 px-5 py-2 text-xs font-medium text-white shadow-card transition hover:bg-brand-600 disabled:opacity-50"
              :disabled="!canSubmit || submitting"
              @click="handleSubmit"
            >
              {{ submitting ? '提交中…' : '提交到审核队列' }}
            </button>
          </div>
        </template>

        <template v-else>
          <div class="flex flex-col items-center py-8 text-center">
            <span class="grid h-12 w-12 place-items-center rounded-full bg-mint-50 text-mint-600">
              <svg
                class="h-6 w-6"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M5 12l4 4L19 6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <h3 class="mt-3 text-sm font-semibold text-ink-900">已提交，等待审核</h3>
            <p class="mt-1 text-xs text-ink-500">
              反馈编号 <span class="font-medium text-ink-700">{{ record.code }}</span> ·
              {{ feedbackStatusText(record.status) }}
            </p>
            <p class="mt-2 max-w-sm text-[11px] leading-relaxed text-ink-400">
              {{
                record.status === 'auto_applied'
                  ? '低风险字段已自动受理，运营复核后会写入版本记录。'
                  : '已进入运营审核队列，审核通过后数据会更新并留下版本记录。'
              }}
            </p>
            <div class="mt-5 flex flex-wrap justify-center gap-2">
              <button
                class="rounded-[10px] border border-line px-4 py-2 text-xs text-ink-600 transition hover:bg-surface-soft"
                @click="resetForm"
              >
                继续提交
              </button>
              <button
                v-if="isAdmin"
                class="rounded-[10px] bg-brand-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-brand-600"
                @click="emit('review')"
              >
                去审核队列
              </button>
              <button
                v-else
                class="rounded-[10px] bg-brand-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-brand-600"
                @click="emit('history')"
              >
                查看我的反馈
              </button>
            </div>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>
