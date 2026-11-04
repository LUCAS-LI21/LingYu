import { createRouter, createWebHistory } from 'vue-router'

import { track } from '@/lib/telemetry'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
      meta: { title: '总览' },
    },
    {
      path: '/board',
      name: 'board',
      component: () => import('@/views/BoardView.vue'),
      meta: { title: '任务看板' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { title: '页面不存在' },
    },
  ],
})

// 业务闭环：页面级埋点，配合 web-vitals 形成「访问 → 转化 → 性能」三方对齐
router.afterEach((to, from, failure) => {
  if (!failure) {
    track('page_view', {
      to: String(to.name ?? to.path),
      from: String(from.name ?? ''),
    })
  }
  const title = to.meta.title
  document.title = typeof title === 'string' ? `${title} · BISAI Agent` : 'BISAI Agent'
})

export default router
