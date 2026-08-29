/**
 * SQLite 存储层（Node 24 内置 node:sqlite，零原生依赖）。
 * 注意：node:sqlite 返回的行键名与列名完全一致，因此 schema 直接使用驼峰列名，
 * 与 TypeScript 类型一一对应。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Attachment,
  FriendStatus,
  Message,
  MessageKind,
  Profile,
} from '@chataoo/shared'

export interface Db {
  db: DatabaseSync
  close(): void
  /* 用户 */
  createUser(u: {
    userId: string
    username: string
    passwordHash: string
    displayName: string
    createdAt: number
  }): void
  userByUsername(username: string): UserRow | undefined
  /** 重绑定账号到新设备（同时使旧设备全部 token 失效） */
  rebindUser(username: string, oldUserId: string, newUserId: string, displayName: string): void
  setDisplayName(userId: string, displayName: string): void
  getUser(userId: string): UserRow | undefined
  updateUserProfile(userId: string, patch: { avatarUrl?: string; avatarHash?: string; statusText?: string }): void
  touchUser(userId: string): void
  /* token */
  createToken(token: string, userId: string): void
  userForToken(token: string): string | undefined
  /* 好友 */
  friendStatus(a: string, b: string): FriendStatus
  requestFriend(a: string, b: string): { status: FriendStatus; updatedAt: number }
  acceptFriend(a: string, b: string): void
  listFriends(userId: string): FriendRow[]
  /* 消息 */
  insertMessage(m: Message, seq: number): void
  messagesSince(since: number): MessageRow[]
  messagesInConversation(conversationId: string, before: number, limit: number): MessageRow[]
  messageExists(id: string): boolean
  messageById(id: string): MessageRow | undefined
  messageSeq(id: string): number | undefined
  revokeMessage(id: string, seq: number): boolean
  maxSeq(): number
  /* 文件 */
  insertFile(f: FileRow): void
  fileById(id: string): FileRow | undefined
  fileBySha(sha256: string): FileRow | undefined
  /* 工具 */
  transaction<T>(fn: () => T): T
}

export interface UserRow {
  userId: string
  username: string | null
  passwordHash: string | null
  displayName: string
  avatarUrl: string | null
  avatarHash: string | null
  statusText: string | null
  serverSeq: number
  createdAt: number
  updatedAt: number
}

export interface FriendRow {
  a: string
  b: string
  status: string
  updatedAt: number
}

export interface MessageRow {
  id: string
  conversationId: string
  senderId: string
  kind: string
  text: string | null
  attachment: string | null
  createdAt: number
  seq: number
  revoked?: number
}

