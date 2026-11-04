<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

const route = useRoute()

const navItems = [
  { name: 'home', label: '总览', path: '/' },
  { name: 'board', label: '任务看板', path: '/board' },
]

const activeName = computed(() => String(route.name ?? 'home'))
const buildStamp = `${__APP_VERSION__} · ${new Date(__BUILD_TIME__).toLocaleDateString('zh-CN')}`
</script>

<template>
  <el-config-provider :locale="zhCn">
    <div class="flex min-h-screen flex-col">
      <header class="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur">
        <div class="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <RouterLink to="/" class="flex items-center gap-2 text-base font-semibold text-slate-900">
            <span
              class="grid h-7 w-7 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white"
            >
              B
            </span>
            BISAI Agent
          </RouterLink>
          <nav class="flex items-center gap-1">
            <RouterLink
              v-for="item in navItems"
              :key="item.name"
              :to="item.path"
              class="rounded-lg px-3 py-1.5 text-sm transition"
              :class="
                activeName === item.name
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100'
              "
            >
              {{ item.label }}
            </RouterLink>
          </nav>
        </div>
      </header>

      <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <RouterView v-slot="{ Component }">
          <Transition name="fade" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>

      <footer class="border-t border-slate-200 bg-white">
        <div
          class="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>BISAI Agent · 全流程工程骨架</span>
          <span>构建 {{ buildStamp }}</span>
        </div>
      </footer>
    </div>
  </el-config-provider>
</template>
