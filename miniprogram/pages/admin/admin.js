const { get, post, getToken, setToken, clearToken } = require('../../utils/api')
const {
  formatDate,
  formatNumber,
  FEEDBACK_STATUS,
  JOB_STATUS,
  AGENT_STATUS,
} = require('../../utils/format')

const FEEDBACK_TYPES = {
  error: '信息有误',
  closed: '已关闭',
  add: '补充 / 新增',
}

Page({
  data: {
    authed: false,
    username: 'operator',
    password: '',
    loggingIn: false,
    loginError: '',
    tab: 'overview',
    tabs: [
      { key: 'overview', label: '概览' },
      { key: 'feedback', label: '反馈审核' },
      { key: 'agent', label: 'Agent 建议' },
      { key: 'jobs', label: '抓取任务' },
      { key: 'hotspots', label: '查询热点' },
      { key: 'coordinates', label: '坐标审核' },
    ],
    loading: false,
    overview: null,
    kpis: [],
    feedback: [],
    feedbackStatus: 'pending',
    feedbackStatuses: [
      { key: 'pending', label: '待审核' },
      { key: 'approved', label: '已采纳' },
      { key: 'rejected', label: '已驳回' },
      { key: 'need_refetch', label: '待重抓' },
      { key: 'all', label: '全部' },
    ],
    feedbackPage: 1,
    feedbackTotal: 0,
    feedbackPages: 1,
    jobs: [],
    hotspots: [],
    coordinateSubmissions: [],
    agentRuns: [],
    agentKeyword: '',
    agentSearching: false,
    agentResults: [],
    agentSelected: null,
    agentFields: [],
    agentFieldIndex: 0,
    agentField: '',
    agentFieldLabel: '',
    agentResult: null,
    busy: '',
  },

  onLoad() {
    if (getToken()) {
      this.setData({ authed: true })
      this.loadTab('overview')
    }
  },

  onUnload() {
    if (this.agentTimer) clearTimeout(this.agentTimer)
  },

  onUsername(e) {
    this.setData({ username: e.detail.value })
  },

  onPassword(e) {
    this.setData({ password: e.detail.value })
  },

  async login() {
    if (!this.data.username.trim() || !this.data.password) {
      this.setData({ loginError: '请输入账号和密码' })
      return
    }
    this.setData({ loggingIn: true, loginError: '' })
    try {
      const data = await post('/auth/login', {
        username: this.data.username.trim(),
        password: this.data.password,
      })
      setToken(data.token)
      this.setData({
        authed: true,
        loggingIn: false,
        password: '',
        tab: 'overview',
      })
      wx.showToast({ title: '登录成功', icon: 'success' })
      this.loadTab('overview')
    } catch (error) {
      this.setData({ loggingIn: false, loginError: error.message || '登录失败' })
    }
  },

  logout() {
    clearToken()
    this.setData({
      authed: false,
      password: '',
      overview: null,
      kpis: [],
      feedback: [],
      jobs: [],
      hotspots: [],
      coordinateSubmissions: [],
      agentRuns: [],
    })
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.key
    if (tab === this.data.tab) return
    this.setData({ tab })
    this.loadTab(tab)
  },

  loadTab(tab) {
    if (tab === 'overview') this.loadOverview()
    else if (tab === 'feedback') this.loadFeedback()
    else if (tab === 'agent') this.loadAgent()
    else if (tab === 'jobs') this.loadJobs()
    else if (tab === 'hotspots') this.loadHotspots()
    else if (tab === 'coordinates') this.loadCoordinates()
  },

  handleError(error) {
    const message = error.message || '加载失败'
    if (message.indexOf('登录') >= 0) {
      clearToken()
      this.setData({ authed: false })
    }
    wx.showToast({ title: message, icon: 'none' })
  },

  async loadOverview() {
    this.setData({ loading: true })
    try {
      const data = await get('/admin/overview')
      this.setData({
        loading: false,
        overview: data,
        kpis: [
          {
            label: '待审核反馈',
            value: formatNumber(data.pendingFeedback),
            hint: '累计 ' + formatNumber(data.totalFeedback) + ' 条',
            tone: data.pendingFeedback ? 'amber' : 'ink',
          },
          {
            label: '抓取任务',
            value: formatNumber(data.totalJobs),
            hint: '成功 ' + formatNumber(data.successJobs) + ' / 失败 ' + formatNumber(data.failedJobs),
            tone: 'brand',
          },
          {
            label: '数据版本',
            value: formatNumber(data.versions),
            hint: '变更留痕条数',
            tone: 'mint',
          },
          {
            label: '平均新鲜度',
            value: Number(data.avgFreshHours || 0).toFixed(1),
            hint: '小时（越低越新）',
            tone: 'ink',
          },
        ],
      })
    } catch (error) {
      this.setData({ loading: false })
      this.handleError(error)
    }
  },

  async loadFeedback() {
    this.setData({ loading: true })
    try {
      const data = await get('/admin/feedback', {
        status: this.data.feedbackStatus,
        page: this.data.feedbackPage,
        size: 10,
      })
      const rows = (data.items || []).map((row) => ({
        code: row.code,
        poiName: row.poiName,
        poiType: row.poiType,
        typeLabel: FEEDBACK_TYPES[row.type] || row.type,
        field: row.field,
        newValue: row.newValue,
        description: row.description,
        contact: row.contact,
        status: row.status,
        statusLabel: FEEDBACK_STATUS[row.status] || row.status,
        statusClass:
          row.status === 'approved'
            ? 'status-mint'
            : row.status === 'rejected'
              ? 'status-red'
              : row.status === 'need_refetch'
                ? 'status-brand'
                : 'status-amber',
        createdAt: formatDate(row.createdAt),
        reviewNote: row.reviewNote,
      }))
      const total = Number(data.total || rows.length)
      this.setData({
        loading: false,
        feedback: rows,
        feedbackTotal: total,
        feedbackPages: Math.max(1, Math.ceil(total / 10)),
      })
    } catch (error) {
      this.setData({ loading: false })
      this.handleError(error)
    }
  },

  setFeedbackStatus(e) {
    this.setData({
      feedbackStatus: e.currentTarget.dataset.status,
      feedbackPage: 1,
    })
    this.loadFeedback()
  },

  feedbackPrev() {
    if (this.data.feedbackPage <= 1) return
    this.setData({ feedbackPage: this.data.feedbackPage - 1 })
    this.loadFeedback()
  },

  feedbackNext() {
    if (this.data.feedbackPage >= this.data.feedbackPages) return
    this.setData({ feedbackPage: this.data.feedbackPage + 1 })
    this.loadFeedback()
  },

  async approve(e) {
    const code = e.currentTarget.dataset.code
    this.setData({ busy: code })
    try {
      const result = await post('/admin/feedback/' + encodeURIComponent(code) + '/approve')
      wx.showToast({
        title: result.status === 'approved' ? '已采纳并生效' : '已标记待重抓',
        icon: 'success',
      })
      this.loadFeedback()
      this.loadOverview()
    } catch (error) {
      this.handleError(error)
    } finally {
      this.setData({ busy: '' })
    }
  },

  reject(e) {
    const code = e.currentTarget.dataset.code
    wx.showModal({
      title: '驳回反馈',
      editable: true,
      placeholderText: '填写驳回原因（默认：信息与现有数据不符）',
      confirmText: '驳回',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return
        this.doReject(code, res.content || '')
      },
    })
  },

  async doReject(code, note) {
    this.setData({ busy: code })
    try {
      await post('/admin/feedback/' + encodeURIComponent(code) + '/reject', {
        note: note.trim() || '信息与现有数据不符',
      })
      wx.showToast({ title: '已驳回', icon: 'none' })
      this.loadFeedback()
      this.loadOverview()
    } catch (error) {
      this.handleError(error)
    } finally {
      this.setData({ busy: '' })
    }
  },

  onAgentKeyword(e) {
    const keyword = e.detail.value
    this.setData({ agentKeyword: keyword })
    if (this.agentTimer) clearTimeout(this.agentTimer)
    if (!keyword.trim()) {
      this.setData({ agentResults: [] })
      return
    }
    this.agentTimer = setTimeout(() => this.searchAgentPois(keyword.trim()), 300)
  },

  async searchAgentPois(keyword) {
    this.setData({ agentSearching: true })
    try {
      const data = await get('/pois', { keyword, size: 5 })
      this.setData({
        agentResults: (data.items || []).map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          address: row.address,
          district: row.district,
        })),
        agentSearching: false,
      })
    } catch (e) {
      this.setData({ agentSearching: false, agentResults: [] })
    }
  },

  selectAgentPoi(e) {
    const index = Number(e.currentTarget.dataset.index)
    const poi = this.data.agentResults[index]
    if (!poi) return
    const agentFields =
      poi.type === 'bank'
        ? [
            { value: 'address', label: '详细地址' },
            { value: 'phone', label: '联系电话' },
            { value: 'openingHours', label: '营业时间' },
          ]
        : [{ value: 'address', label: '详细地址' }]
    this.setData({
      agentSelected: poi,
      agentResults: [],
      agentKeyword: '',
      agentFields,
      agentFieldIndex: 0,
      agentField: agentFields[0].value,
      agentFieldLabel: agentFields[0].label,
      agentResult: null,
    })
  },

  clearAgentPoi() {
    this.setData({
      agentSelected: null,
      agentFields: [],
      agentField: '',
      agentFieldLabel: '',
      agentResult: null,
    })
  },

  onAgentField(e) {
    const index = Number(e.detail.value)
    const field = this.data.agentFields[index]
    this.setData({
      agentFieldIndex: index,
      agentField: field ? field.value : '',
      agentFieldLabel: field ? field.label : '',
    })
  },

  async runAgentPropose() {
    const poi = this.data.agentSelected
    if (!poi || !this.data.agentField) {
      wx.showToast({ title: '请先选择点位与字段', icon: 'none' })
      return
    }
    this.setData({ busy: 'propose', agentResult: null })
    wx.showLoading({ title: 'Agent 运行中…', mask: true })
    try {
      const params =
        '?entityType=' +
        encodeURIComponent(poi.type) +
        '&entityId=' +
        encodeURIComponent(poi.id) +
        '&field=' +
        encodeURIComponent(this.data.agentField)
      const result = await post('/admin/agent/propose' + params)
      const proposal = result.proposal || {}
      this.setData({
        agentResult: {
          status: result.status,
          statusLabel: AGENT_STATUS[result.status] || result.status,
          value: proposal.value || result.reason || '—',
          evidence: proposal.evidence || '',
          sourceUrl: proposal.sourceUrl || '',
          confidence: proposal.confidence || '',
          problems: proposal.problems ? proposal.problems.join('；') : '',
          runId: result.runId,
        },
      })
      wx.showToast({
        title: result.status === 'ready' ? '已生成可采纳建议' : '已生成运行记录',
        icon: 'none',
      })
      this.loadAgent()
    } catch (error) {
      this.handleError(error)
    } finally {
      wx.hideLoading()
      this.setData({ busy: '' })
    }
  },

  async applyProposal() {
    const runId = this.data.agentResult && this.data.agentResult.runId
    if (!runId) return
    this.setData({ busy: 'proposal-apply' })
    try {
      await post('/admin/agent/' + encodeURIComponent(runId) + '/apply')
      wx.showToast({ title: '已采纳并写库', icon: 'success' })
      this.setData({ agentResult: null })
      this.loadAgent()
    } catch (error) {
      this.handleError(error)
    } finally {
      this.setData({ busy: '' })
    }
  },

  async loadAgent() {
    this.setData({ loading: true })
    try {
      const data = await get('/admin/agent/runs', { limit: 20 })
      const source = Array.isArray(data) ? data : data.items || []
      const rows = source.map((row) => {
        let proposal = null
        try {
          proposal = row.result_json ? JSON.parse(row.result_json) : null
        } catch (e) {
          proposal = null
        }
        return {
          id: row.id,
          applyKey: 'agent-' + row.id,
          entityType: row.entity_type || row.entityType,
          entityId: row.entity_id || row.entityId,
          field: row.field,
          status: row.status,
          statusLabel: AGENT_STATUS[row.status] || row.status,
          statusClass:
            row.status === 'ready'
              ? 'status-mint'
              : row.status === 'needs_review'
                ? 'status-amber'
                : row.status === 'applied'
                  ? 'status-brand'
                  : 'status-red',
          value: proposal ? proposal.value || '—' : '—',
          evidence: proposal ? proposal.evidence || '' : '',
          sourceUrl: proposal ? proposal.sourceUrl || '' : '',
          confidence: proposal ? proposal.confidence : '',
          problems: proposal && proposal.problems ? proposal.problems.join('；') : '',
          createdAt: formatDate(row.created_at || row.createdAt),
        }
      })
      this.setData({ loading: false, agentRuns: rows })
    } catch (error) {
      this.setData({ loading: false })
      this.handleError(error)
    }
  },

  async applyAgent(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ busy: 'agent-' + id })
    try {
      await post('/admin/agent/' + encodeURIComponent(id) + '/apply')
      wx.showToast({ title: '已采纳并写库', icon: 'success' })
      this.loadAgent()
    } catch (error) {
      this.handleError(error)
    } finally {
      this.setData({ busy: '' })
    }
  },

  copySource(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.setClipboardData({ data: url })
  },

  async loadJobs() {
    this.setData({ loading: true })
    try {
      const data = await get('/admin/jobs')
      const rows = (data.items || []).map((row) => ({
        id: row.id,
        sourceCode: row.sourceCode,
        status: row.status,
        statusLabel: JOB_STATUS[row.status] || row.status,
        statusClass:
          row.status === 'success'
            ? 'status-mint'
            : row.status === 'failed'
              ? 'status-red'
              : row.status === 'running'
                ? 'status-brand'
                : 'status-amber',
        fetched: formatNumber(row.fetchedCount),
        inserted: formatNumber(row.insertedCount),
        updated: formatNumber(row.updatedCount),
        failed: formatNumber(row.failedCount),
        createdAt: formatDate(row.createdAt),
        finishedAt: row.finishedAt ? formatDate(row.finishedAt) : '',
        errorSummary: row.errorSummary,
      }))
      this.setData({ loading: false, jobs: rows })
    } catch (error) {
      this.setData({ loading: false })
      this.handleError(error)
    }
  },

  async triggerJob() {
    this.setData({ busy: 'job' })
    try {
      const result = await post('/admin/jobs')
      wx.showToast({ title: '任务 #' + result.jobId + ' 已创建', icon: 'success' })
      this.loadJobs()
    } catch (error) {
      this.handleError(error)
    } finally {
      this.setData({ busy: '' })
    }
  },

  async loadHotspots() {
    this.setData({ loading: true })
    try {
      const data = await get('/admin/hotspots')
      const rows = (data || []).map((row) => ({
        grid: row.grid,
        queryCount: formatNumber(row.queryCount),
        zeroCount: formatNumber(row.zeroResultCount),
        priority: Number(row.priority || 0).toFixed(2),
        statDate: row.statDate,
        updatedAt: formatDate(row.updatedAt),
      }))
      this.setData({ loading: false, hotspots: rows })
    } catch (error) {
      this.setData({ loading: false })
      this.handleError(error)
    }
  },

  async recomputeHotspots() {
    this.setData({ busy: 'hotspots' })
    try {
      const result = await post('/admin/hotspots/recompute')
      wx.showToast({ title: '已重算 ' + result.affected + ' 个网格', icon: 'success' })
      this.loadHotspots()
    } catch (error) {
      this.handleError(error)
    } finally {
      this.setData({ busy: '' })
    }
  },

  async loadCoordinates() {
    this.setData({ loading: true })
    try {
      const data = await get('/admin/coordinate-submissions', { status: 'pending', limit: 20 })
      const rows = (data || []).map((row) => ({
        id: row.id,
        busyKey: 'coord-' + row.id,
        name: row.name || row.pending_name || '待核实小区',
        address: row.address || '',
        district: row.district || '',
        lng: Number(row.lng || 0).toFixed(5),
        lat: Number(row.lat || 0).toFixed(5),
        submitter: row.submitter || '用户提交',
      }))
      this.setData({ loading: false, coordinateSubmissions: rows })
    } catch (error) {
      this.setData({ loading: false })
      this.handleError(error)
    }
  },

  reviewCoordinate(e) {
    const id = e.currentTarget.dataset.id
    const action = e.currentTarget.dataset.action
    const label = action === 'approve' ? '通过并转正' : '驳回'
    wx.showModal({
      title: label,
      content: '确认' + label + '这条坐标提交？',
      success: (res) => {
        if (res.confirm) this.doReviewCoordinate(id, action)
      },
    })
  },

  async doReviewCoordinate(id, action) {
    this.setData({ busy: 'coord-' + id })
    try {
      await post('/admin/coordinate-submissions/' + encodeURIComponent(id) + '/' + action)
      wx.showToast({ title: action === 'approve' ? '已通过并转正' : '已驳回', icon: 'none' })
      this.loadCoordinates()
      this.loadOverview()
    } catch (error) {
      this.handleError(error)
    } finally {
      this.setData({ busy: '' })
    }
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' })
  },

  goLand() {
    wx.navigateTo({ url: '/pages/land/land' })
  },

  goPending() {
    wx.navigateTo({ url: '/pages/pending/pending' })
  },


})
