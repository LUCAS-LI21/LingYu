import type { FeedbackRecord } from '@/api/pois'

const STORAGE_KEY = 'poi_feedback_history_v1'
const MAX_RECORDS = 50

/** 本机提交记录：只用于「我的反馈」展示，审核状态仍以运营后台为准 */
export interface StoredFeedback extends FeedbackRecord {
  savedAt: string
}

function read(): StoredFeedback[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is StoredFeedback => {
      if (!item || typeof item !== 'object') return false
      const record = item as Partial<StoredFeedback>
      return typeof record.code === 'string' && typeof record.createdAt === 'string'
    })
  } catch {
    return []
  }
}

function write(records: StoredFeedback[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // 隐私模式或配额满时静默降级，不阻断反馈提交
  }
}

export function listFeedbackHistory(): StoredFeedback[] {
  return read()
}

export function saveFeedbackRecord(record: FeedbackRecord): StoredFeedback[] {
  const stored: StoredFeedback = { ...record, savedAt: new Date().toISOString() }
  const next = [stored, ...read().filter((item) => item.code !== record.code)].slice(0, MAX_RECORDS)
  write(next)
  return next
}

export function clearFeedbackHistory(): void {
  write([])
}

export function feedbackStatusText(status: string): string {
  if (status === 'auto_applied') return '已自动受理'
  if (status === 'pending') return '待运营审核'
  if (status === 'approved') return '已采纳'
  if (status === 'rejected') return '已驳回'
  if (status === 'need_refetch') return '待重抓'
  return status
}

/** 统一展示成本地时间，兼容 ISO 与后端「YYYY-MM-DD HH:mm」两种格式 */
export function formatFeedbackTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}
