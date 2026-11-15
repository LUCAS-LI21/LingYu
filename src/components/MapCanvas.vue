<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'

import type { Poi } from '@/types/poi'

const props = defineProps<{
  pois: Poi[]
  selectedId?: string | null
  /** 底图：浅灰（默认）/ 彩色 / 卫星 */
  baseMap?: 'light' | 'color' | 'satellite'
}>()

const emit = defineEmits<{
  (e: 'select', poi: Poi): void
  (e: 'nearby', poi: Poi): void
  (e: 'bounds', bounds: { north: number; south: number; east: number; west: number }): void
}>()

const container = ref<HTMLDivElement | null>(null)
const tilesFailed = ref(false)

let map: L.Map | null = null
let markerLayer: L.LayerGroup | null = null
let boxRect: L.Rectangle | null = null
let boxStart: L.LatLng | null = null
let boxMode = false
let tileErrors = 0

/** 已渲染的 marker 缓存：只做增删差量，避免每次 moveend 全量重建（5000+ 点位会卡） */
const rendered = new Map<string, L.Marker | L.CircleMarker>()
let renderTimer: number | null = null

/** zoom 低于此值时按网格聚合，否则画单点 */
const CLUSTER_MAX_ZOOM = 14
const CLUSTER_GRID = 0.008 // 约 800m

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

/** 只渲染当前视野内的点；低 zoom 时按网格聚合成带数字的圆点 */
function renderMarkers(): void {
  if (!map || !markerLayer) return
  const zoom = map.getZoom()
  const bounds = map.getBounds().pad(0.12)
  const next = new Map<string, L.Marker | L.CircleMarker>()

  if (zoom <= CLUSTER_MAX_ZOOM) {
    // 聚合：同网格合并成一个圆点，点击放大
    const cells = new Map<string, { lat: number; lng: number; count: number }>()
    for (const poi of props.pois) {
      if (!bounds.contains([poi.lat, poi.lng])) continue
      const gx = Math.floor(poi.lng / CLUSTER_GRID)
      const gy = Math.floor(poi.lat / CLUSTER_GRID)
      const key = `${gx}:${gy}`
      const cell = cells.get(key)
      if (cell) {
        cell.count += 1
        cell.lat += poi.lat
        cell.lng += poi.lng
      } else {
        cells.set(key, { lat: poi.lat, lng: poi.lng, count: 1 })
      }
    }
    for (const [key, cell] of cells) {
      const markerKey = `cluster:${key}`
      const lat = cell.lat / cell.count
      const lng = cell.lng / cell.count
      const radius = Math.min(26, 10 + Math.log2(cell.count + 1) * 4)
      let marker = rendered.get(markerKey) as L.CircleMarker | undefined
      if (!marker) {
        marker = L.circleMarker([lat, lng], {
          radius,
          weight: 1,
          color: '#2563eb',
          fillColor: '#3b82f6',
          fillOpacity: 0.75,
        })
        marker.on('click', () => {
          map?.setView([lat, lng], Math.min(17, zoom + 2))
        })
        marker.addTo(markerLayer)
      } else {
        marker.setLatLng([lat, lng])
        marker.setRadius(radius)
      }
      marker.bindTooltip(`${cell.count} 个点位`, { direction: 'top' })
      next.set(markerKey, marker)
    }
  } else {
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
  }

  // 差量清理：把这次没出现的 marker 从地图上摘掉
  for (const [key, marker] of rendered) {
    if (!next.has(key)) {
      markerLayer.removeLayer(marker)
    }
  }
  rendered.clear()
  for (const [key, marker] of next) rendered.set(key, marker)
}

/** moveend/zoomend 会连续触发，防抖后再算，避免拖动时反复重建 */
function scheduleRender(): void {
  if (renderTimer !== null) window.clearTimeout(renderTimer)
  renderTimer = window.setTimeout(() => {
    renderTimer = null
    renderMarkers()
  }, 160)
}

/**
 * 底图源。
 *
 * 为什么是 Esri 而不是 CARTO/OSM：
 * - CARTO 的栅格底图现在返回「API KEY REQUIRED」占位图（200 但内容是水印）
 * - 本机网络下 tile.openstreetmap.org 不可达（000），OSM 官方瓦片只能作为远端兜底
 * - Esri 的三个服务实测都是真 JPEG：浅灰 / 街道 / 影像
 *
 * 署名必须保留（Esri 的条款要求显示版权信息）。
 */
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

  // 浅灰底图不含注记，叠一层 reference（道路/地名标签）
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

onMounted(() => {
  if (!container.value) return
  map = L.map(container.value, {
    center: SHENZHEN_CENTER,
    zoom: INITIAL_ZOOM,
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
