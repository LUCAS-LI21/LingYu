import { apiRequest } from './server'

export interface AgentStatus {
  enabled: boolean
  model: string
  baseUrl: string
}

export interface AgentProposal {
  value: string
  evidence: string
  sourceUrl: string
  confidence: number
  problems: string[]
}

export interface AgentProposeResult {
  entityType?: string
  entityId?: string
  name?: string
  field?: string
  status: string
  reason?: string
  proposal?: AgentProposal
  steps?: Array<Record<string, unknown>>
  runId?: number
}

export interface AgentRunRow {
  id: number
  entity_type: string
  entity_id: string
  field: string
  status: string
  result_json: string | null
  reviewed_by: string
  created_at: string
}

export interface AgentApplyResult {
  runId: number
  status: string
  field: string
  value: string
  sourceUrl: string
}

export const fetchAgentStatus = () => apiRequest<AgentStatus>('/admin/agent/status')

export const fetchAgentRuns = (limit = 50) =>
  apiRequest<AgentRunRow[]>(`/admin/agent/runs?limit=${limit}`)

export const proposeAgentField = (entityType: string, entityId: string, field: string) => {
  const params = new URLSearchParams({ entityType, entityId, field })
  return apiRequest<AgentProposeResult>(`/admin/agent/propose?${params.toString()}`, {
    method: 'POST',
  })
}

export const applyAgentRun = (runId: number) =>
  apiRequest<AgentApplyResult>(`/admin/agent/${runId}/apply`, { method: 'POST' })

export interface AgentQualityItem {
  id: string
  name: string
  district?: string
  source?: string
  reason: string
}

export interface AgentQuality {
  checked: number
  flagged: number
  items: AgentQualityItem[]
}

/** 数据质量巡检（规则版）：楼栋编号 / 纯数字 / 过短名称 */
export const fetchAgentQuality = () => apiRequest<AgentQuality>('/admin/agent/quality')
