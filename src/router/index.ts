import { createRouter, createWebHistory } from 'vue-router'

import { track } from '@/lib/telemetry'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/',
      name: 'map',
      component: () => import('@/views/MapView.vue'),
      meta: { title: '地图查询' },
    },
    {
      path: '/list',
      name: 'list',
      component: () => import('@/views/ListView.vue'),
      meta: { title: '列表查询' },
    },
    {
      path: '/stats',
      name: 'stats',
      component: () => import('@/views/StatsView.vue'),
      meta: { title: '数据洞察' },
    },
    {
      path: '/compliance',
      name: 'compliance',
      component: () => import('@/views/ComplianceView.vue'),
      meta: { title: '数据说明' },
    },
    {
      path: '/me',
      name: 'me',
      component: () => import('@/views/UserCenterView.vue'),
      meta: { title: '用户后台' },
    },
    {
      path: '/user',
      redirect: '/me',
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('@/views/AdminView.vue'),
      meta: { title: '管理后台' },
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
  document.title = typeof title === 'string' ? `${title} · 邻域` : '邻域'
})

export default router
