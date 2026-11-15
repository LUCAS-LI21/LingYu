<script setup lang="ts">
import L from 'leaflet'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  name: string
  address: string
  district: string
  hint: { lng: number; lat: number } | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', payload: { lng: number; lat: number }): void
}>()

const mapEl = ref<HTMLElement | null>(null)
const picked = ref<{ lng: number; lat: number } | null>(null)
let map: L.Map | null = null
let marker: L.Marker | null = null

function setMarker(lng: number, lat: number): void {
  picked.value = { lng: Number(lng.toFixed(6)), lat: Number(lat.toFixed(6)) }
  if (!map) return
  if (!marker) {
    marker = L.marker([lat, lng]).addTo(map)
  } else {
    marker.setLatLng([lat, lng])
  }
}

async function initMap(): Promise<void> {
  await nextTick()
  if (!mapEl.value || map) return
  const center = props.hint ?? { lng: 114.057, lat: 22.543 }
  map = L.map(mapEl.value, { zoomControl: true }).setView([center.lat, center.lng], 15)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(map)
  map.on('click', (event: L.LeafletMouseEvent) => {
    setMarker(event.latlng.lng, event.latlng.lat)
  })
  // 容器尺寸在弹窗动画结束后才稳定，下一帧再刷一次
  setTimeout(() => map?.invalidateSize(), 120)
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      picked.value = null
      await initMap()
      map?.invalidateSize()
    }
  },
)

onBeforeUnmount(() => {
  map?.remove()
  map = null
  marker = null
})

function confirm(): void {
  if (!picked.value) return
  emit('submit', picked.value)
}
</script>

<template>
  <div
    v-if="open"
    data-testid="coordinate-picker"
    class="fixed inset-0 z-[1200] flex items-center justify-center bg-ink-900/40 p-4"
    @click.self="emit('close')"
  >
    <div
      class="w-full max-w-2xl overflow-hidden rounded-card border border-line bg-surface shadow-xl"
    >
      <header class="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div class="min-w-0">
          <h3 class="text-sm font-semibold text-ink-900">标注位置 · {{ name }}</h3>
          <p class="mt-0.5 truncate text-[11px] text-ink-500">{{ address || district }}</p>
        </div>
        <button class="text-ink-400 transition hover:text-ink-700" @click="emit('close')">✕</button>
      </header>

      <div ref="mapEl" class="h-[380px] w-full bg-surface-soft" />

      <footer
        class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3"
      >
        <p class="text-[11px] text-ink-500">
          <template v-if="picked">
            已选：<span class="tabular-nums text-ink-700">{{ picked.lng }}, {{ picked.lat }}</span>
          </template>
          <template v-else>在地图上点击小区所在位置（OSM 底图，坐标为 WGS-84）</template>
        </p>
        <div class="flex gap-2">
          <button
            class="rounded-md border border-line px-3 py-1.5 text-xs text-ink-600 transition hover:bg-surface-soft"
            @click="emit('close')"
          >
            取消
          </button>
          <button
            class="rounded-md bg-brand-600 px-3 py-1.5 text-xs text-white transition hover:bg-brand-700 disabled:opacity-40"
            :disabled="!picked"
            @click="confirm"
          >
            确认标注
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>