export interface FileRow {
  id: string
  ownerId: string
  sha256: string
  kind: string
  name: string
  mime: string
  size: number
  path: string
  createdAt: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  userId TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  passwordHash TEXT,
  displayName TEXT NOT NULL,
  avatarUrl TEXT,
  avatarHash TEXT,
  statusText TEXT,
  serverSeq INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS friends (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  status TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL,
  senderId TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT,
  attachment TEXT,
  createdAt INTEGER NOT NULL,
  seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_seq ON messages(seq);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversationId, createdAt);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  ownerId TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_sha ON files(sha256);
`

export function rowToMessage(r: MessageRow): Message {
  const m: Message = {
    id: r.id,
    conversationId: r.conversationId,
    senderId: r.senderId,
    kind: r.kind as MessageKind,
    createdAt: r.createdAt,
    status: 'delivered',
    seq: r.seq,
  }
  if (r.revoked) {
    m.revoked = true
    m.text = '消息已撤回'
    return m
  }
  if (r.text !== null) m.text = r.text
  if (r.attachment !== null) {
    try {
      m.attachment = JSON.parse(r.attachment) as Attachment
    } catch {
      /* 坏 JSON 跳过，避免整页同步失败 */
    }
  }
  return m
}

/** 旧库迁移：为 users 表补充账号字段 */
function migrate(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[]
  const has = (name: string) => cols.some((c) => c.name === name)
  if (!has('username')) db.exec('ALTER TABLE users ADD COLUMN username TEXT')
  if (!has('passwordHash')) db.exec('ALTER TABLE users ADD COLUMN passwordHash TEXT')
  const msgCols = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[]
  if (!msgCols.some((c) => c.name === 'revoked')) {
    db.exec('ALTER TABLE messages ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0')
  }
  if (!has('username')) return
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)')
  } catch {
    /* 已存在 */
  }
}

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(join(dataDir, 'chataoo.db'))
  // 使用默认 DELETE journal（而非 WAL）：Windows 上 node:sqlite 的 WAL 存在
  // 跨进程读一致性问题（其他连接读不到未 checkpoint 的数据），本应用写量不大，
  // DELETE 模式即时可见、行为可预期。
  db.exec('PRAGMA journal_mode = DELETE;')
  db.exec(SCHEMA)
  migrate(db)

  const stmt = {
    createUser: db.prepare(
      `INSERT INTO users (userId, username, passwordHash, displayName, serverSeq, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    ),
    userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    rebindUser: db.prepare('UPDATE users SET userId = ?, displayName = ?, updatedAt = ? WHERE username = ?'),
    deleteUserTokens: db.prepare('DELETE FROM tokens WHERE userId = ?'),
    setDisplayName: db.prepare('UPDATE users SET displayName = ?, updatedAt = ? WHERE userId = ?'),
    getUser: db.prepare('SELECT * FROM users WHERE userId = ?'),
    updateProfile: db.prepare(
      `UPDATE users SET avatarUrl = COALESCE(?, avatarUrl), avatarHash = COALESCE(?, avatarHash),
         statusText = COALESCE(?, statusText), updatedAt = ? WHERE userId = ?`,
    ),
    touchUser: db.prepare('UPDATE users SET updatedAt = ? WHERE userId = ?'),
    createToken: db.prepare('INSERT INTO tokens (token, userId, createdAt) VALUES (?, ?, ?)'),
    userForToken: db.prepare('SELECT userId FROM tokens WHERE token = ?'),
    friendRow: db.prepare('SELECT * FROM friends WHERE a = ? AND b = ?'),
    insertFriend: db.prepare('INSERT OR REPLACE INTO friends (a, b, status, updatedAt) VALUES (?, ?, ?, ?)'),
    listFriends: db.prepare('SELECT * FROM friends WHERE (a = ? OR b = ?) ORDER BY updatedAt DESC'),
    insertMessage: db.prepare(
      `INSERT OR IGNORE INTO messages (id, conversationId, senderId, kind, text, attachment, createdAt, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    messagesSince: db.prepare('SELECT * FROM messages WHERE seq > ? ORDER BY seq ASC LIMIT 500'),
    messagesInConv: db.prepare(
      `SELECT * FROM messages WHERE conversationId = ? AND createdAt < ? ORDER BY createdAt DESC LIMIT ?`,
    ),
    messageExists: db.prepare('SELECT id FROM messages WHERE id = ?'),
    messageById: db.prepare('SELECT * FROM messages WHERE id = ?'),
    messageSeq: db.prepare('SELECT seq FROM messages WHERE id = ?'),
    revokeMessage: db.prepare(
      `UPDATE messages SET revoked = 1, kind = 'system', text = '消息已撤回', attachment = NULL, seq = ? WHERE id = ? AND revoked = 0`,
    ),
    maxSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM messages'),
    insertFile: db.prepare(
      `INSERT INTO files (id, ownerId, sha256, kind, name, mime, size, path, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    fileById: db.prepare('SELECT * FROM files WHERE id = ?'),
    fileBySha: db.prepare('SELECT * FROM files WHERE sha256 = ? ORDER BY createdAt DESC LIMIT 1'),
  }

  return {
    db,
    close: () => db.close(),
    createUser: (u) =>
      stmt.createUser.run(u.userId, u.username, u.passwordHash, u.displayName, u.createdAt, u.createdAt),
    userByUsername: (username) => stmt.userByUsername.get(username) as UserRow | undefined,
    rebindUser: (username, oldUserId, newUserId, displayName) => {
      db.exec('BEGIN IMMEDIATE')
      try {
        stmt.rebindUser.run(newUserId, displayName, Date.now(), username)
        stmt.deleteUserTokens.run(oldUserId)
        db.prepare('UPDATE friends SET a = ? WHERE a = ?').run(newUserId, oldUserId)
        db.prepare('UPDATE friends SET b = ? WHERE b = ?').run(newUserId, oldUserId)
        db.prepare('UPDATE messages SET senderId = ? WHERE senderId = ?').run(newUserId, oldUserId)
        db.prepare('UPDATE files SET ownerId = ? WHERE ownerId = ?').run(newUserId, oldUserId)
        const convs = db
          .prepare(
            'SELECT DISTINCT conversationId FROM messages WHERE conversationId LIKE ? OR conversationId LIKE ?',
          )
          .all(`${oldUserId}__%`, `%__${oldUserId}`) as { conversationId: string }[]
        const updConv = db.prepare('UPDATE messages SET conversationId = ? WHERE conversationId = ?')
        for (const row of convs) {
          const next = rewriteConversationId(row.conversationId, oldUserId, newUserId)
          if (next !== row.conversationId) updConv.run(next, row.conversationId)
        }
        const user = stmt.getUser.get(newUserId) as UserRow | undefined
        if (user?.avatarUrl?.includes(oldUserId)) {
          stmt.updateProfile.run(
            user.avatarUrl.split(oldUserId).join(newUserId),
            user.avatarHash,
            user.statusText,
            Date.now(),
            newUserId,
          )
        }
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    setDisplayName: (userId, displayName) => stmt.setDisplayName.run(displayName, Date.now(), userId),
    getUser: (userId) => stmt.getUser.get(userId) as UserRow | undefined,
    updateUserProfile: (userId, patch) =>
      stmt.updateProfile.run(
        patch.avatarUrl ?? null,
        patch.avatarHash ?? null,
        patch.statusText ?? null,
        Date.now(),
        userId,
      ),
    touchUser: (userId) => stmt.touchUser.run(Date.now(), userId),
    createToken: (token, userId) => stmt.createToken.run(token, userId, Date.now()),
    userForToken: (token) => (stmt.userForToken.get(token) as { userId: string } | undefined)?.userId,
    friendStatus: (a, b) => {
      const r = stmt.friendRow.get(a, b) as FriendRow | undefined
      if (r) {
        if (r.status === 'pending') return 'outgoing'
        return 'friends'
      }
      const rev = stmt.friendRow.get(b, a) as FriendRow | undefined
      if (rev) {
        if (rev.status === 'pending') return 'incoming'
        return 'friends'
      }
      return 'none'
    },
    requestFriend: (a, b) => {
      const now = Date.now()
      const rev = stmt.friendRow.get(b, a) as FriendRow | undefined
      if (rev?.status === 'pending') {
        // 对方已向我发起请求 -> 立即互相确认
        stmt.insertFriend.run(a, b, 'confirmed', now)
        stmt.insertFriend.run(b, a, 'confirmed', now)
        return { status: 'friends', updatedAt: now }
      }
      stmt.insertFriend.run(a, b, 'pending', now)
      return { status: 'outgoing', updatedAt: now }
    },
    acceptFriend: (a, b) => {
      const now = Date.now()
      stmt.insertFriend.run(a, b, 'confirmed', now)
      stmt.insertFriend.run(b, a, 'confirmed', now)
    },
    listFriends: (userId) => stmt.listFriends.all(userId, userId) as unknown as FriendRow[],
    insertMessage: (m, seq) =>
      stmt.insertMessage.run(
        m.id,
        m.conversationId,
        m.senderId,
        m.kind,
        m.text ?? null,
        m.attachment ? JSON.stringify(m.attachment) : null,
        m.createdAt,
        seq,
      ),
    messagesSince: (since) => stmt.messagesSince.all(since) as unknown as MessageRow[],
    messagesInConversation: (conversationId, before, limit) =>
      stmt.messagesInConv.all(conversationId, before, limit) as unknown as MessageRow[],
    messageExists: (id) => stmt.messageExists.get(id) !== undefined,
    messageById: (id) => stmt.messageById.get(id) as MessageRow | undefined,
    messageSeq: (id) => (stmt.messageSeq.get(id) as { seq: number } | undefined)?.seq,
    revokeMessage: (id, seq) => stmt.revokeMessage.run(seq, id).changes > 0,
    maxSeq: () => (stmt.maxSeq.get() as { m: number }).m,
    insertFile: (f) =>
      stmt.insertFile.run(f.id, f.ownerId, f.sha256, f.kind, f.name, f.mime, f.size, f.path, f.createdAt),
    fileById: (id) => stmt.fileById.get(id) as FileRow | undefined,
    fileBySha: (sha256) => stmt.fileBySha.get(sha256) as FileRow | undefined,
    transaction: <T>(fn: () => T): T => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const r = fn()
        db.exec('COMMIT')
        return r
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}

function rewriteConversationId(id: string, oldUserId: string, newUserId: string): string {
  const parts = id.split('__')
  if (parts.length !== 2) return id
  return parts.map((p) => (p === oldUserId ? newUserId : p)).sort().join('__')
}

export function toProfile(u: UserRow): Profile {
  return {
    userId: u.userId,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl ?? undefined,
    avatarHash: u.avatarHash ?? undefined,
    statusText: u.statusText ?? undefined,
    updatedAt: u.updatedAt,
  }
}
