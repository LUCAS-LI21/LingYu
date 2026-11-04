import { ref } from 'vue'

export interface ToastItem {
  id: number
  type: 'success' | 'info' | 'error'
  text: string
}

export const toasts = ref<ToastItem[]>([])
let seq = 0

export function toast(text: string, type: ToastItem['type'] = 'success'): void {
  const id = ++seq
  toasts.value = [...toasts.value, { id, type, text }]
  setTimeout(() => {
    toasts.value = toasts.value.filter((item) => item.id !== id)
  }, 2600)
}
