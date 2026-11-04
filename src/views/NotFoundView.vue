<template>
  <div class="grid min-h-[calc(100vh-3.5rem)] place-items-center px-4">
    <div class="rounded-card border border-line bg-surface px-10 py-12 text-center shadow-card">
      <p class="text-5xl font-semibold tracking-tight text-ink-900/10">404</p>
      <h1 class="mt-3 text-base font-semibold text-ink-900">页面不存在</h1>
      <p class="mt-1 text-xs text-ink-500">地址可能已变更，回到地图继续查询</p>
      <RouterLink
        to="/"
        class="mt-5 inline-flex rounded-[10px] bg-brand-500 px-4 py-2 text-xs font-medium text-white shadow-card transition hover:bg-brand-600"
      >
        返回地图
      </RouterLink>
    </div>
  </div>
</template>
