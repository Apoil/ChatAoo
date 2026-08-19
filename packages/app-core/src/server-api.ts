/**
 * 服务器 REST + WebSocket 客户端。
 */
import type {
  AuthResponse,
  ServerFriend,
  ServerMessage,
  ServerToClient,
  ServerUser,
  SyncResult,
} from '@chataoo/shared'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface UploadResult {
  id: string
  url: string
  sha256: string
  size: number
  name: string
  mime: string
}

export class ServerApi {
  constructor(
    private base: string,
    private getToken: () => string | undefined,
  ) {}

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken()
    const res = await fetch(this.base + path, {
      ...init,
      headers: {
        ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    })
    const text = await res.text()
    if (!res.ok) {
      let msg = text
      try {
        msg = JSON.parse(text).error ?? text
      } catch {
        /* keep raw */
      }
      throw new ApiError(res.status, msg)
    }
    return (text ? JSON.parse(text) : undefined) as T
  }

  /* ---------------- 认证 ---------------- */

  register(identity: { userId: string; publicKey: string }, displayName: string): Promise<AuthResponse> {
    return this.req<AuthResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ userId: identity.userId, publicKey: identity.publicKey, displayName }),
    })
  }

  async login(token: string): Promise<ServerUser> {
    const r = await this.req<{ user: ServerUser }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
    return r.user
  }

  /* ---------------- 好友 ---------------- */

  requestFriend(userId: string): Promise<{ status: string; updatedAt: number }> {
    return this.req('/api/v1/friends/request', { method: 'POST', body: JSON.stringify({ userId }) })
  }

  acceptFriend(userId: string): Promise<{ status: string }> {
    return this.req('/api/v1/friends/accept', { method: 'POST', body: JSON.stringify({ userId }) })
  }

  friends(): Promise<{ friends: ServerFriend[] }> {
    return this.req('/api/v1/friends')
  }

  /* ---------------- 消息 ---------------- */

  sendMessage(msg: {
    id: string
    conversationId: string
    kind: string
    text?: string
    attachment?: unknown
    createdAt: number
  }): Promise<{ seq: number }> {
    return this.req('/api/v1/messages', { method: 'POST', body: JSON.stringify(msg) })
  }

  history(conversationId: string, before: number, limit = 50): Promise<{ messages: ServerMessage[] }> {
    return this.req(`/api/v1/messages?conversationId=${encodeURIComponent(conversationId)}&before=${before}&limit=${limit}`)
  }

  /* ---------------- 同步 ---------------- */

  sync(since: number, profilesSince: number): Promise<SyncResult> {
    return this.req(`/api/v1/sync?since=${since}&profilesSince=${profilesSince}`)
  }

  /* ---------------- 文件 ---------------- */

  uploadFile(file: Blob, name: string, kind: string): Promise<UploadResult> {
    const fd = new FormData()
    fd.append('file', file, name)
    fd.append('kind', kind)
    return this.req<UploadResult>('/api/v1/files', { method: 'POST', body: fd })
  }

  uploadAvatar(file: Blob, name: string): Promise<{ url: string; sha256: string; size: number }> {
    const fd = new FormData()
    fd.append('avatar', file, name)
    return this.req('/api/v1/avatar', { method: 'POST', body: fd })
  }

  /* ---------------- WebSocket ---------------- */

  connectWs(handlers: {
    onOpen?(): void
    onClose?(): void
    onMessage(msg: ServerToClient): void
  }): () => void {
    const url = this.base.replace(/^http/, 'ws') + '/api/v1/ws'
    const ws = new WebSocket(url)
    ws.onopen = () => {
      const token = this.getToken()
      if (token) ws.send(JSON.stringify({ type: 'auth', token }))
      handlers.onOpen?.()
    }
    ws.onclose = () => handlers.onClose?.()
    ws.onerror = () => ws.close()
    ws.onmessage = (ev) => {
      try {
        handlers.onMessage(JSON.parse(String(ev.data)) as ServerToClient)
      } catch {
        /* ignore malformed */
      }
    }
    return () => ws.close()
  }
}
