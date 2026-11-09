/**
 * 服务器 REST + WebSocket 客户端。
 */
import type {
  AuthResponse,
  ResolvedUser,
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

  /** 注册：用户名 + 密码，绑定当前设备身份 */
  register(
    identity: { userId: string; publicKey: string },
    opts: { username: string; password: string; displayName: string },
  ): Promise<AuthResponse> {
    return this.req<AuthResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        userId: identity.userId,
        publicKey: identity.publicKey,
        username: opts.username,
        password: opts.password,
        displayName: opts.displayName,
      }),
    })
  }

  /** 登录：用户名 + 密码（多设备：附带本设备身份，服务器登记为账号的一台设备） */
  login(
    identity: { userId: string; publicKey: string; displayName?: string },
    opts: { username: string; password: string },
  ): Promise<AuthResponse> {
    return this.req<AuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: opts.username,
        password: opts.password,
        userId: identity.userId,
        publicKey: identity.publicKey,
        displayName: identity.displayName,
      }),
    })
  }

  /** 重绑定：新设备用同一账号登录时把账号绑定到本设备身份 */
  rebind(
    identity: { userId: string; publicKey: string },
    opts: { username: string; password: string },
  ): Promise<AuthResponse> {
    return this.req<AuthResponse>('/api/v1/auth/rebind', {
      method: 'POST',
      body: JSON.stringify({
        username: opts.username,
        password: opts.password,
        userId: identity.userId,
        publicKey: identity.publicKey,
      }),
    })
  }

  /** 用 token 校验会话（离线场景也调用，失败即离线模式） */
  async me(): Promise<ServerUser> {
    const r = await this.req<{ user: ServerUser }>('/api/v1/me')
    return r.user
  }

  /** 用户名解析（加好友前查询） */
  resolveUser(username: string): Promise<ResolvedUser> {
    return this.req<ResolvedUser>(`/api/v1/users/resolve?username=${encodeURIComponent(username)}`)
  }

  /** 修改资料 */
  updateProfile(patch: { displayName?: string }): Promise<{ displayName: string }> {
    return this.req('/api/v1/profile', { method: 'PATCH', body: JSON.stringify(patch) })
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

  uploadFile(
    file: Blob,
    name: string,
    kind: string,
    onProgress?: (pct: number) => void,
  ): Promise<UploadResult> {
    const fd = new FormData()
    fd.append('file', file, name)
    fd.append('kind', kind)
    if (!onProgress) return this.req<UploadResult>('/api/v1/files', { method: 'POST', body: fd })
    return this.reqUpload<UploadResult>('/api/v1/files', fd, onProgress)
  }

  lookupFile(sha256: string): Promise<{
    id: string
    url: string
    sha256: string
    name: string
    mime: string
    size: number
    kind: string
  }> {
    return this.req(`/api/v1/files/by-sha/${encodeURIComponent(sha256)}`)
  }

  deleteMessage(id: string): Promise<{ ok: boolean; seq: number }> {
    return this.req(`/api/v1/messages/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  private reqUpload<T>(path: string, body: FormData, onProgress: (pct: number) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', this.base + path)
      const token = this.getToken()
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) onProgress(Math.min(99, Math.round((ev.loaded / ev.total) * 100)))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve((xhr.responseText ? JSON.parse(xhr.responseText) : undefined) as T)
          } catch (e) {
            reject(e)
          }
          return
        }
        let msg = xhr.responseText
        try {
          msg = JSON.parse(xhr.responseText).error ?? msg
        } catch {
          /* keep */
        }
        reject(new ApiError(xhr.status, msg))
      }
      xhr.onerror = () => reject(new ApiError(0, 'upload failed'))
      xhr.send(body)
    })
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
