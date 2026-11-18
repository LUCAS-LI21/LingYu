<script setup lang="ts">
const sources = [
  {
    name: 'OpenStreetMap（Overpass API）',
    license: 'ODbL 1.0',
    level: 'L1 可入库',
    scope: '银行 / ATM / 住宅地块的名称、坐标、地址、营业时间、电话',
    note: '需署名（© OpenStreetMap contributors）并保持同许可',
  },
  {
    name: '银行官网（11 家）',
    license: '公开经营信息',
    level: 'L1 可入库',
    scope:
      '建行 / 农行 / 招行 / 邮储 / 广发 / 平安 / 交通 / 农商 / 华夏 / 中信 / 光大的网点名称、地址、电话、营业时间',
    note: '各站 robots 均为 404 或未声明禁止；属公开经营信息，未获书面授权，已在数据源表登记',
  },
  {
    name: '深圳市政府数据开放平台',
    license: '政府公开信息（署名）',
    level: 'L1 可入库',
    scope: '物业管理区域名录、小区物业项目、节水型小区、存量住宅用地、保障房、二手房参考价',
    note: '须注明来源且不得转让；其中「物业管理区域基础信息」为有条件开放，已提交申请并于 2026-11-15 审核通过',
  },
  {
    name: '种子数据（演示）',
    license: '自建',
    level: 'L1 可入库',
    scope: '小区均价、建成年份、物业费',
    note: 'OSM 与政府数据不提供这些商业属性，演示值按名称哈希稳定生成，全站标注「演示」',
  },
  {
    name: '用户反馈 / 坐标标注',
    license: '用户授权',
    level: 'U 待核实',
    scope: '纠错、补充、地址与坐标确认',
    note: '坐标提交进入审核队列，通过后来源记为「用户贡献」，字段级留痕可查',
  },
  {
    name: '高德开放平台 API',
    license: '服务协议',
    level: 'L2 仅展示',
    scope: '周边与地址实时查询（不落库、不缓存）',
    note: '协议 3.5 条禁止存储 API 返回数据，因此只做即时展示；地图跳转使用免 Key 的 URI 外链',
  },
  {
    name: 'Esri 底图服务',
    license: '演示授权',
    level: 'L2 仅展示',
    scope: '浅灰 / 彩色 / 卫星三种底图瓦片',
    note: '仅作底图展示并署名（© Esri, HERE, Garmin）；商用需向 Esri 采购授权',
  },
]

const forbidden = [
  { name: '链家 / 贝壳', reason: 'robots.txt 全站 Disallow，抓取即违反站点声明' },
  { name: '任何需登录 / 验证码 / 付费墙的页面', reason: '无法获得合法访问授权' },
  { name: '地图 API 结果批量入库', reason: '违反平台服务协议的数据存储条款' },
]
</script>

<template>
  <div class="space-y-4">
    <header>
      <h1 class="text-xl font-semibold tracking-tight text-ink-900">数据来源与合规声明</h1>
      <p class="mt-1.5 max-w-2xl text-xs leading-relaxed text-ink-500">
        本系统严格区分「可入库数据」与「仅展示数据」。所有 POI
        记录都可追溯来源，实时查询结果不写入任何存储。
      </p>
    </header>

    <section class="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 class="mb-3 text-sm font-semibold text-ink-900">三级授权模型</h2>
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-soft border border-mint-500/25 bg-mint-50 p-3">
          <p class="text-xs font-medium text-mint-600">L1 可入库</p>
          <p class="mt-1 text-[11px] leading-relaxed text-ink-600">
            许可允许存储与加工，进入本地库并参与版本管理
          </p>
        </div>
        <div class="rounded-soft border border-brand-500/25 bg-brand-50 p-3">
          <p class="text-xs font-medium text-brand-600">L2 仅展示</p>
          <p class="mt-1 text-[11px] leading-relaxed text-ink-600">
            即取即显，不落库、不缓存（no-store）、不记响应体
          </p>
        </div>
        <div class="rounded-soft border border-line bg-surface-soft p-3">
          <p class="text-xs font-medium text-ink-500">L3 禁用</p>
          <p class="mt-1 text-[11px] leading-relaxed text-ink-500">
            robots 禁止或需登录，代码层白名单直接拒绝
          </p>
        </div>
      </div>
    </section>

    <section class="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 class="mb-3 text-sm font-semibold text-ink-900">数据来源清单</h2>
      <div class="overflow-x-auto rounded-soft border border-line">
        <table class="w-full min-w-[560px] text-left text-xs">
          <thead class="bg-surface-soft text-[11px] text-ink-400">
            <tr>
              <th class="px-3 py-2 font-medium">来源</th>
              <th class="px-3 py-2 font-medium">许可</th>
              <th class="px-3 py-2 font-medium">级别</th>
              <th class="px-3 py-2 font-medium">覆盖字段</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            <tr v-for="source in sources" :key="source.name" class="align-top">
              <td class="px-3 py-2.5 font-medium text-ink-700">{{ source.name }}</td>
              <td class="px-3 py-2.5 text-ink-500">{{ source.license }}</td>
              <td class="px-3 py-2.5">
                <span
                  class="rounded-full px-1.5 py-0.5 text-[10px]"
                  :class="
                    source.level.startsWith('L1')
                      ? 'bg-mint-50 text-mint-600'
                      : source.level.startsWith('L2')
                        ? 'bg-brand-50 text-brand-600'
                        : 'bg-amber-50 text-amber-600'
                  "
                >
                  {{ source.level }}
                </span>
              </td>
              <td class="px-3 py-2.5 text-ink-500">
                {{ source.scope }}
                <span class="mt-0.5 block text-[10px] text-ink-400">{{ source.note }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 class="mb-3 text-sm font-semibold text-ink-900">明确不采集</h2>
      <ul class="space-y-2">
        <li v-for="item in forbidden" :key="item.name" class="flex items-start gap-2 text-xs">
          <span
            class="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-red-50 text-[10px] text-red-500"
            >×</span
          >
          <span>
            <span class="font-medium text-ink-700">{{ item.name }}</span>
            <span class="ml-1 text-ink-400">— {{ item.reason }}</span>
          </span>
        </li>
      </ul>
    </section>

    <section class="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 class="mb-2 text-sm font-semibold text-ink-900">免责声明</h2>
      <ul class="list-disc space-y-1.5 pl-4 text-[11px] leading-relaxed text-ink-500">
        <li>本系统为比赛演示项目，数据仅供参考，不构成任何投资或选址建议。</li>
        <li>
          地图底图由 Esri 提供（浅灰 / 彩色 / 卫星），署名 © Esri, HERE, Garmin；POI 数据版权归
          OpenStreetMap 贡献者（ODbL 1.0）。
        </li>
        <li>小区均价、建成年份、物业费为演示数据，与真实情况可能不符。</li>
        <li>系统不采集任何个人信息；用户提交的联系方式仅用于反馈回访。</li>
        <li>如权利人认为内容不妥，可通过反馈入口联系，我们将在核实后更正或删除。</li>
      </ul>
      <p class="mt-3 text-[10px] text-ink-400">最后更新：2026-11-05 · 数据版本 v0.3</p>
    </section>
  </div>
</template>
