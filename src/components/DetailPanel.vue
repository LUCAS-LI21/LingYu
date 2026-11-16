<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { NearbyItem } from '@/api/pois'
import {
  fetchNearestBanks,
  fetchNearbyCommunities,
  fieldSourcesFromServer,
  type NearbyCommunity,
  type NearestBank,
} from '@/api/pois'
import { fetchLiveAddress, fetchLiveAround, type LivePoiItem } from '@/api/live'
import type { FieldSource } from '@/api/server'
import { amapMarkerUrl, amapNavigationUrl, canNavigate, tencentNavigationUrl } from '@/lib/nav'
import type { BankPoi, Poi } from '@/types/poi'

const props = defineProps<{
  poi: Poi
  nearby: NearbyItem[]
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'locate', poi: Poi): void
  (e: 'feedback', payload: { poi: Poi; field?: string }): void
  (e: 'nearby', payload: { poi: Poi; radius: number; branchType: 'all' | 'atm' }): void
}>()

const radius = ref(1000)
const branchType = ref<'all' | 'atm'>('all')
const queried = ref(false)

/** 字段级来源：换了点位就重新拉，离线或后端不可用时为空（区块隐藏） */
const fieldSources = ref<FieldSource[]>([])
const FIELD_LABELS: Record<string, string> = {
  address: '地址',
  district: '行政区',
  phone: '电话',
  opening_hours: '营业时间',
  brand: '品牌',
  property_company: '物业公司',
  built_year: '建成年份',
  avg_price: '参考均价',
  property_fee: '物业费',
}
watch(
  () => props.poi?.id,
  async (id) => {
    fieldSources.value = []
    if (!id) return
    const rows = await fieldSourcesFromServer(props.poi)
    if (rows) fieldSources.value = rows
  },
  { immediate: true },
)

/** 最近的 3 家银行：只对小区有意义，后端按球面距离算，取不到就整块隐藏 */
const navTarget = computed(() => ({
  name: props.poi?.name ?? '',
  address: props.poi?.address ?? '',
  gcjLng: props.poi?.gcjLng ?? null,
  gcjLat: props.poi?.gcjLat ?? null,
}))

const nearbyCommunities = ref<NearbyCommunity[]>([])
watch(
  () => props.poi?.id,
  async () => {
    nearbyCommunities.value = []
    if (props.poi?.type !== 'bank') return
    try {
      nearbyCommunities.value = await fetchNearbyCommunities(props.poi.id, 1000, 5)
    } catch {
      nearbyCommunities.value = []
    }
  },
  { immediate: true },
)

const nearestBanks = ref<NearestBank[]>([])
watch(
  () => props.poi?.id,
  async () => {
    nearestBanks.value = []
    if (props.poi?.type !== 'community') return
    try {
      nearestBanks.value = await fetchNearestBanks(props.poi.id, 3)
    } catch {
      nearestBanks.value = []
    }
  },
  { immediate: true },
)

/** 实时层状态：idle 未查 / loading / success 有结果 / empty 无结果 / unavailable 未开通 / error 请求失败 */
type LiveState = 'idle' | 'loading' | 'success' | 'empty' | 'unavailable' | 'error'

// L2 实时地址：只在本次会话内存里，页面关闭即消失
const liveAddress = ref('')
const liveAddressState = ref<LiveState>('idle')
const liveAddressMessage = ref('')

// L2 实时周边（高德）：同样只在内存
const livePois = ref<LivePoiItem[]>([])
const livePoiState = ref<LiveState>('idle')
const livePoiMessage = ref('')

async function loadLivePois(): Promise<void> {
  livePoiState.value = 'loading'
  livePoiMessage.value = ''
  livePois.value = []
  try {
    const result = await fetchLiveAround(props.poi.lng, props.poi.lat, 1000)
    if (!result.enabled) {
      livePoiState.value = 'unavailable'
      livePoiMessage.value = result.reason ?? '高德实时周边未启用'
      return
    }
    if (result.error) {
      livePoiState.value = 'error'
      livePoiMessage.value = result.error
      return
    }
    livePois.value = result.items ?? []
    if (livePois.value.length === 0) {
      livePoiState.value = 'empty'
      livePoiMessage.value = '1km 内没有查到点位'
      return
    }
    livePoiState.value = 'success'
  } catch {
    livePoiState.value = 'error'
    livePoiMessage.value = '实时周边查询失败，请稍后重试'
  }
}

