import { defineConfig } from 'vitepress'

export default defineConfig({
  // 初赛提交材料（docx/pdf）不参与文档站构建
  srcExclude: ['preliminary/**'],
  lang: 'zh-CN',
  title: '邻域 POI 情报系统',
  description: '银行/小区 POI 采集与查询系统 · 工程手册',
  cleanUrls: true,
  lastUpdated: false,
  themeConfig: {
    nav: [
      { text: '总览', link: '/' },
      { text: '技术文档', link: '/tech/technical-documentation' },
      { text: '项目需求', link: '/requirements/01-SRS' },
      { text: '六阶段方法', link: '/01-requirements-analysis' },
      { text: '命令速查', link: '/07-command-reference' },
    ],
    sidebar: [
      {
        text: '技术文档',
        items: [{ text: '技术栈 / 功能 / 账号 / 使用', link: '/tech/technical-documentation' }],
      },
      {
        text: '部署',
        items: [{ text: '一键部署（Docker Compose）', link: '/deploy/one-click-deployment' }],
      },
      {
        text: '项目需求（M0）',
        items: [
          { text: '⓪ 赛题原文（基准）', link: '/requirements/00-competition-brief' },
          { text: '① 需求规格说明书', link: '/requirements/01-SRS' },
          { text: '② 数据字典', link: '/requirements/02-data-dictionary' },
          { text: '③ 合规与数据来源', link: '/requirements/03-compliance-and-data-sources' },
        ],
      },
      {
        text: '设计',
        items: [
          { text: '数据接入 Agent（设计）', link: '/design/data-ingestion-agent' },
          { text: '数据源矩阵（能否入库）', link: '/design/data-source-matrix' },
          { text: 'ER 与索引', link: '/design/ER' },
        ],
      },
      {
        text: '调研与核查',
        items: [
          { text: '开源选型调研', link: '/research/poi-open-source-selection' },
          { text: 'appKey 申请入口核查', link: '/research/shenzhen-open-platform-appkey' },
          { text: '核查记录', link: '/research/verification-log' },
        ],
      },
      {
        text: '全流程方法',
        items: [
          { text: '① 需求分析', link: '/01-requirements-analysis' },
          { text: '② 设计', link: '/02-design' },
          { text: '③ 实现', link: '/03-implementation' },
          { text: '④ 测试', link: '/04-testing' },
          { text: '⑤ 部署', link: '/05-deployment' },
          { text: '⑥ 业务闭环', link: '/06-business-loop' },
        ],
      },
      {
        text: '附录',
        items: [{ text: '命令速查', link: '/07-command-reference' }],
      },
    ],
    outline: { label: '本页目录', level: [2, 3] },
    docFooter: { prev: '上一篇', next: '下一篇' },
    darkModeSwitchLabel: '外观',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    footer: {
      message: '邻域 POI 情报系统 · 需求驱动 · 数据闭环',
      copyright: '© 2026 BISAI Agent',
    },
  },
})
