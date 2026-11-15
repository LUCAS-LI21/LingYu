<script setup lang="ts">
import { toasts } from '@/lib/toast'
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-0 bottom-8 z-[3000] flex flex-col items-center gap-2"
    >
      <TransitionGroup
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-y-2 opacity-0"
        leave-active-class="transition duration-150 ease-in"
        leave-to-class="translate-y-1 opacity-0"
      >
        <div
          v-for="item in toasts"
          :key="item.id"
          data-testid="toast"
          :data-toast-type="item.type"
          class="pointer-events-auto flex items-center gap-2 rounded-full border px-4 py-2 text-sm shadow-pop"
          :class="{
            'border-mint-500/30 bg-mint-50 text-mint-600': item.type === 'success',
            'border-line bg-surface text-ink-700': item.type === 'info',
            'border-red-200 bg-red-50 text-red-600': item.type === 'error',
          }"
        >
          <span
            class="h-1.5 w-1.5 rounded-full"
            :class="{
              'bg-mint-500': item.type === 'success',
              'bg-ink-400': item.type === 'info',
              'bg-red-500': item.type === 'error',
            }"
          />
          {{ item.text }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
