# ⑥ 业务闭环

> 目标：上线不是终点。**埋点 → 指标 → 告警 → 迭代**，让每个版本都能被数据检验。

## 用到的工具

| 工具                                 | 作用                 | 为什么选它                                  |
| ------------------------------------ | -------------------- | ------------------------------------------- |
| Sentry（`@sentry/vue`）              | 错误监控 + 性能追踪  | 前端异常监控的事实标准，支持 sourcemap 还原 |
| web-vitals                           | Core Web Vitals 采集 | Google 官方库，指标定义与搜索排名一致       |
| 自定义埋点（`src/lib/telemetry.ts`） | 业务事件             | 一份代码同时喂给自建分析与 Sentry 面包屑    |

## 三条闭环链路

### 1. 错误闭环

```text
线上异常 → Sentry 聚合去重 → 关联 release 与 sourcemap → 定位代码行 → 修复 → 回归用例
```

`vite.config.ts` 在 production 下生成 `hidden` sourcemap，构建产物不暴露映射，但可上传 Sentry 还原堆栈。

### 2. 性能闭环

`initTelemetry()` 在挂载前注册 LCP / INP / CLS / TTFB / FCP 五个指标，上报为 `web_vital` 事件：

| 指标 | 含义         | 达标线  |
| ---- | ------------ | ------- |
| LCP  | 最大内容渲染 | < 2.5s  |
| INP  | 交互响应     | < 200ms |
| CLS  | 布局偏移     | < 0.1   |
| TTFB | 首字节       | < 800ms |

### 3. 业务闭环

`track(event, payload)` 是唯一出口，例如页面切换 `page_view`、任务创建 `task_create`。
接入自建分析只需配置 `VITE_ANALYTICS_ENDPOINT`，走 `sendBeacon` 不阻塞卸载。

```ts
import { track } from '@/lib/telemetry'

track('task_create', { phase: 'dev' })
```

## 建议看的四个数

| 指标         | 说明           | 异常信号               |
| ------------ | -------------- | ---------------------- |
| 错误率       | 会话中报错比例 | 发版后 30 分钟内翻倍   |
| LCP p75      | 真实用户首屏   | 新版本劣化 > 20%       |
| 核心流程转化 | 创建 → 完成    | 某一步骤流失突增       |
| 回访率       | 7 日内再次访问 | 持续下降说明价值没打透 |

## 验收清单

- [ ] 配好 `VITE_SENTRY_DSN` 后，手动抛错能在 Sentry 看到带 sourcemap 的堆栈
- [ ] 埋点事件能在分析端查到，字段含 `path` 与时间戳
- [ ] 每次发版打 release 号（`__APP_VERSION__` 已注入）
- [ ] 每周固定看一次上面四个数，并回流到需求池
