<script setup lang="ts">
import { computed, ref } from 'vue'

import { submitFeedback, type FeedbackPayload } from '@/api/pois'
import { toast } from '@/lib/toast'
import type { Poi } from '@/types/poi'

const props = defineProps<{ poi: Poi; initialField?: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'submitted', code: string): void }>()

const type = ref<FeedbackPayload['type']>('error')
// 从「地址待补充」入口进来时预选字段，少点一次
const field = ref(props.initialField ?? '')
const newValue = ref('')
const description = ref('')
const contact = ref('')
const submitting = ref(false)

const fieldOptions = computed(() =>
  props.poi.type === 'bank'
    ? ['名称', '地址', '电话', '营业时间']
    : ['名称', '地址', '建成年份', '均价', '物业费'],
)

async function handleSubmit(): Promise<void> {
  if (!field.value || !description.value.trim()) {
    toast('请填写问题字段与说明', 'error')
    return
  }
  submitting.value = true
  try {
    const record = await submitFeedback({
      poiType: props.poi.type,
      poiId: props.poi.id,
      poiName: props.poi.name,
      type: type.value,
      field: field.value,
      newValue: newValue.value.trim(),
      description: description.value.trim(),
      contact: contact.value.trim(),
    })
    toast(`反馈已提交：${record.code}`, 'success')
    emit('submitted', record.code)
    emit('close')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[2000] flex items-end justify-center bg-ink-900/25 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
    >
      <div
        class="w-full max-w-lg overflow-hidden rounded-t-card border border-line bg-surface shadow-pop sm:rounded-card"
      >
        <header class="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h3 class="text-sm font-semibold text-ink-900">提交纠错 / 补充</h3>
            <p class="mt-0.5 text-xs text-ink-500">{{ poi.name }} · {{ poi.district }}</p>
          </div>
          <button
            class="grid h-7 w-7 place-items-center rounded-lg text-ink-400 transition hover:bg-surface-soft hover:text-ink-700"
            @click="emit('close')"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
            </svg>
          </button>
        </header>

        <div class="space-y-4 px-5 py-4">
          <div>
            <p class="mb-1.5 text-[11px] font-medium text-ink-400">反馈类型</p>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="option in [
                  { label: '信息有误', value: 'error' },
                  { label: '已关闭', value: 'closed' },
                  { label: '新增点位', value: 'add' },
                ]"
                :key="option.value"
                class="rounded-[10px] border py-2 text-xs transition"
                :class="
                  type === option.value
                    ? 'border-brand-500/60 bg-brand-50 font-medium text-brand-600'
                    : 'border-line text-ink-500 hover:border-line-strong'
                "
                @click="type = option.value as FeedbackPayload['type']"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1.5 block text-[11px] font-medium text-ink-400">问题字段</span>
              <select
                v-model="field"
                class="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-xs text-ink-700 outline-none focus:border-brand-500"
              >
                <option value="" disabled>请选择</option>
                <option v-for="item in fieldOptions" :key="item" :value="item">{{ item }}</option>
              </select>
            </label>
            <label class="block">
              <span class="mb-1.5 block text-[11px] font-medium text-ink-400">正确值（选填）</span>
              <input
                v-model="newValue"
                class="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-xs text-ink-700 outline-none transition focus:border-brand-500"
                placeholder="例如：9:00-17:30"
              />
            </label>
          </div>

          <label class="block">
            <span class="mb-1.5 block text-[11px] font-medium text-ink-400">问题说明（必填）</span>
            <textarea
              v-model="description"
              rows="3"
              class="w-full resize-none rounded-[10px] border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-ink-700 outline-none transition focus:border-brand-500"
              placeholder="请描述你看到的情况，例如：该网点已搬迁至对面"
            />
          </label>

          <label class="block">
            <span class="mb-1.5 block text-[11px] font-medium text-ink-400">联系方式（选填）</span>
            <input
              v-model="contact"
              class="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-xs text-ink-700 outline-none transition focus:border-brand-500"
              placeholder="邮箱或手机号，便于回访"
            />
          </label>

          <p
            class="rounded-soft bg-surface-soft px-3 py-2 text-[11px] leading-relaxed text-ink-400"
          >
            低风险字段（电话、营业时间、均价）提交后先以「用户提供 ·
            待核实」展示；坐标与名称变更进入人工审核队列。
          </p>
        </div>

        <footer class="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <button
            class="rounded-[10px] border border-line px-4 py-2 text-xs text-ink-600 transition hover:bg-surface-soft"
            @click="emit('close')"
          >
            取消
          </button>
          <button
            class="rounded-[10px] bg-brand-500 px-4 py-2 text-xs font-medium text-white shadow-card transition hover:bg-brand-600 disabled:opacity-60"
            :disabled="submitting"
            @click="handleSubmit"
          >
            {{ submitting ? '提交中…' : '提交反馈' }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
