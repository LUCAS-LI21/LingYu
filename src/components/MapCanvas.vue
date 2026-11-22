<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'

import type { Poi } from '@/types/poi'

const props = defineProps<{
  pois: Poi[]
  selectedId?: string | null
  /** 底图：浅灰（默认）/ 彩色 / 卫星 */
  baseMap?: 'light' | 'color' | 'satellite'
  /** 开场动画：远视角起步，由 MapIntro 汇合后飞入深圳 */
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

let map: L.Map | null = null
let markerLayer: L.LayerGroup | null = null
let boxRect: L.Rectangle | null = null
let boxStart: L.LatLng | null = null
let boxMode = false
let tileErrors = 0
let introMode = false
let introDoneEmitted = false
let introFallback: number | null = null

/** 已渲染 marker 缓存，按差量增删 */
const rendered = new Map<string, L.Marker>()
let renderTimer: number | null = null

// 初始视野：福田中心区
const SHENZHEN_CENTER: L.LatLngTuple = [22.5412, 114.0579]
const INITIAL_ZOOM = 14

function pinIcon(poi: Poi, active: boolean): L.DivIcon {
  // ATM 使用独立样式类，两类互斥展示
  const atmClass = poi.type === 'bank' && poi.branchType === 'atm' ? ' poi-pin--atm' : ''
  return L.divIcon({
    className: 'poi-marker',
    html: `<span class="poi-pin poi-pin--${poi.type}${atmClass}${active ? ' is-active' : ''}"></span>`,
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

/** 只渲染当前视野内的点 */
function renderMarkers(): void {
  // 开场动画期间不铺点
  if (!map || !markerLayer || introMode) return
  const bounds = map.getBounds().pad(0.12)
  const next = new Map<string, L.Marker>()

  for (const poi of props.pois) {
    const inside = bounds.contains([poi.lat, poi.lng])
    if (!inside && poi.id !== props.selectedId) continue
    let marker = rendered.get(poi.id) as L.Marker | undefined
    if (!marker) {
      marker = L.marker([poi.lat, poi.lng], {
        icon: pinIcon(poi, poi.id === props.selectedId),
        title: poi.name,
        riseOnHover: true,
      })
      marker.on('click', () => {
        emit('select', poi)
        openPopup(marker as L.Marker, poi)
      })
      marker.addTo(markerLayer)
    } else {
      marker.setLatLng([poi.lat, poi.lng])
      marker.setIcon(pinIcon(poi, poi.id === props.selectedId))
    }
    next.set(poi.id, marker)
  }

  // 移除本次未出现的 marker
  for (const [key, marker] of rendered) {
    if (!next.has(key)) {
      markerLayer.removeLayer(marker)
    }
  }
  rendered.clear()
  for (const [key, marker] of next) rendered.set(key, marker)
}

/** moveend/zoomend 防抖 160ms 后渲染 */
function scheduleRender(): void {
  if (renderTimer !== null) window.clearTimeout(renderTimer)
  renderTimer = window.setTimeout(() => {
    renderTimer = null
    renderMarkers()
  }, 160)
}

/** 底图瓦片源；Esri 服务要求保留版权署名，OSM 瓦片仅作兜底 */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const BASE_MAPS = {
  light: {
    url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    overlay: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: '&copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    className: 'basemap-light',
  },
  color: {
    url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
    attribution: '&copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    className: 'basemap-color',
  },
  satellite: {
    url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    className: 'basemap-satellite',
  },
} as const

let baseLayer: L.TileLayer | null = null
let overlayLayer: L.TileLayer | null = null

function initTileLayer(target: L.Map): void {
  applyBaseMap(target, props.baseMap ?? 'light')
}

/** 换底图：先摘旧层再挂新层，失败计数重置 */
function applyBaseMap(target: L.Map, kind: keyof typeof BASE_MAPS): void {
  const config = BASE_MAPS[kind] ?? BASE_MAPS.light
  if (baseLayer) {
    target.removeLayer(baseLayer)
    baseLayer = null
  }
  if (overlayLayer) {
    target.removeLayer(overlayLayer)
    overlayLayer = null
  }
  tileErrors = 0
  const layer = L.tileLayer(config.url, {
    maxZoom: 19,
    attribution: config.attribution,
    crossOrigin: true,
  })
  layer.on('tileerror', () => {
    tileErrors += 1
    if (tileErrors >= 10 && baseLayer === layer && map?.hasLayer(layer)) {
      map.removeLayer(layer)
      baseLayer = null
      tilesFailed.value = true
    }
  })
  layer.addTo(target)
  baseLayer = layer

  // 浅灰底图不含注记，叠加 reference 标签层
  if ('overlay' in config && config.overlay) {
    overlayLayer = L.tileLayer(config.overlay, {
      maxZoom: 19,
      crossOrigin: true,
      pane: 'overlayPane',
    })
    overlayLayer.addTo(target)
  }
  container.value?.setAttribute('data-basemap', config.className)
  tilesFailed.value = false
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

/** 粒子汇合结束后地图飞入深圳并铺点 */
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
  // 动画事件异常时兜底落位
  introFallback = window.setTimeout(finishIntro, 3200)
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

onMounted(() => {
  if (!container.value) return
  introMode = Boolean(props.cinematic)
  map = L.map(container.value, {
    center: introMode ? ([18, 10] as L.LatLngTuple) : SHENZHEN_CENTER,
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

  map.on('moveend', scheduleRender)
  map.on('zoomend', scheduleRender)
  renderMarkers()
})

onBeforeUnmount(() => {
  if (renderTimer !== null) {
    window.clearTimeout(renderTimer)
    renderTimer = null
  }
  if (introFallback !== null) {
    window.clearTimeout(introFallback)
    introFallback = null
  }
  rendered.clear()
  map?.remove()
  map = null
  markerLayer = null
})

watch(
  () => props.baseMap,
  (kind) => {
    if (map) applyBaseMap(map, kind ?? 'light')
  },
)

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
  </div>
</template>
