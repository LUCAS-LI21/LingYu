import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'BISAI Agent',
  description: '网站开发全流程工程手册',
  cleanUrls: true,
  lastUpdated: false,
  themeConfig: {
    nav: [
      { text: '总览', link: '/' },
      { text: '六阶段', link: '/01-需求分析' },
      { text: '命令速查', link: '/07-命令速查' },
    ],
    sidebar: [
      {
        text: '全流程',
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
      message: '基于 Vue 3 + Vite + TypeScript 的全流程工程骨架',
      copyright: '© 2026 BISAI Agent',
    },
  },
})
