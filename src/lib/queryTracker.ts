import { recordQuery, type QueryEvent } from '@/api/pois'
import type { PoiType } from '@/types/poi'

const STORAGE_KEY = 'poi_recent_queries_v1'
const MAX_RECENT = 8

export interface RecentQuery {
  keyword: string
  district: string
  types: PoiType[]
  at: number
}

let timer: ReturnType<typeof setTimeout> | null = null
let pending: QueryEvent | null = null

function normalize(event: QueryEvent): RecentQuery {
  return {
    keyword: event.keyword?.trim() ?? '',
    district: event.district?.trim() || '全部区域',
    types: event.types?.length ? [...event.types] : ['bank', 'community'],
    at: Date.now(),
  }
}

function isEmpty(event: RecentQuery): boolean {
  return !event.keyword && event.district === '全部区域'
}

function read(): RecentQuery[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is RecentQuery => {
      if (!item || typeof item !== 'object') return false
      const query = item as Partial<RecentQuery>
      return typeof query.keyword === 'string' && typeof query.district === 'string'
    })
  } catch {
    return []
  }
}

function write(entries: RecentQuery[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // 隐私模式下仅失去本机历史，不影响查询
  }
}

export function rememberQuery(event: QueryEvent): void {
  const entry = normalize(event)
  if (isEmpty(entry)) return
  const next = [
    entry,
    ...read().filter(
      (item) =>
        item.keyword !== entry.keyword ||
        item.district !== entry.district ||
        item.types.join(',') !== entry.types.join(','),
    ),
  ].slice(0, MAX_RECENT)
  write(next)
}

export function listRecentQueries(): RecentQuery[] {
  return read()
}

export function clearRecentQueries(): void {
  write([])
}

export function recentQueryLabel(entry: RecentQuery): string {
  const keyword = entry.keyword || '全部点位'
  return entry.district === '全部区域' ? keyword : `${entry.district} · ${keyword}`
}

/** 立即记录并写入本机最近搜索 */
export function trackQueryNow(event: QueryEvent): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
    pending = null
  }
  rememberQuery(event)
  void recordQuery(event)
}

/** 输入/筛选变化时去抖记录，避免每个按键都打后端 */
export function scheduleQueryLog(event: QueryEvent, delay = 900): void {
  pending = event
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    const next = pending
    pending = null
    if (!next) return
    rememberQuery(next)
    void recordQuery(next)
  }, delay)
}

export function cancelScheduledQuery(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  pending = null
}