async function loadLiveAddress(): Promise<void> {
  liveAddressState.value = 'loading'
  liveAddressMessage.value = ''
  liveAddress.value = ''
  try {
    const result = await fetchLiveAddress(props.poi.lng, props.poi.lat)
    if (!result.enabled) {
      liveAddressState.value = 'unavailable'
      liveAddressMessage.value = result.reason ?? '高德实时地址未启用'
      return
    }
    if (result.error) {
      liveAddressState.value = 'error'
      liveAddressMessage.value = result.error
      return
    }
    liveAddress.value = result.address ?? ''
    if (!liveAddress.value) {
      liveAddressState.value = 'empty'
      liveAddressMessage.value = '高德未返回该坐标的地址'
      return
    }
    liveAddressState.value = 'success'
  } catch {
    liveAddressState.value = 'error'
    liveAddressMessage.value = '实时地址查询失败，请稍后重试'
  }
}

watch(
  () => props.poi.id,
  () => {
    queried.value = false
    liveAddress.value = ''
    liveAddressState.value = 'idle'
    liveAddressMessage.value = ''
    livePois.value = []
    livePoiState.value = 'idle'
    livePoiMessage.value = ''
  },
)

const isBank = computed(() => props.poi.type === 'bank')
const bank = computed(() => (props.poi.type === 'bank' ? (props.poi as BankPoi) : null))
const hasAddress = computed(() => props.poi.address.trim().length > 0)
const visibleNearby = computed(() => (props.loading ? [] : props.nearby.slice(0, 6)))

function distanceLabel(item: LivePoiItem): string {
  if (item.distance === undefined) return ''
  return item.distance < 1000
    ? `${Math.round(item.distance)}m`
    : `${(item.distance / 1000).toFixed(1)}km`
}

const rows = computed(() => {
  const poi = props.poi
  if (poi.type === 'bank') {
    return [
      { label: '地址', value: poi.address || '暂无' },
      { label: '类型', value: poi.branchType === 'atm' ? 'ATM 自助银行' : '营业网点' },
      { label: '品牌', value: poi.brand || '暂无' },
      { label: '营业时间', value: poi.openingHours || '待核实' },
      { label: '联系电话', value: poi.phone || '暂无' },
    ]
  }
  return [
    { label: '地址', value: poi.address || '暂无' },
    { label: '建成年份', value: poi.builtYear ? `${poi.builtYear} 年` : '暂无' },
    { label: '参考均价', value: poi.avgPrice ? `${poi.avgPrice.toLocaleString()} 元/㎡` : '暂无' },
    { label: '物业费', value: poi.propertyFee ? `${poi.propertyFee.toFixed(1)} 元/㎡·月` : '暂无' },
    // 政府租赁参考价：真实数据，命中不到就不显示（不要给个假的）
    ...(rentText(poi) ? [{ label: '参考租金', value: rentText(poi) }] : []),
    ...(poi.propertyCompany ? [{ label: '物业公司', value: poi.propertyCompany }] : []),
    ...(poi.waterSavingYear ? [{ label: '节水型小区', value: `${poi.waterSavingYear} 年度` }] : []),
  ]
})

/** 优先展示高层租金，其次多层、低密度；全部为空返回空串 */
function rentText(poi: {
  rentGc?: number | null
  rentDc?: number | null
  rentDmd?: number | null
}): string {
  const parts: string[] = []
  if (poi.rentGc) parts.push(`高层 ${poi.rentGc.toFixed(1)}`)
  if (poi.rentDc) parts.push(`多层 ${poi.rentDc.toFixed(1)}`)
  if (poi.rentDmd) parts.push(`低密度 ${poi.rentDmd.toFixed(1)}`)
  return parts.length ? `${parts.join(' / ')} 元/㎡·月（政府参考）` : ''
}

