import { afterEach, beforeAll, vi } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'

// 每个用例结束后自动卸载组件，避免 DOM 残留
enableAutoUnmount(afterEach)

// Element Plus 依赖浏览器 API，jsdom 下需要补齐最小实现
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)

  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }))
  }

  if (!window.scrollTo) {
    window.scrollTo = () => {}
  }
})
