/**
 * REST API 路由：认证 / 好友 / 消息 / 增量同步 / 文件与头像。
 */
import { join } from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { readdirSync, renameSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  directConversationId,
  FILE_PREFIX,
  verifyUserId,
  type Attachment,
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
import { rowToMessage, toProfile, type Db, type FileRow, type FriendRow, type UserRow } from './db.js'
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

function asAttachment(raw: unknown): Attachment | undefined {
  if (!raw) return undefined
  let v: unknown = raw
  for (let i = 0; i < 2 && typeof v === 'string'; i++) {
    try {
      v = JSON.parse(v)
    } catch {
      return undefined
    }
  }
  if (!v || typeof v !== 'object') return undefined
  return v as Attachment
}

function kindFromFile(f: FileRow, fallback: Attachment['kind']): Attachment['kind'] {
  if (f.kind === 'image' || f.kind === 'video' || f.kind === 'audio' || f.kind === 'file') return f.kind
  if (f.mime.startsWith('image/')) return 'image'
  if (f.mime.startsWith('video/')) return 'video'
  if (f.mime.startsWith('audio/')) return 'audio'
  return fallback
}

function enrichAttachment(db: Db, raw: unknown): Attachment | undefined {
  const att = asAttachment(raw)
  if (!att) return undefined
  const fromUrl = att.url?.match(/\/files\/m\/([^/?#]+)/)?.[1]
  const file =
    (att.sha256 ? db.fileBySha(att.sha256) : undefined) ?? (fromUrl ? db.fileById(fromUrl) : undefined)
  if (!file) return att
  return {
    ...att,
    url: att.url || `${FILE_PREFIX.message}/${file.id}`,
    name: att.name || file.name,
    size: att.size || file.size,
    mimeType: att.mimeType || file.mime,
    kind: att.kind && att.kind !== 'file' ? att.kind : kindFromFile(file, att.kind || 'file'),
    sha256: att.sha256 || file.sha256,
  }
}

function toServerMessage(m: Message, db?: Db): ServerMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    kind: m.revoked ? 'system' : m.kind,
    text: m.revoked ? '消息已撤回' : m.text,
    attachment: m.revoked ? undefined : db ? enrichAttachment(db, m.attachment) : asAttachment(m.attachment),
    createdAt: m.createdAt,
    seq: m.seq ?? 0,
    revoked: m.revoked,
  }
}

function repairUserAvatar(db: Db, avatarDir: string, u: UserRow): UserRow {
  let found = false
  try {
    for (const f of readdirSync(avatarDir)) {
      if (f.startsWith(`${u.userId}.`)) {
        found = true
        break
      }
    }
  } catch {
    return u
  }
  if (!found) return u
  const expected = `${FILE_PREFIX.avatar}/${u.userId}`
  if (u.avatarUrl?.startsWith(expected)) return u
  db.updateUserProfile(u.userId, { avatarUrl: `${expected}?v=${Date.now()}` })
  return db.getUser(u.userId) ?? u
}

export function registerRoutes(app: FastifyInstance, opts: RouteOptions): void {
  const { db, hub } = opts
  const messageDir = join(opts.dataDir, 'files', 'm')
  const avatarDir = join(opts.dataDir, 'files', 'a')

  function publicUser(u: UserRow): ServerUser {
    return toServerUser(repairUserAvatar(db, avatarDir, u))
  }

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
    const existing = db.getUser(body.userId)
    if (existing) {
      if (existing.username) {
        // 该设备身份已经是某个账号的绑定设备，不能再注册新账号
        return reply.code(409).send({
          error: `该设备已绑定账号「${existing.username}」，请直接登录该账号；要改用其他账号需要先在设置中重置设备身份`,
          code: 'device-bound',
          boundUsername: existing.username,
        })
      }
      // 该设备身份只是「参与过局域网聊天但没注册账号」的占位行 → 直接认领为账号，保留历史数据
      db.claimDeviceStub(body.userId, username, hashPassword(body.password), body.displayName)
      db.upsertDevice({ deviceId: body.userId, accountUserId: body.userId, publicKey: body.publicKey, displayName: body.displayName })
      const claimedToken = newToken()
      db.createToken(claimedToken, body.userId)
      const claimedUser = db.getUser(body.userId)!
      return { token: claimedToken, user: publicUser(claimedUser) } satisfies AuthResponse
    }
    db.createUser({
      userId: body.userId,
      username,
      passwordHash: hashPassword(body.password),
      displayName: body.displayName,
      createdAt: Date.now(),
    })
    db.upsertDevice({ deviceId: body.userId, accountUserId: body.userId, publicKey: body.publicKey, displayName: body.displayName })
    const token = newToken()
    db.createToken(token, body.userId)
    const user = db.getUser(body.userId)!
    const res: AuthResponse = { token, user: publicUser(user) }
    return res
  })

  /**
   * 登录：用户名 + 密码（用户名不区分大小写）。
   * 同一账号可在多台设备同时登录：传入本设备的 userId/publicKey 会登记为账号的一台设备，
   * 签发的 token 绑定到「账号」，不会踢掉其它设备。
   */
  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = req.body as {
      username?: string
      password?: string
      userId?: string
      publicKey?: string
      displayName?: string
    }
    if (!body.username || !body.password) {
      return reply.code(400).send({ error: 'username/password required' })
    }
    const username = body.username.trim().toLowerCase()
    const account = db.userByUsername(username)
    if (!account || !account.passwordHash || !verifyPassword(body.password, account.passwordHash)) {
      return reply.code(401).send({ error: '用户名或密码错误' })
    }
    if (body.userId && body.publicKey) {
      if (!verifyUserId(body.userId, body.publicKey)) {
        return reply.code(400).send({ error: 'userId does not match publicKey' })
      }
      db.upsertDevice({
        deviceId: body.userId,
        accountUserId: account.userId,
        publicKey: body.publicKey,
        displayName: body.displayName ?? account.displayName,
      })
      // 设备变化要让好友下次同步时拿到新的设备列表
      db.touchUser(account.userId)
    }
    const token = newToken()
    db.createToken(token, account.userId)
    return { token, user: publicUser(account) }
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
    const occupied = db.getUser(body.userId)
    if (occupied) {
      if (occupied.username) {
        // 目标设备已经绑定了另一个账号：不能静默抢占，给出可操作的提示
        return reply.code(409).send({
          error: `该设备已绑定账号「${occupied.username}」，请先用「${occupied.username}」登录；要改用「${username}」需要先在设置中重置设备身份`,
          code: 'device-bound',
          boundUsername: occupied.username,
        })
      }
      // 只是未注册账号的身份占位行（例如局域网聊天时创建）→ 清掉后把账号接管过来
      db.removeDeviceStub(body.userId)
    }
    const oldId = account.userId
    try {
      db.rebindUser(username, oldId, body.userId, account.displayName)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('UNIQUE constraint failed')) {
        return reply.code(409).send({
          error: '该设备已被其他账号占用，无法完成换绑；请先在设置中重置设备身份后重试',
          code: 'device-bound',
        })
      }
      throw e
    }
    try {
      for (const f of readdirSync(avatarDir)) {
        if (f.startsWith(`${oldId}.`)) {
          renameSync(join(avatarDir, f), join(avatarDir, `${body.userId}${f.slice(oldId.length)}`))
        }
      }
    } catch {
      /* 无头像文件 */
    }
    const token = newToken()
    db.createToken(token, body.userId)
    // 换绑后：账号旧的设备登记全部作废，只保留这台新设备
    db.clearDevices(body.userId)
    db.upsertDevice({ deviceId: body.userId, accountUserId: body.userId, publicKey: body.publicKey, displayName: account.displayName })
    const user = db.getUser(body.userId)!
    return { token, user: publicUser(user) }
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
    return { user: publicUser(db.getUser((req as AuthedReq).userId!)!) }
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
      hub.sendTo(body.userId, { type: 'friend', friend: friendEntry(meRow, 'friends') })
    } else {
      hub.sendTo(body.userId, { type: 'friend', friend: friendEntry(meRow, 'incoming') })
    }
    hub.sendTo(me, { type: 'friend', friend: friendEntry(db.getUser(body.userId)!, status) })
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
    hub.sendTo(body.userId, { type: 'friend', friend: friendEntry(meRow, 'friends') })
    hub.sendTo(me, { type: 'friend', friend: friendEntry(db.getUser(body.userId)!, 'friends') })
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
    const serverMsg = toServerMessage(msg, db)
    hub.sendTo(me, { type: 'message-acked', id: msg.id, seq: existing })
    hub.sendTo(peer, { type: 'message', message: serverMsg })
    return { seq: existing }
  })

  app.delete<{ Params: { id: string } }>('/api/v1/messages/:id', async (req, reply) => {
    const me = (req as AuthedReq).userId!
    const row = db.messageById(req.params.id)
    if (!row) return reply.code(404).send({ error: 'not found' })
    if (row.senderId !== me) return reply.code(403).send({ error: 'only sender can revoke' })
    if (row.revoked) return { ok: true, seq: row.seq }
    const peer = peerOfConversation(row.conversationId, me)
    if (!peer) return reply.code(400).send({ error: 'invalid conversation' })
    const seq = db.maxSeq() + 1
    db.revokeMessage(row.id, seq)
    const payload = { type: 'message-deleted' as const, id: row.id, conversationId: row.conversationId }
    hub.sendTo(me, payload)
    hub.sendTo(peer, payload)
    return { ok: true, seq }
  })

  app.get<{ Querystring: { conversationId?: string; before?: string; limit?: string } }>(
    '/api/v1/messages',
    async (req, reply) => {
      const me = (req as AuthedReq).userId!
      const conversationId = req.query.conversationId
      if (!conversationId) return reply.code(400).send({ error: 'conversationId required' })
      const peer = peerOfConversation(conversationId, me)
      if (!peer) return reply.code(400).send({ error: 'invalid conversation' })
      const rawBefore = Number(req.query.before)
      const before = Number.isFinite(rawBefore) && rawBefore > 0 ? rawBefore : Number.MAX_SAFE_INTEGER
      const limit = Math.min(Number(req.query.limit ?? 50), 100)
      const rows = db.messagesInConversation(conversationId, before, limit)
      return { messages: rows.map((r) => toServerMessage(rowToMessage(r), db)) }
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
    const messages = mine.map((r) => toServerMessage(rowToMessage(r), db))
    const friends = listFriendEntries(db, me)
    const profiles: ServerProfile[] = []
    const meRow = db.getUser(me)
    if (meRow && (profilesSince === 0 || meRow.updatedAt > profilesSince)) {
      profiles.push({ ...toProfile(repairUserAvatar(db, avatarDir, meRow)), devices: db.devicesForUser(meRow.userId) })
    }
    for (const f of friends) {
      const u = db.getUser(f.userId)
      if (u && u.updatedAt > profilesSince) {
        profiles.push({ ...toProfile(u), devices: db.devicesForUser(u.userId) })
      }
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

  app.get<{ Params: { sha: string } }>('/api/v1/files/by-sha/:sha', async (req, reply) => {
    const sha = req.params.sha.trim().toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(sha)) return reply.code(400).send({ error: 'bad sha' })
    const file = db.fileBySha(sha)
    if (!file) return reply.code(404).send({ error: 'not found' })
    return {
      id: file.id,
      url: `${FILE_PREFIX.message}/${file.id}`,
      sha256: file.sha256,
      name: file.name,
      mime: file.mime,
      size: file.size,
      kind: file.kind,
    }
  })

  registerFileRoutes(app, { db, messageDir, avatarDir })
}

/* ---------------- 辅助 ---------------- */

interface AuthedReq {
  userId?: string
}

/** preHandler 认证钩子（API 之外的路径——网页版静态资源、/files 静态文件、/health——放行） */
export function authHook(app: FastifyInstance, db: Db): void {
  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0]!
    // 网页版页面与其静态资源不走 API 鉴权；WS 自己完成鉴权
    if (!url.startsWith('/api/')) return
    if (
      url === '/api/v1/auth/register' ||
      url === '/api/v1/auth/login' ||
      url === '/api/v1/auth/rebind' ||
      url === '/api/v1/ws'
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

function friendEntry(u: UserRow, status: FriendStatus = 'friends'): ServerFriend {
  return {
    userId: u.userId,
    username: u.username ?? undefined,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl ?? undefined,
    avatarHash: u.avatarHash ?? undefined,
    statusText: u.statusText ?? undefined,
    confirmed: status === 'friends',
    status,
    updatedAt: u.updatedAt,
  }
}

function listFriendEntries(db: Db, me: string): ServerFriend[] {
  const rows = db.listFriends(me) as FriendRow[]
  const out: ServerFriend[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const otherId = r.a === me ? r.b : r.a
    if (seen.has(otherId)) continue
    const other = db.getUser(otherId)
    if (!other) continue
    const st = db.friendStatus(me, otherId)
    if (st === 'none') continue
    seen.add(otherId)
    out.push(friendEntry(other, st))
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