/** 周边配套：由本地库按 1km 球面距离算出来的，不是抓取的 */
const amenities = computed(() => {
  const poi = props.poi
  if (poi.type !== 'community' || !poi.surroundBankCount) return []
  return [
    { label: '1km 银行', value: `${poi.surroundBankCount} 家` },
    { label: '银行品牌', value: `${poi.nearbyBrandCount ?? 0} 个` },
    { label: '最近银行', value: poi.nearestBankM ? `${poi.nearestBankM} m` : '—' },
    { label: 'ATM', value: `${poi.surroundAtmCount ?? 0} 台` },
  ]
})

function runNearby(): void {
  queried.value = true
  emit('nearby', { poi: props.poi, radius: radius.value, branchType: branchType.value })
}

function queryNearby(type: 'all' | 'atm'): void {
  branchType.value = type
  runNearby()
}

/** 切换半径要立刻重查，否则数字还是上一个半径的（用户反馈过） */
function changeRadius(value: number): void {
  if (radius.value === value) return
  radius.value = value
  runNearby()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex items-start gap-3 border-b border-line px-4 py-3.5">
      <span
        class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
        :class="isBank ? 'bg-brand-50 text-brand-600' : 'bg-amber-50 text-amber-600'"
      >
        <svg
          v-if="isBank"
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        >
          <path d="M3 10l9-6 9 6" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M5 10v9M19 10v9M9 19v-5h6v5" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M3 19h18" stroke-linecap="round" />
        </svg>
        <svg
          v-else
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        >
          <path d="M4 20V9l8-5 8 5v11" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M9 20v-6h6v6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>

      <div class="min-w-0 flex-1">
        <h2 class="truncate text-sm font-semibold text-ink-900">{{ poi.name }}</h2>
        <p class="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
          <span>{{ isBank ? (bank?.branchType === 'atm' ? 'ATM' : '银行网点') : '小区' }}</span>
          <span class="h-2.5 w-px bg-line-strong" />
          <span>{{ poi.district }}</span>
        </p>
      </div>

      <button
        class="grid h-7 w-7 place-items-center rounded-lg text-ink-400 transition hover:bg-surface-soft hover:text-ink-700"
        aria-label="关闭"
        @click="emit('close')"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
        </svg>
      </button>
    </header>

    <div class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <dl class="space-y-2.5">
        <div v-for="row in rows" :key="row.label" class="flex gap-3 text-xs">
          <dt class="w-16 shrink-0 text-ink-400">{{ row.label }}</dt>
          <dd
            class="min-w-0 flex-1 text-ink-700"
            :class="{ 'text-ink-400': row.value === '暂无' || row.value === '待核实' }"
          >
            <template v-if="row.label === '地址'">
              <a
                v-if="hasAddress"
                data-testid="address-link"
                :href="amapMarkerUrl(navTarget)"
                target="_blank"
                rel="noopener noreferrer"
                class="text-ink-700 underline decoration-line-strong/60 underline-offset-2 transition hover:text-brand-600"
                :title="`在高德地图查看：${row.value}`"
                >{{ row.value }}</a
              >
              <span
                v-else
                data-testid="address-missing"
                class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600"
              >
                <span class="h-1 w-1 rounded-full bg-amber-500" />
                地址待补充
              </span>
            </template>
            <template v-else>{{ row.value }}</template>
          </dd>
        </div>
      </dl>

      <!-- 导航入口：高德 / 腾讯。有 GCJ 坐标走导航，没有坐标退化成按地址搜索 -->
      <div
        v-if="hasAddress"
        data-testid="nav-links"
        class="flex flex-wrap items-center gap-2 text-[11px]"
      >
        <span class="text-ink-400">{{ canNavigate(navTarget) ? '导航到' : '按地址搜索' }}</span>
        <a
          :href="amapNavigationUrl(navTarget)"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-ink-700 transition hover:border-brand-300 hover:text-brand-600"
          >高德{{ canNavigate(navTarget) ? '导航' : '搜索' }}</a
        >
        <a
          :href="tencentNavigationUrl(navTarget)"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-ink-700 transition hover:border-brand-300 hover:text-brand-600"
          >腾讯{{ canNavigate(navTarget) ? '导航' : '搜索' }}</a
        >
      </div>

      <!-- 地址入口分层：主操作「查实时地址」+ 次操作「补充地址」，避免两个同级文字链 -->
      <section
        v-if="!hasAddress"
        data-testid="address-action"
        class="rounded-soft border border-amber-200/80 bg-amber-50/50 p-3"
      >
        <div class="flex items-start gap-2">
          <span
            class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-600"
          >
            <svg
              class="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path
                d="M12 21s6-5.3 6-10a6 6 0 10-12 0c0 4.7 6 10 6 10z"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <circle cx="12" cy="11" r="2.2" />
            </svg>
          </span>
          <div class="min-w-0">
            <p class="text-xs font-medium text-ink-900">补全地址信息</p>
            <p class="mt-0.5 text-[11px] leading-relaxed text-ink-500">
              OSM 源头未记录该点位地址。可先用高德实时解析，或提交补充由运营核实后入库。
            </p>
          </div>
        </div>

        <div class="mt-2.5 flex gap-2">
          <button
            data-testid="live-address-action"
            class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-[11px] font-medium text-white shadow-card transition hover:bg-brand-600 disabled:opacity-60"
            :disabled="liveAddressState === 'loading'"
            @click="loadLiveAddress"
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" stroke-linecap="round" />
            </svg>
            {{
              liveAddressState === 'loading'
                ? '查询中…'
                : liveAddressState === 'success'
                  ? '重新查询'
                  : '查实时地址'
            }}
          </button>
          <button
            data-testid="supplement-address-action"
            class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[11px] text-ink-600 transition hover:border-brand-500/50 hover:text-brand-600"
            @click="emit('feedback', { poi, field: '地址' })"
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path
                d="M4 20h4l10.5-10.5a2.1 2.1 0 00-3-3L5 17v3z"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            补充地址
          </button>
        </div>

        <div v-if="liveAddressState === 'loading'" class="mt-2.5 space-y-1.5" aria-live="polite">
          <div class="h-3 w-2/3 animate-pulse rounded bg-amber-100/80" />
          <div class="h-3 w-1/2 animate-pulse rounded bg-amber-100/60" />
        </div>
        <div
          v-else-if="liveAddressState === 'success' && liveAddress"
          data-testid="live-address-result"
          class="mt-2.5 rounded-lg border border-brand-500/20 bg-surface p-2.5"
        >
          <div class="flex items-center gap-1.5">
            <span class="rounded bg-brand-50 px-1 py-0.5 text-[10px] font-medium text-brand-600">
              高德实时
            </span>
            <span class="text-[10px] text-ink-400">L2 · 仅展示，不写入数据库</span>
          </div>
          <p class="mt-1 text-xs leading-relaxed text-ink-700">{{ liveAddress }}</p>
          <p class="mt-0.5 text-[10px] text-ink-400">关闭页面后即消失</p>
        </div>
        <div
          v-else-if="liveAddressState === 'unavailable' || liveAddressState === 'error'"
          data-testid="live-address-status"
          class="mt-2.5 rounded-lg border px-2.5 py-2"
          :class="
            liveAddressState === 'unavailable'
              ? 'border-amber-200 bg-amber-50/70'
              : 'border-red-200 bg-red-50/60'
          "
        >
          <p
            class="text-[11px] font-medium"
            :class="liveAddressState === 'unavailable' ? 'text-amber-700' : 'text-red-600'"
          >
            {{ liveAddressState === 'unavailable' ? '实时地址暂不可用' : '实时地址查询失败' }}
          </p>
          <p
            v-if="liveAddressMessage"
            class="mt-0.5 break-words text-[11px] leading-relaxed text-ink-500"
          >
            {{ liveAddressMessage }}
          </p>
          <button
            v-if="liveAddressState === 'error'"
            class="mt-1 text-[11px] font-medium text-brand-600 hover:underline"
            @click="loadLiveAddress"
          >
            重试
          </button>
        </div>
        <p
          v-else-if="liveAddressState === 'empty'"
          data-testid="live-address-status"
          class="mt-2.5 text-[11px] leading-relaxed text-ink-400"
        >
          高德没有返回该坐标的地址，建议补充地址让运营核实。
        </p>
      </section>

      <!-- 反向关联：银行的「1km 内小区」 -->
      <div
        v-if="nearbyCommunities.length"
        data-testid="nearby-communities"
        class="rounded-soft border border-line bg-surface-soft px-3 py-2.5"
      >
        <div class="flex items-center justify-between">
          <p class="text-[11px] font-medium text-ink-700">1km 内的小区</p>
          <span class="text-[10px] text-ink-400">共 {{ nearbyCommunities.length }} 个</span>
        </div>
        <ul class="mt-1.5 space-y-1">
          <li
            v-for="item in nearbyCommunities"
            :key="item.id"
            class="flex items-baseline gap-2 text-[11px]"
          >
            <span class="min-w-0 flex-1 truncate text-ink-700" :title="item.address || item.name">
              {{ item.name }}
            </span>
            <span v-if="item.avgPrice" class="shrink-0 text-[10px] text-ink-400"
              >{{ Math.round(item.avgPrice / 1000) }}k/㎡</span
            >
            <span class="shrink-0 tabular-nums text-ink-500">{{ item.distance }} m</span>
          </li>
        </ul>
        <p class="mt-1.5 text-[10px] leading-relaxed text-ink-400">
          按直线距离排序，反映该网点服务的住宅范围
        </p>
      </div>

      <div
        v-if="nearestBanks.length"
        data-testid="nearest-banks"
        class="rounded-soft border border-line bg-surface-soft px-3 py-2.5"
      >
        <div class="flex items-center justify-between">
          <p class="text-[11px] font-medium text-ink-700">最近的银行</p>
          <span class="text-[10px] text-ink-400">球面距离</span>
        </div>
        <ol class="mt-1.5 space-y-1">
          <li
            v-for="(item, index) in nearestBanks"
            :key="item.id"
            class="flex items-baseline gap-2 text-[11px]"
          >
            <span class="w-3 shrink-0 text-ink-400">{{ index + 1 }}</span>
            <span class="min-w-0 flex-1 truncate text-ink-700" :title="item.name">
              {{ item.name }}
            </span>
            <span class="shrink-0 tabular-nums text-ink-500">{{ item.distance }} m</span>
          </li>
        </ol>
        <p class="mt-1.5 text-[10px] leading-relaxed text-ink-400">按直线距离排序，不含步行路径</p>
      </div>

      <div
        v-if="amenities.length"
        data-testid="community-amenities"
        class="rounded-soft border border-line bg-surface-soft px-3 py-2.5"
      >
        <p class="text-[11px] font-medium text-ink-700">周边配套</p>
        <div class="mt-1.5 grid grid-cols-2 gap-1.5">
          <div
            v-for="item in amenities"
            :key="item.label"
            class="rounded-md bg-surface px-2 py-1.5"
          >
            <p class="text-[10px] text-ink-400">{{ item.label }}</p>
            <p class="text-[12px] font-medium text-ink-800">{{ item.value }}</p>
          </div>
        </div>
        <p class="mt-1.5 text-[10px] leading-relaxed text-ink-400">
          由本地库按 1km 球面距离计算，随银行数据更新
        </p>
      </div>

      <div class="rounded-soft border border-line bg-surface-soft px-3 py-2.5">
        <p class="text-[11px] font-medium text-ink-700">数据来源</p>
        <p class="mt-1 text-[11px] leading-relaxed text-ink-500">
          {{ poi.source }}<span v-if="poi.license"> · {{ poi.license }}</span>
          <template v-if="poi.type === 'community' && poi.demoAttributes">
            <br />
            <span class="text-amber-600">均价/建成年份为演示数据，不构成投资建议</span>
            <span class="text-ink-400"
              >（物业费/租金/物业公司若下方「数据来源」列出，则为公示来源）</span
            >
          </template>
        </p>
        <ul
          v-if="fieldSources.length"
          data-testid="field-sources"
          class="mt-1.5 space-y-0.5 border-t border-line pt-1.5"
        >
          <li
            v-for="item in fieldSources"
            :key="item.field"
            class="flex items-baseline justify-between gap-2 text-[10px] text-ink-500"
          >
            <span class="text-ink-400">{{ FIELD_LABELS[item.field] ?? item.field }}</span>
            <a
              v-if="item.sourceUrl"
              :href="item.sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="truncate text-accent hover:underline"
              >{{ item.source }}</a
            >
            <span v-else class="truncate">{{ item.source }}</span>
          </li>
        </ul>
        <p
          v-if="!hasAddress"
          class="mt-1.5 border-t border-line pt-1.5 text-[11px] leading-relaxed text-ink-400"
        >
          OSM 在中国区的网点多只记录名称与坐标，地址缺失属源头问题，不是系统故障。
        </p>
      </div>

      <section class="space-y-2 rounded-soft border border-line bg-surface-soft p-3">
        <div class="flex items-start justify-between gap-2">
          <div class="flex min-w-0 items-start gap-2">
            <span
              class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"
            >
              <svg
                class="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" stroke-linejoin="round" />
              </svg>
            </span>
            <div class="min-w-0">
              <p class="flex items-center gap-1.5 text-xs font-medium text-ink-900">
                实时周边（高德）
                <span class="rounded bg-brand-50 px-1 py-0.5 text-[9px] font-normal text-brand-600">
                  L2
                </span>
              </p>
              <p class="mt-0.5 text-[10px] leading-relaxed text-ink-400">
                1km 内点位 · 实时展示，不写入数据库
              </p>
            </div>
          </div>
          <button
            data-testid="live-around-action"
            class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-brand-500/30 bg-surface px-2.5 py-1 text-[11px] font-medium text-brand-600 transition hover:border-brand-500/60 hover:bg-brand-50 disabled:opacity-60"
            :disabled="livePoiState === 'loading'"
            @click="loadLivePois"
          >
            <svg
              class="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M20 12a8 8 0 11-2.3-5.7M20 4v4h-4" stroke-linecap="round" />
            </svg>
            {{
              livePoiState === 'loading'
                ? '查询中…'
                : livePoiState === 'success' || livePoiState === 'empty'
                  ? '重新查询'
                  : '查 1km 内'
            }}
          </button>
        </div>

        <p
          v-if="livePoiState === 'idle'"
          class="rounded-lg border border-dashed border-line-strong bg-surface px-2.5 py-2 text-[11px] leading-relaxed text-ink-400"
        >
          按需调用高德周边搜索，节省配额；结果仅用于当前页面展示。
        </p>
        <div v-else-if="livePoiState === 'loading'" class="space-y-1.5" aria-live="polite">
          <div v-for="i in 3" :key="i" class="h-7 animate-pulse rounded-lg bg-surface" />
        </div>
        <div
          v-else-if="livePoiState === 'unavailable' || livePoiState === 'error'"
          data-testid="live-around-status"
          class="rounded-lg border px-2.5 py-2"
          :class="
            livePoiState === 'unavailable'
              ? 'border-amber-200 bg-amber-50/70'
              : 'border-red-200 bg-red-50/60'
          "
        >
          <p
            class="text-[11px] font-medium"
            :class="livePoiState === 'unavailable' ? 'text-amber-700' : 'text-red-600'"
          >
            {{ livePoiState === 'unavailable' ? '实时周边暂不可用' : '实时周边查询失败' }}
          </p>
          <p
            v-if="livePoiMessage"
            class="mt-0.5 break-words text-[11px] leading-relaxed text-ink-500"
          >
            {{ livePoiMessage }}
          </p>
          <p class="mt-0.5 text-[10px] leading-relaxed text-ink-400">
            {{
              livePoiState === 'unavailable'
                ? poi.type === 'community'
                  ? '本地库数据不受影响，仍可使用下方「周边银行」查询。'
                  : '本地库数据不受影响，不影响详情与列表查询。'
                : '可稍后重试，不影响本地库查询。'
            }}
          </p>
        </div>
        <p
          v-else-if="livePoiState === 'empty'"
          data-testid="live-around-status"
          class="rounded-lg border border-dashed border-line-strong bg-surface px-2.5 py-2 text-[11px] leading-relaxed text-ink-400"
        >
          {{ livePoiMessage || '1km 内没有查到点位' }}
        </p>
        <ul v-else-if="livePois.length" data-testid="live-around-list" class="space-y-1">
          <li
            v-for="(item, index) in livePois.slice(0, 5)"
            :key="`${item.name}-${index}`"
            class="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5"
          >
            <span class="min-w-0 flex-1 truncate text-[11px] text-ink-700">{{ item.name }}</span>
            <span class="shrink-0 text-[10px] tabular-nums text-ink-400">
              {{ distanceLabel(item) }}
            </span>
          </li>
        </ul>
        <p v-if="livePoiState === 'success'" class="text-[10px] leading-relaxed text-ink-400">
          来源：高德开放平台 · 实时展示（L2），不写入数据库 · 关闭页面即消失
        </p>
      </section>

      <section
        v-if="poi.type === 'community'"
        class="space-y-2.5 rounded-soft border border-line bg-surface-soft p-3"
      >
        <div class="flex items-center justify-between gap-2">
          <div>
            <p class="flex items-center gap-1.5 text-xs font-medium text-ink-900">
              周边银行
              <span
                class="rounded bg-surface px-1 py-0.5 text-[9px] font-normal text-ink-400 ring-1 ring-line"
              >
                本地库
              </span>
            </p>
            <p class="mt-0.5 text-[10px] text-ink-400">球面距离查询 · 数据已入库</p>
          </div>
          <div class="flex rounded-lg border border-line bg-surface p-0.5">
            <button
              v-for="option in [
                { label: '500m', value: 500 },
                { label: '1km', value: 1000 },
                { label: '3km', value: 3000 },
              ]"
              :key="option.value"
              class="rounded-md px-2 py-0.5 text-[10px] transition"
              :class="
                radius === option.value ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-500'
              "
              @click="changeRadius(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="flex gap-2">
          <button
            class="flex-1 rounded-lg border border-line bg-surface py-1.5 text-[11px] text-ink-600 transition hover:border-brand-500/50 hover:text-brand-600"
            @click="queryNearby('all')"
          >
            查周边银行
          </button>
          <button
            class="flex-1 rounded-lg border border-line bg-surface py-1.5 text-[11px] text-ink-600 transition hover:border-brand-500/50 hover:text-brand-600"
            @click="queryNearby('atm')"
          >
            只看 ATM
          </button>
        </div>

        <div v-if="queried" class="space-y-1.5">
          <p v-if="loading" class="text-[11px] text-ink-400">查询中…</p>
          <p v-else class="text-[11px] text-ink-400">
            半径 {{ radius >= 1000 ? `${radius / 1000}km` : `${radius}m` }} 内共
            <span class="font-medium text-ink-700">{{ nearby.length }}</span> 个结果
          </p>
          <div
            v-if="!loading && nearby.length === 0"
            class="rounded-lg border border-dashed border-line-strong bg-surface px-3 py-4"
          >
            <p class="text-[11px] text-ink-500">该区域本地库暂无数据</p>
            <button
              class="mt-2 text-[11px] font-medium text-brand-600 hover:underline"
              @click="emit('feedback', { poi })"
            >
              请求补充采集
            </button>
          </div>
          <button
            v-for="item in visibleNearby"
            :key="item.poi.id"
            class="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left transition hover:border-brand-500/40"
            @click="emit('locate', item.poi)"
          >
            <span class="min-w-0 flex-1 truncate text-[11px] text-ink-700">{{
              item.poi.name
            }}</span>
            <span class="shrink-0 text-[10px] text-ink-400">
              {{
                item.distance < 1000
                  ? `${Math.round(item.distance)}m`
                  : `${(item.distance / 1000).toFixed(1)}km`
              }}
            </span>
          </button>
        </div>
      </section>
    </div>

    <footer class="flex gap-2 border-t border-line px-4 py-3">
      <button
        class="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-surface py-2 text-xs text-ink-600 transition hover:border-brand-500/50 hover:text-brand-600"
        @click="emit('feedback', { poi })"
      >
        <svg
          class="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        >
          <path
            d="M12 9v4m0 4h.01M10.3 3.9L2.5 17a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        提交纠错
      </button>
      <button
        class="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-brand-500 py-2 text-xs font-medium text-white shadow-card transition hover:bg-brand-600"
        @click="emit('locate', poi)"
      >
        地图定位
      </button>
    </footer>
  </div>
</template>
