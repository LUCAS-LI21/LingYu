import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type PhaseKey = 'requirement' | 'design' | 'dev' | 'test' | 'deploy' | 'ops'
export type TaskStatus = 'todo' | 'doing' | 'done'

export interface TaskItem {
  id: string
  title: string
  owner: string
  phase: PhaseKey
  status: TaskStatus
}

export const STATUS_FLOW: readonly TaskStatus[] = ['todo', 'doing', 'done']

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '待开始',
  doing: '进行中',
  done: '已完成',
}

export const PHASE_LABEL: Record<PhaseKey, string> = {
  requirement: '需求分析',
  design: '设计',
  dev: '实现',
  test: '测试',
  deploy: '部署',
  ops: '业务闭环',
}

const PHASE_ORDER: PhaseKey[] = ['requirement', 'design', 'dev', 'test', 'deploy', 'ops']

function createSeed(): TaskItem[] {
  return [
    {
      id: 't-1',
      title: '梳理 MVP 用户旅程与验收标准',
      owner: '产品',
      phase: 'requirement',
      status: 'done',
    },
    { id: 't-2', title: '确定设计规范与组件语义', owner: '设计', phase: 'design', status: 'done' },
    { id: 't-3', title: '搭建工程骨架与 CI 流水线', owner: '前端', phase: 'dev', status: 'doing' },
    { id: 't-4', title: '补齐单测与 E2E 关键路径', owner: '前端', phase: 'test', status: 'todo' },
    { id: 't-5', title: '配置容器化与灰度发布', owner: '运维', phase: 'deploy', status: 'todo' },
    { id: 't-6', title: '接入错误监控与埋点看板', owner: '全栈', phase: 'ops', status: 'todo' },
  ]
}

export const useBoardStore = defineStore('board', () => {
  const tasks = ref<TaskItem[]>(createSeed())
  const keyword = ref('')

  const filtered = computed<TaskItem[]>(() => {
    const kw = keyword.value.trim().toLowerCase()
    if (!kw) return tasks.value
    return tasks.value.filter(
      (item) => item.title.toLowerCase().includes(kw) || item.owner.toLowerCase().includes(kw),
    )
  })

  const stats = computed(() => {
    const total = tasks.value.length
    const done = tasks.value.filter((item) => item.status === 'done').length
    return {
      total,
      done,
      doing: tasks.value.filter((item) => item.status === 'doing').length,
      percent: total === 0 ? 0 : Math.round((done / total) * 100),
    }
  })

  const byPhase = computed(() =>
    PHASE_ORDER.map((phase) => ({
      phase,
      label: PHASE_LABEL[phase],
      items: tasks.value.filter((item) => item.phase === phase),
    })),
  )

  function addTask(title: string, phase: PhaseKey = 'requirement', owner = '我'): TaskItem {
    const item: TaskItem = {
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: title.trim(),
      owner,
      phase,
      status: 'todo',
    }
    tasks.value.unshift(item)
    return item
  }

  function advance(id: string): TaskStatus | undefined {
    const task = tasks.value.find((item) => item.id === id)
    if (!task) return undefined
    const index = STATUS_FLOW.indexOf(task.status)
    task.status = STATUS_FLOW[Math.min(index + 1, STATUS_FLOW.length - 1)] as TaskStatus
    return task.status
  }

  function remove(id: string): void {
    tasks.value = tasks.value.filter((item) => item.id !== id)
  }

  return { tasks, keyword, filtered, stats, byPhase, addTask, advance, remove }
})
