<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  index: number
  title: string
  subtitle: string
  desc: string
  icon: Component
  tools: string[]
}>()
</script>

<template>
  <article
    class="flex h-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-md"
  >
    <div class="flex items-center gap-3">
      <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
        <component :is="icon" class="h-5 w-5" />
      </span>
      <div class="min-w-0">
        <p class="text-[11px] font-medium tracking-wider text-slate-400">STEP {{ index }}</p>
        <h3 class="truncate text-sm font-semibold text-slate-900">{{ title }}</h3>
      </div>
    </div>
    <p class="text-xs text-slate-400">{{ subtitle }}</p>
    <p class="text-sm leading-relaxed text-slate-600">{{ desc }}</p>
    <ul class="mt-auto flex flex-wrap gap-1.5 pt-1">
      <li
        v-for="tool in tools"
        :key="tool"
        class="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
      >
        {{ tool }}
      </li>
    </ul>
  </article>
</template>
