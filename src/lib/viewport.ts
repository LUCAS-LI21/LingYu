import { ref } from 'vue'

const MAX_GAP = 96

/** 移动端地址栏会让 innerHeight 大于 visualViewport.height，固定底栏会被挡在屏幕外 */
export function measureViewportGap(): number {
  const visible = window.visualViewport?.height ?? window.innerHeight
  const gap = window.innerHeight - visible
  // 软键盘弹出时 gap 会很大，这里只修正地址栏级别的高度差
  return Math.min(Math.max(0, Math.round(gap)), MAX_GAP)
}

export function useViewportGap() {
  const gap = ref(0)

  function sync(): void {
    gap.value = measureViewportGap()
  }

  function bind(): void {
    sync()
    window.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('scroll', sync)
  }

  function unbind(): void {
    window.removeEventListener('resize', sync)
    window.visualViewport?.removeEventListener('resize', sync)
    window.visualViewport?.removeEventListener('scroll', sync)
    gap.value = 0
  }

  return { gap, sync, bind, unbind }
}
