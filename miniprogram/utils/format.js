const DISTRICT_LABELS = {
  bank: '银行网点',
  community: '住宅小区',
}

const FEEDBACK_TYPES = {
  error: '信息有误',
  closed: '已关闭',
  add: '补充 / 新增',
}

const FEEDBACK_STATUS = {
  pending: '待审核',
  approved: '已采纳',
  rejected: '已驳回',
  need_refetch: '待重抓',
  auto_applied: '已受理',
}

const JOB_STATUS = {
  pending: '排队中',
  pending_job: '排队中',
  running: '执行中',
  success: '成功',
  partial: '部分成功',
  failed: '失败',
}

const AGENT_STATUS = {
  ready: '可采纳',
  needs_review: '需复核',
  rejected: '未抽到',
  failed: '失败',
  applied: '已采纳',
  running: '运行中',
  skipped: '已跳过',
  disabled: '未启用',
}

function number(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatNumber(value) {
  const n = number(value)
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatPrice(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = number(value)
  if (!n) return '—'
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万/㎡'
  return formatNumber(n) + ' 元/㎡'
}

function formatFee(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = number(value)
  if (!n) return '—'
  return n.toFixed(2) + ' 元/㎡·月'
}

function formatDistance(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = number(value)
  if (n < 1000) return Math.round(n) + ' m'
  return (n / 1000).toFixed(1) + ' km'
}

function formatArea(value) {
  if (value === null || value === undefined || value === '') return '—'
  const n = number(value)
  return n ? n.toFixed(2) + ' ha' : '—'
}

function formatDate(value) {
  if (!value) return '—'
  return String(value).replace('T', ' ').slice(0, 16)
}

function shortId(id) {
  const text = String(id || '')
  return text.length > 4 ? text.slice(-4) : text
}

function typeLabel(poi) {
  if (!poi) return '点位'
  if (poi.type === 'community') return '住宅小区'
  return poi.branchType === 'atm' ? '银行 ATM' : '银行网点'
}

function statusStyle(status) {
  if (status === 'pending') return 'amber'
  if (status === 'approved' || status === 'auto_applied' || status === 'success') return 'mint'
  if (status === 'rejected' || status === 'failed') return 'red'
  return 'brand'
}

function truncate(text, len) {
  const value = String(text || '')
  if (value.length <= len) return value
  return value.slice(0, len) + '…'
}

module.exports = {
  DISTRICT_LABELS,
  FEEDBACK_TYPES,
  FEEDBACK_STATUS,
  JOB_STATUS,
  AGENT_STATUS,
  number,
  formatNumber,
  formatPrice,
  formatFee,
  formatDistance,
  formatArea,
  formatDate,
  shortId,
  typeLabel,
  statusStyle,
  truncate,
}
