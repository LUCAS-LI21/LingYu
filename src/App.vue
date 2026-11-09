<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import ToastHost from '@/components/ToastHost.vue'

const route = useRoute()

const navItems = [
  { name: 'map', label: '地图', path: '/' },
  { name: 'list', label: '列表', path: '/list' },
  { name: 'stats', label: '洞察', path: '/stats' },
  { name: 'me', label: '用户后台', path: '/me' },
  { name: 'admin', label: '管理后台', path: '/admin' },
]

const activeName = computed(() => String(route.name ?? 'map'))
const version = __APP_VERSION__
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="sticky top-0 z-[1100] h-14 border-b border-line bg-surface/90 backdrop-blur">
      <div class="mx-auto flex h-full max-w-[1440px] items-center gap-3 px-3 sm:gap-5 sm:px-4">
        <RouterLink to="/" class="flex shrink-0 items-center gap-2">
          <span
            class="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 text-[13px] font-bold text-white shadow-card"
          >
            邻
          </span>
          <span class="hidden text-sm font-semibold tracking-tight text-ink-900 sm:inline">
            邻域 POI
          </span>
          <span
            class="hidden rounded-md bg-surface-soft px-1.5 py-0.5 text-[10px] text-ink-400 md:inline"
          >
            深圳
          </span>
        </RouterLink>

        <nav class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto sm:gap-1">
          <RouterLink
            v-for="item in navItems"
            :key="item.name"
            :to="item.path"
            class="shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 text-[12px] transition sm:px-3 sm:text-[13px]"
            :class="
              activeName === item.name
                ? 'bg-brand-50 font-medium text-brand-600'
                : 'text-ink-500 hover:bg-surface-soft hover:text-ink-900'
            "
          >
            {{ item.label }}
          </RouterLink>
        </nav>

        <div class="ml-auto flex shrink-0 items-center gap-3">
          <span
            class="hidden items-center gap-1.5 rounded-full border border-mint-500/20 bg-mint-50 px-2.5 py-1 text-[11px] text-mint-600 md:flex"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-mint-500" />
            数据合规
          </span>
          <span class="hidden text-[11px] text-ink-400 sm:inline">v{{ version }}</span>
        </div>
      </div>
    </header>

    <main class="flex-1">
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <ToastHost />
  </div>
</template>
