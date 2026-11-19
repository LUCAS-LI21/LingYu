<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { clearToken, isLoggedIn } from '@/api/auth'
import ToastHost from '@/components/ToastHost.vue'

const route = useRoute()

const navItems = [
  { name: 'map', label: '地图', path: '/' },
  { name: 'list', label: '列表', path: '/list' },
  { name: 'stats', label: '洞察', path: '/stats' },
]

const activeName = computed(() => String(route.name ?? 'map'))
const version = __APP_VERSION__
const menuOpen = ref(false)
const authed = ref(isLoggedIn())
const accountMenu = ref<HTMLElement | null>(null)

function refreshAuth(): void {
  authed.value = isLoggedIn()
}

function toggleMenu(): void {
  refreshAuth()
  menuOpen.value = !menuOpen.value
}

function closeMenu(): void {
  menuOpen.value = false
}

function logout(): void {
  clearToken()
  authed.value = false
  closeMenu()
  if (route.name === 'admin') {
    window.location.assign('/admin')
  }
}

function onDocumentClick(event: MouseEvent): void {
  if (!menuOpen.value) return
  const target = event.target as Node | null
  if (target && accountMenu.value?.contains(target)) return
  closeMenu()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMenu()
}

onMounted(() => {
  refreshAuth()
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})

watch(
  () => route.fullPath,
  () => {
    closeMenu()
    refreshAuth()
  },
)
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
            邻域
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

        <div class="ml-auto flex shrink-0 items-center gap-2.5 sm:gap-3">
          <RouterLink
            to="/compliance"
            class="hidden items-center gap-1.5 rounded-full border border-mint-500/20 bg-mint-50 px-2.5 py-1 text-[11px] text-mint-600 transition hover:border-mint-500/40 hover:bg-mint-100/70 md:flex"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-mint-500" />
            数据合规
          </RouterLink>
          <span class="hidden text-[11px] text-ink-400 sm:inline">v{{ version }}</span>

          <div ref="accountMenu" class="relative">
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-1 pr-2 text-[12px] text-ink-600 shadow-sm transition hover:border-line-strong hover:text-ink-900"
              :aria-expanded="menuOpen"
              aria-haspopup="menu"
              @click="toggleMenu"
            >
              <span
                class="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold"
                :class="authed ? 'bg-mint-50 text-mint-600' : 'bg-brand-50 text-brand-600'"
              >
                {{ authed ? '管' : '访' }}
              </span>
              <span class="hidden sm:inline">{{ authed ? '运营账号' : '访客' }}</span>
              <svg
                class="h-3 w-3 text-ink-400 transition"
                :class="{ 'rotate-180': menuOpen }"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>

            <Transition
              enter-active-class="transition duration-150 ease-out"
              enter-from-class="translate-y-1 opacity-0"
              leave-active-class="transition duration-100 ease-in"
              leave-to-class="translate-y-1 opacity-0"
            >
              <div
                v-if="menuOpen"
                class="absolute right-0 top-[calc(100%+0.5rem)] z-[1200] w-56 overflow-hidden rounded-card border border-line bg-surface p-1.5 shadow-float"
                role="menu"
              >
                <RouterLink
                  to="/me"
                  class="flex items-start gap-2.5 rounded-xl px-3 py-2.5 transition hover:bg-surface-soft"
                  @click="closeMenu"
                >
                  <span
                    class="mt-0.5 grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-[10px] font-semibold text-brand-600"
                  >
                    我
                  </span>
                  <span>
                    <span class="block text-xs font-medium text-ink-900">用户后台</span>
                    <span class="mt-0.5 block text-[10px] text-ink-400">纠错、补充与我的反馈</span>
                  </span>
                </RouterLink>

                <RouterLink
                  to="/admin"
                  class="flex items-start gap-2.5 rounded-xl px-3 py-2.5 transition hover:bg-surface-soft"
                  @click="closeMenu"
                >
                  <span
                    class="mt-0.5 grid h-7 w-7 place-items-center rounded-lg"
                    :class="authed ? 'bg-mint-50 text-mint-600' : 'bg-surface-soft text-ink-400'"
                  >
                    <svg
                      v-if="authed"
                      class="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.9"
                    >
                      <path d="M4 20V9l8-5 8 5v11" stroke-linecap="round" stroke-linejoin="round" />
                      <path d="M9 20v-6h6v6" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    <svg
                      v-else
                      class="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.9"
                    >
                      <rect x="5" y="10" width="14" height="10" rx="2" />
                      <path d="M8 10V7a4 4 0 118 0v3" stroke-linecap="round" />
                    </svg>
                  </span>
                  <span class="min-w-0">
                    <span class="block text-xs font-medium text-ink-900">
                      {{ authed ? '管理后台' : '登录管理后台' }}
                    </span>
                    <span class="mt-0.5 block text-[10px] text-ink-400">
                      {{ authed ? '审核、Agent、任务与热点' : '需要运营账号登录' }}
                    </span>
                  </span>
                </RouterLink>

                <RouterLink
                  to="/compliance"
                  class="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs text-ink-600 transition hover:bg-surface-soft"
                  @click="closeMenu"
                >
                  <span
                    class="grid h-7 w-7 place-items-center rounded-lg bg-surface-soft text-[10px]"
                  >
                    源
                  </span>
                  数据说明
                </RouterLink>

                <div class="my-1 h-px bg-line" />

                <button
                  v-if="authed"
                  type="button"
                  class="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs text-ink-500 transition hover:bg-red-50 hover:text-red-600"
                  @click="logout"
                >
                  <span
                    class="grid h-7 w-7 place-items-center rounded-lg bg-surface-soft text-[10px]"
                  >
                    出
                  </span>
                  退出运营账号
                </button>
                <p v-else class="px-3 py-2 text-[10px] leading-relaxed text-ink-400">
                  用户后台可直接使用；管理后台需要运营账号。
                </p>
              </div>
            </Transition>
          </div>
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
