import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

import { track } from './telemetry'

/** 后端统一响应结构，对接 Spring Boot / Nest 均可复用 */
export interface ApiResult<T> {
  code: number
  message: string
  data: T
}

const TOKEN_KEY = 'bisai_token'

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
})

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (response) => {
    const body = response.data as Partial<ApiResult<unknown>> | undefined
    if (body && typeof body === 'object' && typeof body.code === 'number' && body.code !== 0) {
      track('api_business_error', {
        code: String(body.code),
        url: response.config.url ?? '',
      })
      return Promise.reject(new Error(body.message || '业务处理失败'))
    }
    return response
  },
  (error: AxiosError) => {
    track('api_error', {
      url: error.config?.url ?? '',
      status: String(error.response?.status ?? 'network'),
    })
    return Promise.reject(error)
  },
)

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const { data } = await http.get<ApiResult<T>>(url, { params })
  return data.data
}

export async function post<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await http.post<ApiResult<T>>(url, body)
  return data.data
}

export { TOKEN_KEY }
