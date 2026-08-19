/**
 * REST API 路由：认证 / 好友 / 消息 / 增量同步 / 文件与头像。
 */
import { join } from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { rename } from 'node:fs/promises'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  directConversationId,
  FILE_PREFIX,
  verifyUserId,
  type AuthResponse,
  type FriendStatus,
  type Message,
  type ResolvedUser,
  type ServerFriend,
  type ServerMessage,
  type ServerProfile,
  type ServerUser,
  type SyncResult,
} from '@chataoo/shared'
import { bearerToken, newToken } from './auth.js'
import { toProfile, type Db, type FriendRow, type UserRow } from './db.js'
import type { Hub } from './hub.js'
import { registerFileRoutes, saveUpload } from './files.js'

export interface RouteOptions {
  db: Db
  hub: Hub
  dataDir: string
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/

function toServerUser(u: UserRow): ServerUser {
  return {
    userId: u.userId,
    username: u.username ?? undefined,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl ?? undefined,
    avatarHash: u.avatarHash ?? undefined,
    serverSeq: u.serverSeq,
    createdAt: u.createdAt,
  }
}

/* ---------------- 密码哈希（scrypt） ---------------- */

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const calc = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return calc.length === expected.length && timingSafeEqual(calc, expected)
}

function toServerMessage(m: Message): ServerMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    kind: m.kind,
    text: m.text,
    attachment: m.attachment,
    createdAt: m.createdAt,
    seq: m.seq ?? 0,
  }
}

