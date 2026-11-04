import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { http as mswHttp, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { get, post } from '@/lib/http'

// 接口层用 MSW 拦截，测试不依赖真实后端，也能稳定复现异常分支
const handlers = [
  mswHttp.get('/api/health', () =>
    HttpResponse.json({ code: 0, message: 'ok', data: { status: 'up', version: '0.1.0' } }),
  ),
  mswHttp.get('/api/session', () =>
    HttpResponse.json({ code: 401, message: '登录状态已失效', data: null }),
  ),
  mswHttp.post('/api/tasks', async ({ request }) => {
    const body = (await request.json()) as { title: string }
    return HttpResponse.json({ code: 0, message: 'ok', data: { id: 't-100', title: body.title } })
  }),
]

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('http 客户端', () => {
  it('自动解包统一响应体', async () => {
    const data = await get<{ status: string; version: string }>('/health')
    expect(data.status).toBe('up')
    expect(data.version).toBe('0.1.0')
  })

  it('业务码非 0 时按异常抛出', async () => {
    await expect(get('/session')).rejects.toThrow('登录状态已失效')
  })

  it('POST 透传请求体并返回数据', async () => {
    const data = await post<{ id: string; title: string }>('/tasks', { title: '联调部署脚本' })
    expect(data.id).toBe('t-100')
    expect(data.title).toBe('联调部署脚本')
  })

  it('网络异常时 reject 原始错误', async () => {
    server.use(mswHttp.get('/api/health', () => HttpResponse.error()))
    await expect(get('/health')).rejects.toBeTruthy()
  })
})
