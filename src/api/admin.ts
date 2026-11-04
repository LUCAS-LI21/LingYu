import { apiRequest } from './server'

export interface AdminOverview {
  pendingFeedback: number
  totalFeedback: number
  totalJobs: number
  successJobs: number
  failedJobs: number
  runningJobs: number
  hotRegions: number
  versions: number
  avgFreshHours: number
}

export interface FeedbackRow {
  code: string
  poiType: 'bank' | 'community'
  poiId: string
  poiName: string
  type: 'error' | 'closed' | 'add'
  field: string
  newValue: string
  description: string
  contact: string
  status: string
  reviewer: string
  reviewNote: string
  createdAt: string
}

export interface JobRow {
  id: number
  sourceCode: string
  triggerType: string
  scopeValue: string
  status: string
  fetchedCount: number
  insertedCount: number
  updatedCount: number
  failedCount: number
  errorSummary: string
  createdAt: string
  finishedAt: string | null
}

export interface HotspotRow {
  grid: string
  statDate: string
  queryCount: number
  zeroResultCount: number
  priority: number
  updatedAt: string
}

export interface PageResult<T> {
  items: T[]
  total: number
  page?: number
  size?: number
}

export const fetchOverview = () => apiRequest<AdminOverview>('/admin/overview')

export const fetchFeedback = (status: string, page = 1, size = 20) =>
  apiRequest<PageResult<FeedbackRow>>(`/admin/feedback?status=${status}&page=${page}&size=${size}`)

export const approveFeedback = (code: string) =>
  apiRequest<{ status: string; applied: string[] }>(`/admin/feedback/${code}/approve`, {
    method: 'POST',
    body: '{}',
  })

export const rejectFeedback = (code: string, note: string) =>
  apiRequest<{ status: string }>(`/admin/feedback/${code}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  })

export const fetchJobs = () => apiRequest<PageResult<JobRow>>('/admin/jobs')

export const triggerJob = () =>
  apiRequest<{ jobId: number }>('/admin/jobs', { method: 'POST', body: '{}' })

export const fetchHotspots = () => apiRequest<HotspotRow[]>('/admin/hotspots')

export const recomputeHotspots = () =>
  apiRequest<{ affected: number }>('/admin/hotspots/recompute', { method: 'POST', body: '{}' })
