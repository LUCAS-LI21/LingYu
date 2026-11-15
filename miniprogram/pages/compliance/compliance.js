Page({
  data: {
    levels: [
      {
        code: 'L1',
        title: '可入库',
        text: '许可允许存储与加工，进入本地库并参与版本管理',
        className: 'level-l1',
      },
      {
        code: 'L2',
        title: '仅展示',
        text: '即取即显，不落库、不缓存（no-store）、不记响应体',
        className: 'level-l2',
      },
      {
        code: 'L3',
        title: '禁用',
        text: 'robots 禁止或需登录，代码层白名单直接拒绝',
        className: 'level-l3',
      },
    ],
    sources: [
      {
        name: 'OpenStreetMap（Overpass API）',
        license: 'ODbL 1.0',
        level: 'L1 可入库',
        levelClass: 'tag-mint',
        scope: '银行 / ATM / 住宅地块的名称、坐标、地址、营业时间、电话',
        note: '需署名并保持同许可，详情页标注来源',
      },
      {
        name: '种子数据（演示）',
        license: '自建',
        level: 'L1 可入库',
        levelClass: 'tag-mint',
        scope: '小区均价、建成年份、物业费',
        note: 'OSM 不提供商业属性，演示值标注「演示属性」',
      },
      {
        name: '用户反馈',
        license: '用户授权',
        level: 'U 待核实',
        levelClass: 'tag-amber',
        scope: '纠错、关闭、补充',
        note: '低风险字段先展示，坐标与名称变更进入审核',
      },
      {
        name: '高德开放平台 API',
        license: '服务协议',
        level: 'L2 仅展示',
        levelClass: 'tag-brand',
        scope: '周边与地址实时查询（不落库、不缓存）',
        note: '协议禁止存储 API 返回数据，只做即时展示',
      },
    ],
    forbidden: [
      { name: '链家 / 贝壳', reason: 'robots.txt 全站 Disallow，抓取即违反站点声明' },
      { name: '任何需登录 / 验证码 / 付费墙的页面', reason: '无法获得合法访问授权' },
      { name: '地图 API 结果批量入库', reason: '违反平台服务协议的数据存储条款' },
    ],
    disclaimers: [
      '本系统为比赛演示项目，数据仅供参考，不构成任何投资或选址建议。',
      '地图底图与 POI 数据版权归 OpenStreetMap 贡献者（ODbL 1.0），页面保留署名。',
      '小区均价、建成年份、物业费为演示数据，与真实情况可能不符。',
      '系统不采集任何个人信息；用户提交的联系方式仅用于反馈回访。',
      '如权利人认为内容不妥，可通过反馈入口联系，我们将在核实后更正或删除。',
    ],
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' })
  },
})
