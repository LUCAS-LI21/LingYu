<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import CorrectionComposer from '@/components/CorrectionComposer.vue'
import {
  clearFeedbackHistory,
  feedbackStatusText,
  formatFeedbackTime,
  listFeedbackHistory,
  type StoredFeedback,
} from '@/lib/feedbackHistory'
import { toast } from '@/lib/toast'

type Tab = 'correct' | 'history'

const route = useRoute()
const router = useRouter()

const tab = ref<Tab>('correct')
const history = ref<StoredFeedback[]>([])
const nickname = ref('')
const contact = ref('')
const savedProfile = ref(false)

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'correct', label: '纠错 / 补充' },
  { key: 'history', label: '我的反馈' },
]

const pendingCount = computed(
  () => history.value.filter((item) => item.status === 'pending').length,
)

const statusStyle: Record<string, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-600',
  auto_applied: 'border-mint-500/25 bg-mint-50 text-mint-600',
  approved: 'border-mint-500/25 bg-mint-50 text-mint-600',
  rejected: 'border-red-200 bg-red-50 text-red-500',
  need_refetch: 'border-brand-500/25 bg-brand-50 text-brand-600',
}

function readProfile(): void {
  try {
    const raw = localStorage.getItem('poi_user_profile_v1')
    if (!raw) return
    const parsed = JSON.parse(raw) as { nickname?: string; contact?: string }
    nickname.value = parsed.nickname ?? ''
    contact.value = parsed.contact ?? ''
  } catch {
    // 忽略损坏的本机档案
  }
}

function saveProfile(): void {
  try {
    localStorage.setItem(
      'poi_user_profile_v1',
      JSON.stringify({ nickname: nickname.value.trim(), contact: contact.value.trim() }),
    )
    savedProfile.value = true
    toast('本机档案已保存', 'success')
    setTimeout(() => {
      savedProfile.value = false
    }, 1800)
  } catch {
    toast('浏览器存储不可用，档案未保存', 'error')
  }
}

function applyRouteTab(): void {
  const value = String(route.query.tab ?? '')
  if (value === 'correct' || value === 'history') {
    tab.value = value
  }
}

function switchTab(next: Tab): void {
  tab.value = next
  void router.replace({ query: { ...route.query, tab: next } })
  if (next === 'history') history.value = listFeedbackHistory()
}

function onSubmitted(): void {
  history.value = listFeedbackHistory()
}

function onClearHistory(): void {
  clearFeedbackHistory()
  history.value = []
  toast('已清除本机提交记录', 'info')
}

onMounted(() => {
  readProfile()
  history.value = listFeedbackHistory()
  applyRouteTab()
})

watch(
  () => route.query.tab,
  () => applyRouteTab(),
)
</script>

<template>
  <div class="mx-auto w-full max-w-[1200px] px-4 py-6">
    <header class="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold tracking-tight text-ink-900">用户后台</h1>
        <p class="mt-1 text-xs text-ink-500">
          访客模式 · 对数据纠错、补充与关闭；提交后进入运营审核队列，并可用于优化采集优先级
        </p>
      </div>

      <div
        class="flex w-full max-w-md flex-wrap items-end gap-2 rounded-card border border-line bg-surface p-3 shadow-card sm:w-auto"
      >
        <label class="min-w-0 flex-1">
          <span class="mb-1 block text-[10px] text-ink-400">昵称（选填）</span>
          <input
            v-model="nickname"
            class="h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-[11px] text-ink-700 outline-none focus:border-brand-500"
            placeholder="本机访客"
          />
        </label>
        <label class="min-w-0 flex-1">
          <span class="mb-1 block text-[10px] text-ink-400">联系方式</span>
          <input
            v-model="contact"
            class="h-8 w-full rounded-lg border border-line bg-surface px-2.5 text-[11px] text-ink-700 outline-none focus:border-brand-500"
            placeholder="邮箱 / 手机"
          />
        </label>
        <button
          class="h-8 shrink-0 rounded-lg bg-brand-500 px-3 text-[11px] font-medium text-white transition hover:bg-brand-600"
          @click="saveProfile"
        >
          {{ savedProfile ? '已保存' : '保存' }}
        </button>
      </div>
    </header>

    <nav
      class="mb-4 flex gap-1 overflow-x-auto rounded-[12px] border border-line bg-surface-soft p-1"
    >
      <button
        v-for="item in tabs"
        :key="item.key"
        class="shrink-0 flex-1 whitespace-nowrap rounded-[9px] px-3 py-2 text-xs transition"
        :class="
          tab === item.key
            ? 'bg-surface font-medium text-ink-900 shadow-card'
            : 'text-ink-500 hover:text-ink-700'
        "
        @click="switchTab(item.key)"
      >
        {{ item.label }}
        <span
          v-if="item.key === 'history' && history.length"
          class="ml-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-600"
        >
          {{ history.length }}
        </span>
      </button>
    </nav>

    <div v-if="tab === 'correct'">
      <CorrectionComposer
        mode="user"
        :initial-contact="contact"
        @submitted="onSubmitted"
        @history="switchTab('history')"
      />
    </div>

    <div v-else class="rounded-card border border-line bg-surface shadow-card">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <p class="text-sm font-semibold text-ink-900">我的反馈</p>
          <p class="mt-0.5 text-[11px] text-ink-400">
            共 {{ history.length }} 条 · 待审核 {{ pendingCount }} 条 ·
            记录保存在本机浏览器，审核结果以运营后台为准
          </p>
        </div>
        <button
          v-if="history.length"
          class="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-500 transition hover:border-red-200 hover:text-red-500"
          @click="onClearHistory"
        >
          清除本机记录
        </button>
      </div>

      <div v-if="history.length === 0" class="px-4 py-14 text-center text-xs text-ink-400">
        <p>还没有提交记录</p>
        <button
          class="mt-3 rounded-[10px] bg-brand-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-brand-600"
          @click="switchTab('correct')"
        >
          去纠错 / 补充
        </button>
      </div>

      <ul v-else class="divide-y divide-line">
        <li v-for="item in history" :key="item.code" class="px-4 py-3.5">
          <div class="flex flex-wrap items-start gap-3">
            <div class="min-w-0 flex-1">
              <p class="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink-900">
                {{ item.poiName || item.poiId }}
                <span
                  class="rounded-full border px-1.5 py-0.5 text-[10px]"
                  :class="statusStyle[item.status] ?? 'border-line text-ink-500'"
                >
                  {{ feedbackStatusText(item.status) }}
                </span>
                <span class="text-[10px] text-ink-400">
                  {{ item.type === 'closed' ? '已关闭' : item.type === 'add' ? '补充' : '纠错' }}
                </span>
              </p>
              <p class="mt-1 text-xs text-ink-500">
                {{ item.field }}{{ item.newValue ? ` → ${item.newValue}` : '' }} ·
                {{ item.description }}
              </p>
              <p class="mt-1 text-[11px] text-ink-400">
                {{ item.code }} · {{ item.poiType === 'bank' ? '银行' : '小区' }} ·
                {{ formatFeedbackTime(item.createdAt) }}
              </p>
            </div>
            <p class="shrink-0 text-[10px] text-ink-400">
              {{ item.contact || '未留联系方式' }}
            </p>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