export function registerRoutes(app: FastifyInstance, opts: RouteOptions): void {
  const { db, hub } = opts
  const messageDir = join(opts.dataDir, 'files', 'm')
  const avatarDir = join(opts.dataDir, 'files', 'a')

  /* ---------------- 认证 ---------------- */

  /** 注册：创建账号并绑定本设备身份（用户名统一小写） */
  app.post('/api/v1/auth/register', async (req, reply) => {
    const body = req.body as { userId?: string; publicKey?: string; displayName?: string; username?: string; password?: string }
    if (!body.userId || !body.publicKey || !body.displayName || !body.username || !body.password) {
      return reply.code(400).send({ error: 'userId/publicKey/displayName/username/password required' })
    }
    const username = body.username.trim().toLowerCase()
    if (!USERNAME_RE.test(username)) {
      return reply.code(400).send({ error: '用户名需为 3-20 位字母/数字/下划线' })
    }
    if (body.password.length < 6) {
      return reply.code(400).send({ error: '密码至少 6 位' })
    }
    if (!verifyUserId(body.userId, body.publicKey)) {
      return reply.code(400).send({ error: 'userId does not match publicKey' })
    }
    if (db.userByUsername(username)) return reply.code(409).send({ error: '用户名已被占用' })
    if (db.getUser(body.userId)) return reply.code(409).send({ error: '该设备已注册过账号' })
    db.createUser({
      userId: body.userId,
      username,
      passwordHash: hashPassword(body.password),
      displayName: body.displayName,
      createdAt: Date.now(),
    })
    const token = newToken()
    db.createToken(token, body.userId)
    const user = db.getUser(body.userId)!
    const res: AuthResponse = { token, user: toServerUser(user) }
    return res
  })

  /** 登录：用户名 + 密码（用户名不区分大小写）；离线时无法登录，但已保存的登录状态可直接离线使用 */
  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = req.body as { username?: string; password?: string }
    if (!body.username || !body.password) {
      return reply.code(400).send({ error: 'username/password required' })
    }
    const username = body.username.trim().toLowerCase()
    const account = db.userByUsername(username)
    if (!account || !account.passwordHash || !verifyPassword(body.password, account.passwordHash)) {
      return reply.code(401).send({ error: '用户名或密码错误' })
    }
    const token = newToken()
    db.createToken(token, account.userId)
    return { token, user: toServerUser(account) }
  })

  /** 重绑定：新设备用同一账号登录时，把账号绑定到当前设备身份（旧设备数据保留但不再关联） */
  app.post('/api/v1/auth/rebind', async (req, reply) => {
    const body = req.body as { username?: string; password?: string; userId?: string; publicKey?: string }
    if (!body.username || !body.password || !body.userId || !body.publicKey) {
      return reply.code(400).send({ error: 'username/password/userId/publicKey required' })
    }
    if (!verifyUserId(body.userId, body.publicKey)) {
      return reply.code(400).send({ error: 'userId does not match publicKey' })
    }
    const username = body.username.trim().toLowerCase()
    const account = db.userByUsername(username)
    if (!account || !account.passwordHash || !verifyPassword(body.password, account.passwordHash)) {
      return reply.code(401).send({ error: '用户名或密码错误' })
    }
    if (account.userId === body.userId) {
      return reply.code(400).send({ error: '该设备已是账号绑定设备' })
    }
    // 重绑定：账号 userId 切换到新设备身份，旧设备全部 token 失效（旧数据保留但不再关联）
    db.rebindUser(username, account.userId, body.userId, account.displayName)
    const token = newToken()
    db.createToken(token, body.userId)
    const user = db.getUser(body.userId)!
    return { token, user: toServerUser(user) }
  })

  /** 用户名解析（加好友前查询；不区分大小写） */
  app.get<{ Querystring: { username?: string } }>('/api/v1/users/resolve', async (req, reply) => {
    const raw = req.query.username
    if (!raw) return reply.code(400).send({ error: 'username required' })
    const username = raw.trim().toLowerCase()
    const u = db.userByUsername(username)
    if (!u || !u.userId) return reply.code(404).send({ error: '用户不存在' })
    const res: ResolvedUser = {
      userId: u.userId,
      username,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl ?? undefined,
      avatarHash: u.avatarHash ?? undefined,
      statusText: u.statusText ?? undefined,
    }
    return res
  })

  /** 修改资料（昵称等），同步通知好友 */
  app.patch('/api/v1/profile', async (req, reply) => {
    const me = (req as AuthedReq).userId!
    const body = req.body as { displayName?: string }
    if (body.displayName === undefined) return reply.code(400).send({ error: 'nothing to update' })
    const name = String(body.displayName).trim()
    if (!name || name.length > 30) return reply.code(400).send({ error: '昵称需为 1-30 个字符' })
    db.setDisplayName(me, name)
    broadcastProfile(db, hub, me)
    return { displayName: name }
  })

  app.get('/api/v1/me', async (req) => {
    return { user: toServerUser(db.getUser((req as AuthedReq).userId!)!) }
  })

  /* ---------------- 好友 ---------------- */

  app.post('/api/v1/friends/request', async (req, reply) => {
    const me = (req as AuthedReq).userId!
    const body = req.body as { userId?: string }
    if (!body.userId) return reply.code(400).send({ error: 'userId required' })
    if (body.userId === me) return reply.code(400).send({ error: 'cannot add self' })
    const target = db.getUser(body.userId)
    if (!target) return reply.code(404).send({ error: 'user not found' })
    const { status, updatedAt } = db.requestFriend(me, body.userId)
    const meRow = db.getUser(me)!
    if (status === 'friends') {
      // 双向确认：通知双方
      hub.sendTo(body.userId, { type: 'friend', friend: friendEntry(meRow) })
    } else {
      hub.sendTo(body.userId, { type: 'friend', friend: friendEntry(meRow, false) })
    }
    hub.sendTo(me, { type: 'friend', friend: friendEntry(db.getUser(body.userId)!, status === 'friends') })
    return { status, updatedAt }
  })

  app.post('/api/v1/friends/accept', async (req, reply) => {
    const me = (req as AuthedReq).userId!
    const body = req.body as { userId?: string }
    if (!body.userId) return reply.code(400).send({ error: 'userId required' })
    const st = db.friendStatus(me, body.userId)
    if (st !== 'incoming') return reply.code(400).send({ error: 'no pending request' })
    db.acceptFriend(me, body.userId)
    const meRow = db.getUser(me)!
    hub.sendTo(body.userId, { type: 'friend', friend: friendEntry(meRow) })
    hub.sendTo(me, { type: 'friend', friend: friendEntry(db.getUser(body.userId)!) })
    return { status: 'friends' as FriendStatus }
  })

  app.get('/api/v1/friends', async (req) => {
    const me = (req as AuthedReq).userId!
    return { friends: listFriendEntries(db, me) }
  })

  /* ---------------- 消息 ---------------- */

  app.post('/api/v1/messages', async (req, reply) => {
    const me = (req as AuthedReq).userId!
    const body = req.body as Partial<Message>
    if (!body.conversationId || !body.kind || !body.id) {
      return reply.code(400).send({ error: 'conversationId/kind/id required' })
    }
    const peer = peerOfConversation(body.conversationId, me)
    if (!peer) return reply.code(400).send({ error: 'invalid conversation' })
    if (db.friendStatus(me, peer) !== 'friends') {
      return reply.code(403).send({ error: 'not friends' })
    }
    // 幂等：同 ID 消息（LAN 转发的副本也最终会上传）直接返回已有 seq
    const existing = db.transaction(() => {
      if (db.messageExists(body.id!)) return db.messageSeq(body.id!)
      const next = db.maxSeq() + 1
      db.insertMessage(
        {
          id: body.id!,
          conversationId: body.conversationId!,
          senderId: me,
          kind: body.kind!,
          text: body.text,
          attachment: body.attachment,
          createdAt: body.createdAt ?? Date.now(),
          status: 'sent',
        },
        next,
      )
      return next
    })
    if (!existing) return reply.code(500).send({ error: 'duplicate without seq' })
    const msg: Message = {
      id: body.id,
      conversationId: body.conversationId,
      senderId: me,
      kind: body.kind,
      text: body.text,
      attachment: body.attachment,
      createdAt: body.createdAt ?? Date.now(),
      status: 'sent',
      seq: existing,
    }
    db.touchUser(me)
    const serverMsg = toServerMessage(msg)
    hub.sendTo(me, { type: 'message-acked', id: msg.id, seq: existing })
    hub.sendTo(peer, { type: 'message', message: serverMsg })
    return { seq: existing }
  })

  app.get<{ Querystring: { conversationId?: string; before?: string; limit?: string } }>(
    '/api/v1/messages',
    async (req, reply) => {
      const me = (req as AuthedReq).userId!
      const conversationId = req.query.conversationId
      if (!conversationId) return reply.code(400).send({ error: 'conversationId required' })
      const peer = peerOfConversation(conversationId, me)
      if (!peer) return reply.code(400).send({ error: 'invalid conversation' })
      const before = Number(req.query.before ?? Date.now())
      const limit = Math.min(Number(req.query.limit ?? 50), 100)
      const rows = db.messagesInConversation(conversationId, before, limit)
      return { messages: rows.map((r) => toServerMessage(r as unknown as Message)) }
    },
  )

  /* ---------------- 增量同步 ---------------- */

  app.get<{ Querystring: { since?: string; profilesSince?: string } }>('/api/v1/sync', async (req) => {
    const me = (req as AuthedReq).userId!
    const since = Number(req.query.since ?? 0)
    const profilesSince = Number(req.query.profilesSince ?? 0)
    const rows = db.messagesSince(since)
    const mine = rows.filter((r) => {
      const [a, b] = r.conversationId.split('__')
      return a === me || b === me
    })
    const messages = mine.map((r) => toServerMessage(r as unknown as Message))
    const friends = listFriendEntries(db, me).filter((f) => f.confirmed)
    const profiles: ServerProfile[] = []
    for (const f of friends) {
      const u = db.getUser(f.userId)
      if (u && u.updatedAt > profilesSince) profiles.push(toProfile(u))
    }
    const result: SyncResult = {
      messages,
      profiles,
      friends,
      nextSeq: db.maxSeq(),
      serverTime: Date.now(),
    }
    return result
  })

  /* ---------------- 文件与头像 ---------------- */

  app.post('/api/v1/avatar', async (req, reply) => {
    const me = (req as AuthedReq).userId!
    const saved = await saveUpload(req, avatarDir, `${me}.upload`)
    const finalName = `${me}${extFromMime(saved.mime)}`
    if (finalName !== saved.id) {
      await rename(join(avatarDir, saved.id), join(avatarDir, finalName))
    }
    db.updateUserProfile(me, {
      avatarUrl: `${FILE_PREFIX.avatar}/${me}?v=${Date.now()}`,
      avatarHash: saved.sha256,
    })
    const meRow = db.getUser(me)!
    const profile = toProfile(meRow)
    broadcastProfile(db, hub, me)
    return { url: profile.avatarUrl, sha256: saved.sha256, size: saved.size }
  })

  app.post('/api/v1/files', async (req, reply) => {
    const me = (req as AuthedReq).userId!
    const saved = await saveUpload(req, messageDir, randomBytes(12).toString('hex'))
    db.insertFile({
      id: saved.id,
      ownerId: me,
      sha256: saved.sha256,
      kind: (req.body as { kind?: string } | undefined)?.kind ?? 'file',
      name: saved.name,
      mime: saved.mime,
      size: saved.size,
      path: join(messageDir, saved.id),
      createdAt: Date.now(),
    })
    return {
      id: saved.id,
      url: `${FILE_PREFIX.message}/${saved.id}`,
      sha256: saved.sha256,
      size: saved.size,
      name: saved.name,
      mime: saved.mime,
    }
  })

  registerFileRoutes(app, { db, messageDir, avatarDir })
}

