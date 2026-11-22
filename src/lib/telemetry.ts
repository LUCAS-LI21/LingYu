import type { App } from 'vue'

import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals'

type SentryModule = typeof import('@sentry/vue')
type Payload = Record<string, string | number | boolean>

const ENDPOINT = import.meta.env.VITE_ANALYTICS_ENDPOINT

let sentry: SentryModule | null = null
let started = false

/** 统一埋点出口：自建分析 + Sentry 面包屑 */
export function track(event: string, payload: Payload = {}): void {
  const body = { event, payload, path: window.location.pathname, ts: Date.now() }

  if (ENDPOINT) {
    const data = JSON.stringify(body)
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(ENDPOINT, data)
    } else {
      void fetch(ENDPOINT, {
        method: 'POST',
        body: data,
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  sentry?.addBreadcrumb({ category: 'app', level: 'info', message: event, data: payload })

  if (import.meta.env.DEV) {
    console.info('[track]', event, payload)
  }
}

function reportVital(metric: Metric): void {
  track('web_vital', {
    name: metric.name,
    value: Math.round(metric.value),
    rating: metric.rating,
  })
}

function installErrorHooks(): void {
  window.addEventListener('unhandledrejection', (event) => {
    track('unhandled_rejection', { reason: String(event.reason).slice(0, 180) })
  })
  window.addEventListener('error', (event) => {
    track('window_error', { message: (event.message || '').slice(0, 180) })
  })
}

/**
 * 初始化错误监控（Sentry）、Core Web Vitals 与全局异常兜底。
 * 未配置 DSN 时降级为纯埋点模式。
 */
export async function initTelemetry(app: App): Promise<void> {
  if (started) return
  started = true

  installErrorHooks()

  // Core Web Vitals（LCP / INP / CLS / TTFB / FCP）
  onLCP(reportVital)
  onINP(reportVital)
  onCLS(reportVital)
  onTTFB(reportVital)
  onFCP(reportVital)

  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  try {
    const mod = await import('@sentry/vue')
    mod.init({
      app,
      dsn,
      release: __APP_VERSION__,
      environment: import.meta.env.MODE,
      integrations: [mod.browserTracingIntegration()],
      tracesSampleRate: 0.1,
    })
    sentry = mod
  } catch (error) {
    console.warn('[telemetry] Sentry 初始化失败，已降级为纯埋点模式', error)
  }
}
