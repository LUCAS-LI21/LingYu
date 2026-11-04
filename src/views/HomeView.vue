<script setup lang="ts">
import { markRaw } from 'vue'
import { ElMessage } from 'element-plus'

import IconSearch from '~icons/ep/search'
import IconBrush from '~icons/ep/brush'
import IconMonitor from '~icons/ep/monitor'
import IconCircleCheck from '~icons/ep/circle-check'
import IconUpload from '~icons/ep/upload'
import IconRefresh from '~icons/ep/refresh'

import PhaseCard from '@/components/PhaseCard.vue'
import { track } from '@/lib/telemetry'

interface Phase {
  index: number
  title: string
  subtitle: string
  desc: string
  icon: typeof IconSearch
  tools: string[]
}

const phases: Phase[] = [
  {
    index: 1,
    title: '需求分析',
    subtitle: 'Requirement',
    desc: '把模糊诉求拆成可验收的用户故事，用文档站沉淀 PRD、流程图与验收标准。',
    icon: markRaw(IconSearch),
    tools: ['VitePress', 'Markdown', 'ADR'],
  },
  {
    index: 2,
    title: '设计',
    subtitle: 'Design',
    desc: '设计令牌统一色板/间距，组件与页面在实现前即可预览，减少返工。',
    icon: markRaw(IconBrush),
    tools: ['Tailwind v4', 'Element Plus', 'Iconify'],
  },
  {
    index: 3,
    title: '实现',
    subtitle: 'Implement',
    desc: 'Vite 秒级热更新，TS 全链路类型，自动导入与按需加载把样板代码降到最低。',
    icon: markRaw(IconMonitor),
    tools: ['Vite', 'Vue 3', 'Pinia', 'ESLint'],
  },
  {
    index: 4,
    title: '测试',
    subtitle: 'Test',
    desc: '单元、组件、接口三层用 Vitest 覆盖，关键路径交给 Playwright 真实浏览器回归。',
    icon: markRaw(IconCircleCheck),
    tools: ['Vitest', 'Test Utils', 'MSW', 'Playwright'],
  },
  {
    index: 5,
    title: '部署',
    subtitle: 'Deploy',
    desc: '多阶段构建产出静态镜像，Nginx 负责 SPA 回退与缓存，一条命令起环境。',
    icon: markRaw(IconUpload),
    tools: ['Docker', 'Nginx', 'GitHub Actions'],
  },
  {
    index: 6,
    title: '业务闭环',
    subtitle: 'Operations',
    desc: '错误监控、Core Web Vitals、业务埋点三线并行，让线上表现可度量、可回归。',
    icon: markRaw(IconRefresh),
    tools: ['Sentry', 'web-vitals', '埋点'],
  },
]

const commands = [
  { cmd: 'pnpm dev', desc: '本地开发（热更新 + 代理后端）' },
  { cmd: 'pnpm check', desc: 'Lint + 格式化 + 类型 + 单测 一键体检' },
  { cmd: 'pnpm e2e', desc: '真实浏览器跑关键路径' },
  { cmd: 'pnpm build', desc: '类型检查 + 生产构建' },
  { cmd: 'pnpm docs:dev', desc: '需求/设计文档站' },
]

function onStageClick(title: string): void {
  track('phase_click', { phase: title })
  ElMessage.success(`已记录：${title} 阶段被查看`)
}
</script>

<template>
  <section class="space-y-8">
    <div class="space-y-3">
      <p class="text-xs font-medium tracking-widest text-brand-600">FULL LIFECYCLE TOOLCHAIN</p>
      <h1 class="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        网站开发六阶段，一套工具链跑通
      </h1>
      <p class="max-w-2xl text-sm leading-relaxed text-slate-600">
        从需求到业务闭环，每个阶段都有对应的主力插件与命令。工程骨架已就绪，直接
        <code class="rounded bg-slate-100 px-1.5 py-0.5 text-[13px]">pnpm dev</code> 即可开工。
      </p>
      <div class="flex flex-wrap gap-2 pt-1">
        <el-button type="primary" @click="onStageClick('开始')">开始体验埋点</el-button>
        <el-button plain @click="$router.push('/board')">进入任务看板</el-button>
      </div>
    </div>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <PhaseCard
        v-for="phase in phases"
        :key="phase.index"
        :index="phase.index"
        :title="phase.title"
        :subtitle="phase.subtitle"
        :desc="phase.desc"
        :icon="phase.icon"
        :tools="phase.tools"
        class="cursor-pointer"
        @click="onStageClick(phase.title)"
      />
    </div>

    <div class="rounded-xl border border-slate-200 bg-white p-5">
      <h2 class="text-sm font-semibold text-slate-900">常用命令</h2>
      <ul class="mt-3 divide-y divide-slate-100">
        <li
          v-for="item in commands"
          :key="item.cmd"
          class="flex items-center justify-between gap-4 py-2 text-sm"
        >
          <code class="rounded bg-slate-900/90 px-2 py-1 text-xs text-slate-100">{{
            item.cmd
          }}</code>
          <span class="text-right text-xs text-slate-500">{{ item.desc }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
