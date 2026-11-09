<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

import { useViewportGap } from '@/lib/viewport'

const props = withDefaults(defineProps<{ open: boolean; label?: string }>(), {
  label: '点位详情',
})

const emit = defineEmits<{ (e: 'close'): void }>()

const { gap: bottomOffset, bind: bindViewport, unbind: unbindViewport } = useViewportGap()

let previousOverflow = ''
let scrollLocked = false

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

function lockScroll(): void {
  if (scrollLocked) return
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  scrollLocked = true
}

function unlockScroll(): void {
  if (!scrollLocked) return
  document.body.style.overflow = previousOverflow
  scrollLocked = false
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      document.addEventListener('keydown', onKeydown)
      lockScroll()
      bindViewport()
      return
    }
    document.removeEventListener('keydown', onKeydown)
    unbindViewport()
    unlockScroll()
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  unbindViewport()
  unlockScroll()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="mobile-sheet">
      <div v-if="open" class="fixed inset-0 z-[1400] lg:hidden">
        <button
          type="button"
          class="absolute inset-0 h-full w-full cursor-default bg-ink-900/30 backdrop-blur-[1px]"
          aria-label="关闭详情"
          @click="emit('close')"
        />

        <section
          class="mobile-sheet-panel absolute inset-x-0 bottom-0 flex h-[85dvh] max-h-[85dvh] flex-col overflow-hidden rounded-t-card border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-pop"
          :style="{ marginBottom: `${bottomOffset}px` }"
          role="dialog"
          aria-modal="true"
          :aria-label="label"
          data-testid="mobile-detail-sheet"
        >
          <div class="flex shrink-0 justify-center pb-1 pt-2">
            <span class="h-1 w-9 rounded-full bg-line-strong" />
          </div>
          <div class="min-h-0 flex-1">
            <slot />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mobile-sheet-enter-active,
.mobile-sheet-leave-active {
  transition: opacity 0.2s ease;
}

.mobile-sheet-enter-active .mobile-sheet-panel,
.mobile-sheet-leave-active .mobile-sheet-panel {
  transition: transform 0.22s ease;
}

.mobile-sheet-enter-from,
.mobile-sheet-leave-to {
  opacity: 0;
}

.mobile-sheet-enter-from .mobile-sheet-panel,
.mobile-sheet-leave-to .mobile-sheet-panel {
  transform: translateY(100%);
}
</style>
