/**
 * 离线优先本地存储（IndexedDB，统一桌面/移动端）。
 * 所有数据先落本地：消息、会话、资料、好友、待同步队列、同步游标。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { directConversationId, type Conversation, type FriendStatus, type Message, type Profile } from '@chataoo/shared'

export interface FriendRecord {
  userId: string
  status: FriendStatus
  updatedAt: number
}

export interface OutboxEntry {
  message: Message
  attempt: number
  addedAt: number
}

interface Schema extends DBSchema {
  kv: { key: string; value: unknown }
  conversations: {
    key: string
    value: Conversation
    indexes: { byUpdatedAt: number }
  }
  messages: {
    key: string
    value: Message
    indexes: { byConv: [string, number] }
  }
  profiles: {
    key: string
    value: Profile
    indexes: { byUpdatedAt: number }
  }
  friends: { key: string; value: FriendRecord }
  outbox: { key: string; value: OutboxEntry }
  cursors: { key: string; value: number }
}

const DB_NAME = 'chataoo'
const DB_VERSION = 1

export class LocalStore {
  private constructor(private db: IDBPDatabase<Schema>) {}

  /**
   * 统一写入口：任何不可克隆的值（函数/循环引用/代理对象等）都会
   * 在这里被捕获，记录确切位置并尝试 JSON 清洗降级，避免应用崩溃。
   */
  private async putSafe(
    storeName: 'kv' | 'conversations' | 'messages' | 'profiles' | 'friends' | 'outbox' | 'cursors',
    value: unknown,
    key?: IDBValidKey,
    context = '',
  ): Promise<void> {
    try {
      await (this.db as IDBPDatabase).put(storeName, value, key as never)
    } catch (e) {
      console.error(
        `[store] IDB put 失败 store=${storeName} ${context}：${e instanceof Error ? e.message : String(e)}`,
        'value=', value,
      )
      // 降级：JSON 清洗（丢弃 undefined/函数；循环引用会再抛并保留原始错误）
      try {
        const cleaned = JSON.parse(JSON.stringify(value))
        console.warn(`[store] 已用 JSON 清洗写入 store=${storeName} ${context}`)
        await (this.db as IDBPDatabase).put(storeName, cleaned, key as never)
      } catch (e2) {
        console.error(`[store] JSON 清洗失败（疑似循环引用）store=${storeName} ${context}：`, e2)
        throw e
      }
    }
  }

  static async open(): Promise<LocalStore> {
    const db = await openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv')
        if (!d.objectStoreNames.contains('conversations')) {
          const s = d.createObjectStore('conversations', { keyPath: 'id' })
          s.createIndex('byUpdatedAt', 'updatedAt')
        }
        if (!d.objectStoreNames.contains('messages')) {
          const s = d.createObjectStore('messages', { keyPath: 'id' })
          s.createIndex('byConv', ['conversationId', 'createdAt'])
        }
        if (!d.objectStoreNames.contains('profiles')) {
          const s = d.createObjectStore('profiles', { keyPath: 'userId' })
          s.createIndex('byUpdatedAt', 'updatedAt')
        }
        if (!d.objectStoreNames.contains('friends')) d.createObjectStore('friends', { keyPath: 'userId' })
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'message.id' })
        if (!d.objectStoreNames.contains('cursors')) d.createObjectStore('cursors')
      },
    })
    return new LocalStore(db)
  }

  /* ---------------- kv ---------------- */

  async kvGet<T>(key: string): Promise<T | undefined> {
    return (await this.db.get('kv', key)) as T | undefined
  }

  async kvSet(key: string, value: unknown): Promise<void> {
    await this.putSafe('kv', value, key, `key=${key}`)
  }

  async kvDel(key: string): Promise<void> {
    await this.db.delete('kv', key)
  }

  /* ---------------- 会话 ---------------- */

  async convPut(c: Conversation): Promise<void> {
    await this.putSafe('conversations', c, undefined, `id=${c.id}`)
  }

  async convGet(id: string): Promise<Conversation | undefined> {
    return this.db.get('conversations', id)
  }

  async convs(): Promise<Conversation[]> {
    const all = await this.db.getAllFromIndex('conversations', 'byUpdatedAt')
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** 会话发生变化：更新预览/时间，可选增加未读 */
  async convTouch(id: string, preview: string, at: number, unreadDelta = 0): Promise<void> {
    const c = (await this.convGet(id)) ?? {
      id,
      kind: 'direct' as const,
      peerId: '',
      lastMessageAt: at,
      lastMessagePreview: preview,
      unreadCount: 0,
      updatedAt: at,
    }
    c.lastMessagePreview = preview
    c.lastMessageAt = at
    c.updatedAt = at
    if (unreadDelta > 0) c.unreadCount += unreadDelta
    await this.convPut(c)
  }

  /** 打开好友会话时若尚无记录则建一条空会话 */
  async convEnsure(id: string, peerId: string): Promise<Conversation> {
    const existing = await this.convGet(id)
    if (existing) {
      if (!existing.peerId) {
        existing.peerId = peerId
        await this.convPut(existing)
      }
      return existing
    }
    const now = Date.now()
    const c: Conversation = {
      id,
      kind: 'direct',
      peerId,
      lastMessageAt: now,
      lastMessagePreview: '',
      unreadCount: 0,
      updatedAt: now,
    }
    await this.convPut(c)
    return c
  }

  async convDel(id: string): Promise<void> {
    await this.db.delete('conversations', id)
  }

  async convSetUnread(id: string, count: number): Promise<void> {
    const c = await this.convGet(id)
    if (!c) return
    c.unreadCount = count
    await this.convPut(c)
  }

  /* ---------------- 消息 ---------------- */

  async msgPut(m: Message): Promise<void> {
    await this.putSafe('messages', m, undefined, `id=${m.id} conv=${m.conversationId}`)
  }

  async msgGet(id: string): Promise<Message | undefined> {
    return this.db.get('messages', id)
  }

  /** 会话内按时间倒序分页 */
  async msgsIn(conversationId: string, before = Number.MAX_SAFE_INTEGER, limit = 50): Promise<Message[]> {
    const all = await this.db.getAll('messages')
    return all
      .filter((m) => m.conversationId === conversationId && m.createdAt < before && !m.hiddenForMe)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-limit)
  }

  async msgDel(id: string): Promise<void> {
    await this.db.delete('messages', id)
  }

  async msgSetStatus(id: string, status: Message['status']): Promise<void> {
    const m = await this.msgGet(id)
    if (!m) return
    m.status = status
    await this.msgPut(m)
  }

  /** 遍历全部消息（附件缓存状态回填等场景） */
  async allMessages(): Promise<Message[]> {
    return this.db.getAll('messages')
  }

  /** 按附件内容哈希查找消息 */
  async messagesByAttachmentSha(sha256: string): Promise<Message[]> {
    const all = await this.db.getAll('messages')
    return all.filter((m) => m.attachment?.sha256 === sha256)
  }

  /* ---------------- 资料 ---------------- */

  async profPut(p: Profile): Promise<void> {
    await this.putSafe('profiles', p, undefined, `userId=${p.userId}`)
  }

  async profGet(userId: string): Promise<Profile | undefined> {
    return this.db.get('profiles', userId)
  }

  async profDel(userId: string): Promise<void> {
    await this.db.delete('profiles', userId)
  }

  async profsAll(): Promise<Profile[]> {
    return this.db.getAll('profiles')
  }

  async profsSince(t: number): Promise<Profile[]> {
    const all = await this.db.getAllFromIndex('profiles', 'byUpdatedAt')
    return all.filter((p) => p.updatedAt > t)
  }

  /* ---------------- 好友 ---------------- */

  async friendPut(f: FriendRecord): Promise<void> {
    await this.putSafe('friends', f, undefined, `userId=${f.userId}`)
  }

  async friendGet(userId: string): Promise<FriendRecord | undefined> {
    return this.db.get('friends', userId)
  }

  async friendsList(): Promise<FriendRecord[]> {
    return (await this.db.getAll('friends')).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async friendDel(userId: string): Promise<void> {
    await this.db.delete('friends', userId)
  }

  /** 删掉某个对端的好友记录、资料、会话、消息和待发送队列（不含自己） */
  async purgePeer(me: string, peerId: string): Promise<void> {
    if (!peerId || peerId === me) return
    await this.friendDel(peerId)
    await this.profDel(peerId)
    const convId = directConversationId(me, peerId)
    await this.convDel(convId)
    for (const m of await this.allMessages()) {
      if (m.conversationId === convId || m.senderId === peerId) await this.msgDel(m.id)
    }
    for (const e of await this.outboxList()) {
      if (e.message.conversationId === convId || e.message.senderId === peerId) {
        await this.outboxRemove(e.message.id)
      }
    }
  }

  /* ---------------- 待同步队列 ---------------- */

  async outboxAdd(m: Message): Promise<void> {
    const existing = await this.db.get('outbox', m.id)
    if (existing) return
    await this.putSafe('outbox', { message: m, attempt: 0, addedAt: Date.now() }, undefined, `id=${m.id}`)
  }

  async outboxList(): Promise<OutboxEntry[]> {
    return (await this.db.getAll('outbox')).sort((a, b) => a.addedAt - b.addedAt)
  }

  async outboxRemove(id: string): Promise<void> {
    await this.db.delete('outbox', id)
  }

  async outboxBump(id: string): Promise<void> {
    const e = await this.db.get('outbox', id)
    if (!e) return
    e.attempt += 1
    await this.putSafe('outbox', e, undefined, `id=${id}`)
  }

  /* ---------------- 同步游标 ---------------- */

  async cursorGet(key: string): Promise<number> {
    return (await this.db.get('cursors', key)) ?? 0
  }

  async cursorSet(key: string, value: number): Promise<void> {
    await this.putSafe('cursors', value, key, `key=${key}`)
  }

  async close(): Promise<void> {
    this.db.close()
  }
}
