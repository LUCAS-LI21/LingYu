import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: '邻域 POI 情报系统',
  description: '银行/小区 POI 采集与查询系统 · 工程手册',
  cleanUrls: true,
  lastUpdated: false,
  themeConfig: {
    nav: [
      { text: '总览', link: '/' },
      { text: '技术文档', link: '/tech/技术文档' },
      { text: '项目需求', link: '/requirements/01-SRS' },
      { text: '六阶段方法', link: '/01-需求分析' },
      { text: '命令速查', link: '/07-命令速查' },
    ],
    sidebar: [
      {
        text: '技术文档',
        items: [{ text: '技术栈 / 功能 / 账号 / 使用', link: '/tech/技术文档' }],
      },
      {
        text: '部署',
        items: [{ text: '一键部署（Docker Compose）', link: '/deploy/一键部署' }],
      },
      {
        text: '项目需求（M0）',
        items: [
          { text: '① 需求规格说明书', link: '/requirements/01-SRS' },
          { text: '② 数据字典', link: '/requirements/02-数据字典' },
          { text: '③ 合规与数据来源', link: '/requirements/03-合规与数据来源' },
        ],
      },
      {
        text: '设计',
        items: [
          { text: '数据源矩阵（能否入库）', link: '/design/数据源矩阵' },
          { text: 'ER 与索引', link: '/design/ER' },
        ],
      },
      {
        text: '调研与核查',
        items: [
          { text: '开源选型调研', link: '/research/poi-开源选型调研' },
          { text: '核查记录', link: '/research/verification-log' },
        ],
      },
      {
        text: '全流程方法',
        items: [
          { text: '① 需求分析', link: '/01-需求分析' },
          { text: '② 设计', link: '/02-设计' },
          { text: '③ 实现', link: '/03-实现' },
          { text: '④ 测试', link: '/04-测试' },
          { text: '⑤ 部署', link: '/05-部署' },
          { text: '⑥ 业务闭环', link: '/06-业务闭环' },
        ],
      },
      {
        text: '附录',
        items: [{ text: '命令速查', link: '/07-命令速查' }],
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
