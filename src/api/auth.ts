const TOKEN_KEY = 'poi_admin_token'

export function getToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
}

export function isLoggedIn(): boolean {
  return getToken().length > 0
}

export async function login(
  username: string,
  password: string,
): Promise<{ token: string; username: string }> {
  const response = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body || body.code !== 0) {
    throw new Error(body?.message || '登录失败')
  }
  setToken(body.data.token)
  return body.data
}