/* ---------------- 辅助 ---------------- */

interface AuthedReq {
  userId?: string
}

/** preHandler 认证钩子（注册/登录/静态文件除外） */
export function authHook(app: FastifyInstance, db: Db): void {
  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0]!
    if (
      url.startsWith('/files/') ||
      url === '/api/v1/auth/register' ||
      url === '/api/v1/auth/login' ||
      url === '/api/v1/auth/rebind' ||
      url === '/api/v1/ws' ||
      url === '/health'
    )
      return
    const token = bearerToken(req)
    const userId = token ? db.userForToken(token) : undefined
    if (!userId) {
      await reply.code(401).send({ error: 'unauthorized' })
      return
    }
    ;(req as AuthedReq).userId = userId
  })
}

function peerOfConversation(conversationId: string, me: string): string | undefined {
  const [a, b] = conversationId.split('__')
  if (!a || !b) return undefined
  if (a === me) return b
  if (b === me) return a
  return undefined
}

function friendEntry(u: UserRow, confirmed = true): ServerFriend {
  return {
    userId: u.userId,
    username: u.username ?? undefined,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl ?? undefined,
    avatarHash: u.avatarHash ?? undefined,
    statusText: u.statusText ?? undefined,
    confirmed,
    updatedAt: u.updatedAt,
  }
}

function listFriendEntries(db: Db, me: string): ServerFriend[] {
  const rows = db.listFriends(me) as FriendRow[]
  const out: ServerFriend[] = []
  for (const r of rows) {
    const otherId = r.a === me ? r.b : r.a
    const other = db.getUser(otherId)
    if (!other) continue
    out.push(friendEntry(other, r.status === 'confirmed'))
  }
  return out
}

/** 通知所有好友：我的资料已更新 */
function broadcastProfile(db: Db, hub: Hub, userId: string): void {
  const row = db.getUser(userId)
  if (!row) return
  const profile = toProfile(row)
  for (const f of listFriendEntries(db, userId)) {
    if (f.confirmed) hub.sendTo(f.userId, { type: 'profile', profile })
  }
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('png')) return '.png'
  if (m.includes('webp')) return '.webp'
  if (m.includes('gif')) return '.gif'
  return '.jpg'
}
