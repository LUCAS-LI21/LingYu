<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'

import {
  PHASE_LABEL,
  STATUS_LABEL,
  useBoardStore,
  type PhaseKey,
  type TaskStatus,
} from '@/stores/board'
import { track } from '@/lib/telemetry'

const board = useBoardStore()
const draft = ref('')
const draftPhase = ref<PhaseKey>('requirement')

const phaseOptions = (Object.keys(PHASE_LABEL) as PhaseKey[]).map((key) => ({
  value: key,
  label: PHASE_LABEL[key],
}))

const tagType: Record<TaskStatus, 'info' | 'warning' | 'success'> = {
  todo: 'info',
  doing: 'warning',
  done: 'success',
}

const remaining = computed(() => board.tasks.filter((item) => item.status !== 'done').length)

function submit(): void {
  const title = draft.value.trim()
  if (!title) {
    ElMessage.warning('先写一句任务标题')
    return
  }
  const item = board.addTask(title, draftPhase.value)
  track('task_create', { phase: item.phase })
  draft.value = ''
  ElMessage.success('已加入看板')
}

function next(id: string): void {
  const status = board.advance(id)
  if (!status) return
  track('task_advance', { status })
  ElMessage.success(`已推进到「${STATUS_LABEL[status]}」`)
}

function drop(id: string): void {
  board.remove(id)
  track('task_remove', { id })
}
</script>

<template>
  <section class="space-y-6">
    <header class="space-y-2">
      <h1 class="text-2xl font-bold tracking-tight text-slate-900">任务看板</h1>
      <p class="text-sm text-slate-600">
        六阶段任务可视化。每次新增与推进都会写入埋点，便于观察真实流转效率。
      </p>
    </header>

    <div class="rounded-xl border border-slate-200 bg-white p-5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="text-xs text-slate-500">整体完成度</p>
          <p class="text-2xl font-semibold text-slate-900">
            {{ board.stats.percent }}<span class="text-base text-slate-400">%</span>
          </p>
        </div>
        <p class="text-xs text-slate-500">
          共 {{ board.stats.total }} 项 · 进行中 {{ board.stats.doing }} · 未完成 {{ remaining }}
        </p>
      </div>
      <el-progress
        class="mt-3"
        :percentage="board.stats.percent"
        :stroke-width="8"
        :show-text="false"
        color="#42b883"
      />
    </div>

    <div class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row">
      <el-input
        v-model="draft"
        placeholder="写下一个待办，例如：补齐登录页 E2E"
        clearable
        class="flex-1"
        @keyup.enter="submit"
      />
      <el-select v-model="draftPhase" class="sm:w-40">
        <el-option
          v-for="option in phaseOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <el-button type="primary" @click="submit">添加任务</el-button>
    </div>

    <div class="flex items-center justify-between gap-3">
      <el-input v-model="board.keyword" placeholder="搜索标题或负责人" clearable class="max-w-xs" />
      <span class="text-xs text-slate-400">共 {{ board.filtered.length }} 条</span>
    </div>

    <ul class="space-y-2">
      <li
        v-for="task in board.filtered"
        :key="task.id"
        class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
      >
        <el-tag :type="tagType[task.status]" size="small" effect="light">
          {{ STATUS_LABEL[task.status] }}
        </el-tag>
        <span
          class="min-w-0 flex-1 text-sm text-slate-800"
          :class="task.status === 'done' ? 'text-slate-400 line-through' : ''"
        >
          {{ task.title }}
        </span>
        <span class="text-xs text-slate-400">{{ PHASE_LABEL[task.phase] }} · {{ task.owner }}</span>
        <el-button size="small" :disabled="task.status === 'done'" @click="next(task.id)">
          推进
        </el-button>
        <el-button size="small" text type="danger" @click="drop(task.id)">删除</el-button>
      </li>
    </ul>

    <el-empty v-if="board.filtered.length === 0" description="没有匹配的任务" />
  </section>
</template>
