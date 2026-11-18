<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'

import type { Poi } from '@/types/poi'

const props = defineProps<{
  pois: Poi[]
  selectedId?: string | null
  cinematic?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', poi: Poi): void
  (e: 'nearby', poi: Poi): void
  (e: 'bounds', bounds: { north: number; south: number; east: number; west: number }): void
  (e: 'introDone'): void
}>()

const container = ref<HTMLDivElement | null>(null)
const tilesFailed = ref(false)
const tilesReady = ref(false)
const tileFallback = ref(false)

let map: L.Map | null = null
let markerLayer: L.LayerGroup | null = null
let tileLayer: L.TileLayer | null = null
let tileTimer: number | null = null
let tileErrors = 0
let fallbackErrors = 0
let fallbackLoaded = 0
let usingFallback = false
let boxRect: L.Rectangle | null = null
let boxStart: L.LatLng | null = null
let boxMode = false
let introMode = false
let introDoneEmitted = false
let introFallback: number | null = null

// 福田中心区，初始视野聚焦以便看清点位
const SHENZHEN_CENTER: L.LatLngTuple = [22.5412, 114.0579]
const INITIAL_ZOOM = 14

function pinIcon(poi: Poi, active: boolean): L.DivIcon {
  return L.divIcon({
    className: 'poi-marker',
    html: `<span class="poi-pin poi-pin--${poi.type}${active ? ' is-active' : ''}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

function escapeHtml(input: string): string {
  return input.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

function popupHtml(poi: Poi): string {
  const tag = poi.type === 'bank' ? (poi.branchType === 'atm' ? 'ATM' : '银行网点') : '小区'
  const extra =
    poi.type === 'bank'
      ? [poi.brand, poi.openingHours].filter(Boolean).join(' · ')
      : [
          poi.builtYear ? `${poi.builtYear} 年建成` : '',
          poi.avgPrice ? `${poi.avgPrice} 元/㎡` : '',
        ]
          .filter(Boolean)
          .join(' · ')
  return `
    <div class="poi-popup">
      <div class="poi-popup__title">${escapeHtml(poi.name)}</div>
      <div class="poi-popup__meta">${tag}${extra ? ` · ${escapeHtml(extra)}` : ''}</div>
      <div class="poi-popup__meta">${escapeHtml(poi.address || poi.district)}</div>
      <div class="poi-popup__actions">
        <button class="poi-popup__btn" data-action="nearby">周边 1km</button>
        <button class="poi-popup__btn poi-popup__btn--primary" data-action="detail">查看详情</button>
      </div>
    </div>`
}

function openPopup(marker: L.Marker, poi: Poi): void {
  marker
    .bindPopup(popupHtml(poi), { closeButton: true, offset: [0, -10], maxWidth: 260 })
    .openPopup()
  const element = marker.getPopup()?.getElement()
  element?.querySelector('[data-action="detail"]')?.addEventListener('click', (event) => {
    event.stopPropagation()
    emit('select', poi)
  })
  element?.querySelector('[data-action="nearby"]')?.addEventListener('click', (event) => {
    event.stopPropagation()
    emit('nearby', poi)
  })
}

/** 只渲染当前视野内的点：1600 个点全量渲染会糊成一团，也拖慢交互 */
function renderMarkers(): void {
  if (!map || !markerLayer || introMode) return
  markerLayer.clearLayers()
  const bounds = map.getBounds().pad(0.12)
  for (const poi of props.pois) {
    const inside = bounds.contains([poi.lat, poi.lng])
    if (!inside && poi.id !== props.selectedId) continue
    const marker = L.marker([poi.lat, poi.lng], {
      icon: pinIcon(poi, poi.id === props.selectedId),
      title: poi.name,
      riseOnHover: true,
    })
    marker.on('click', () => {
      emit('select', poi)
      openPopup(marker, poi)
    })
    marker.addTo(markerLayer)
  }
}

function clearTileTimer(): void {
  if (tileTimer !== null) {
    window.clearTimeout(tileTimer)
    tileTimer = null
  }
}

function markTileReady(): void {
  tilesReady.value = true
  tilesFailed.value = false
  clearTileTimer()
}

function addTileLayer(target: L.Map, url: string, fallback: boolean): void {
  const layer = L.tileLayer(url, {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
    // 不做 canvas 取图，不需要 CORS；强制 crossOrigin 会放大偶发失败
  })

  layer.on('tileload', () => {
    // 切备用源后旧 layer 可能还有迟到的 tileload，不能拿它当新源成功
    if (tileLayer !== layer) return
    if (fallback) fallbackLoaded += 1
    markTileReady()
  })

  layer.on('tileerror', () => {
    if (fallback) {
      fallbackErrors += 1
      if (fallbackErrors >= 6 && map?.hasLayer(layer)) {
        map.removeLayer(layer)
        tileLayer = null
        tilesFailed.value = true
      }
      return
    }
    tileErrors += 1
    if (tileErrors >= 6) switchTileFallback(target)
  })

  tileLayer = layer
  layer.addTo(target)
}

function switchTileFallback(target: L.Map): void {
  if (usingFallback) return
  usingFallback = true
  tileFallback.value = true
  tileErrors = 0
  fallbackLoaded = 0
  clearTileTimer()
  if (tileLayer && target.hasLayer(tileLayer)) target.removeLayer(tileLayer)
  tileLayer = null

  // 备用源与主源同为 OSM 体系，避免底图与 WGS-84/GCJ-02 标记错位
  addTileLayer(target, 'https://tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', true)
  tileTimer = window.setTimeout(() => {
    if (!fallbackLoaded && tileLayer && target.hasLayer(tileLayer)) {
      target.removeLayer(tileLayer)
      tileLayer = null
      tilesFailed.value = true
    }
  }, 7000)
}

function initTileLayer(target: L.Map): void {
  // OSM 德国镜像：国内访问通常比 tile.openstreetmap.org 稳定；CSS 滤镜仍压成浅灰
  addTileLayer(target, 'https://tile.openstreetmap.de/{z}/{x}/{y}.png', false)
  // 主源 3.2s 内没有成功瓦片时切法国 HOT 镜像，避免一直白屏
  tileTimer = window.setTimeout(() => {
    if (!tilesReady.value) switchTileFallback(target)
  }, 3200)
}

function setBoxMode(enabled: boolean): void {
  boxMode = enabled
  if (!map) return
  if (enabled) {
    map.dragging.disable()
    container.value?.classList.add('cursor-crosshair')
  } else {
    map.dragging.enable()
    container.value?.classList.remove('cursor-crosshair')
    if (boxStart) {
      boxRect?.remove()
      boxRect = null
      boxStart = null
    }
  }
}

function emitIntroDone(): void {
  if (introDoneEmitted) return
  introDoneEmitted = true
  emit('introDone')
}

function finishIntro(): void {
  if (!map) return
  if (introFallback !== null) {
    window.clearTimeout(introFallback)
    introFallback = null
  }
  map.stop()
  map.setView(SHENZHEN_CENTER, INITIAL_ZOOM, { animate: false })
  introMode = false
  renderMarkers()
  emitIntroDone()
}

function beginZoom(): void {
  if (!map) {
    emitIntroDone()
    return
  }
  if (!introMode) {
    emitIntroDone()
    return
  }
  map.flyTo(SHENZHEN_CENTER, INITIAL_ZOOM, { duration: 1.8, easeLinearity: 0.2 })
  map.once('moveend', finishIntro)
  // 兜底：瓦片或动画事件异常时也要落位
  introFallback = window.setTimeout(finishIntro, 3200)
}

onMounted(() => {
  if (!container.value) return
  introMode = Boolean(props.cinematic)
  map = L.map(container.value, {
    center: introMode ? [18, 10] : SHENZHEN_CENTER,
    zoom: introMode ? 2 : INITIAL_ZOOM,
    zoomControl: false,
    attributionControl: true,
    preferCanvas: true,
  })
  initTileLayer(map)
  markerLayer = L.layerGroup().addTo(map)

  map.on('mousedown', (event: L.LeafletMouseEvent) => {
    if (!boxMode || !map) return
    boxStart = event.latlng
    boxRect = L.rectangle(L.latLngBounds(event.latlng, event.latlng), {
      color: '#2563eb',
      weight: 1.5,
      fillColor: '#2563eb',
      fillOpacity: 0.08,
      dashArray: '4 4',
    }).addTo(map)
  })

  map.on('mousemove', (event: L.LeafletMouseEvent) => {
    if (!boxStart || !boxRect) return
    boxRect.setBounds(L.latLngBounds(boxStart, event.latlng))
  })

  map.on('mouseup', (event: L.LeafletMouseEvent) => {
    if (!boxMode || !boxStart) return
    const bounds = L.latLngBounds(boxStart, event.latlng)
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) return
    emit('bounds', {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    })
    setBoxMode(false)
  })

  map.on('moveend', renderMarkers)
  map.on('zoomend', renderMarkers)
  renderMarkers()
})

onBeforeUnmount(() => {
  clearTileTimer()
  if (introFallback !== null) {
    window.clearTimeout(introFallback)
    introFallback = null
  }
  map?.remove()
  map = null
  markerLayer = null
  tileLayer = null
})

watch(
  () => props.pois,
  () => renderMarkers(),
  { deep: false },
)

watch(
  () => props.selectedId,
  () => renderMarkers(),
)

defineExpose({
  beginZoom,
  finishIntro,
  focusOn(lng: number, lat: number, zoom = 16) {
    map?.flyTo([lat, lng], zoom, { duration: 0.6 })
  },
  fitAll() {
    if (!map) return
    if (props.pois.length === 0) {
      map.setView(SHENZHEN_CENTER, INITIAL_ZOOM)
      return
    }
    const bounds = L.latLngBounds(props.pois.map((poi) => [poi.lat, poi.lng] as L.LatLngTuple))
    map.fitBounds(bounds.pad(0.1), { maxZoom: 15 })
  },
  zoomIn() {
    map?.zoomIn()
  },
  zoomOut() {
    map?.zoomOut()
  },
  startBox() {
    setBoxMode(true)
  },
  stopBox() {
    setBoxMode(false)
  },
})
</script>

<template>
  <div class="relative h-full w-full">
    <div ref="container" class="h-full w-full" />

    <div
      v-if="tilesFailed"
      class="pointer-events-none absolute left-1/2 top-4 z-[500] -translate-x-1/2 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-xs text-ink-500 shadow-card"
    >
      底图加载失败，已切换纯标记模式（标记位置仍准确）
    </div>
    <div
      v-else-if="!tilesReady"
      class="pointer-events-none absolute left-1/2 top-4 z-[500] -translate-x-1/2 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-xs text-ink-500 shadow-card"
    >
      {{ tileFallback ? '主底图超时，正在切换备用源…' : '底图加载中…' }}
    </div>
  </div>
</template>
