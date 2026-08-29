/**
 * 线上（服务器）与线下（局域网 P2P）两套线协议定义。
 * 所有载荷均为 JSON；局域网 TCP 使用 "JSON 行" 帧（每行一条消息）。
 */
import type { Attachment, FriendStatus, Message } from './types.js'

/* ------------------------------------------------------------------ */
/* 服务器 REST + WebSocket 协议                                         */
/* ------------------------------------------------------------------ */

/** 注册 / 登录响应 */
export interface AuthResponse {
  token: string
  user: ServerUser
}

export interface ServerUser {
  userId: string
  /** 登录用户名（唯一，好友添加用） */
  username?: string
  displayName: string
  avatarUrl?: string
  avatarHash?: string
  /** 该用户已收到的最新消息序号（注册时初始化） */
  serverSeq: number
  createdAt: number
}

/** 用户名查询结果（加好友前解析） */
export interface ResolvedUser {
  userId: string
  username: string
  displayName: string
  avatarUrl?: string
  avatarHash?: string
  statusText?: string
}

/** 服务器上的消息（带 seq） */
export interface ServerMessage {
  id: string
  conversationId: string
  senderId: string
  kind: Message['kind']
  text?: string
  attachment?: Attachment
  createdAt: number
  seq: number
  revoked?: boolean
}

/** 服务器资料快照 */
export interface ServerProfile {
  userId: string
  displayName: string
  avatarUrl?: string
  avatarHash?: string
  statusText?: string
  updatedAt: number
}

/** 好友条目 */
export interface ServerFriend {
  userId: string
  username?: string
  displayName: string
  avatarUrl?: string
  avatarHash?: string
  statusText?: string
  /** 对方是否已确认（双向） */
  confirmed: boolean
  /** 相对当前用户：friends / outgoing / incoming */
  status?: FriendStatus
  updatedAt: number
}

/** 增量同步结果 */
export interface SyncResult {
  messages: ServerMessage[]
  profiles: ServerProfile[]
  friends: ServerFriend[]
  /** 客户端下次拉取的游标 */
  nextSeq: number
  serverTime: number
}

/** WS: 客户端 -> 服务器 */
export type ClientToServer =
  | { type: 'auth'; token: string }
  | { type: 'ping'; t: number }

/** WS: 服务器 -> 客户端 */
export type ServerToClient =
  | { type: 'hello'; serverTime: number; serverSeq: number }
  | { type: 'auth-ok' }
  | { type: 'auth-fail'; reason: string }
  | { type: 'pong'; t: number }
  | { type: 'message'; message: ServerMessage }
  | { type: 'message-acked'; id: string; seq: number }
  | { type: 'profile'; profile: ServerProfile }
  | { type: 'friend'; friend: ServerFriend }
  | { type: 'presence'; userId: string; online: boolean }
  | { type: 'sync'; result: SyncResult }
  | { type: 'message-deleted'; id: string; conversationId: string }

/* ------------------------------------------------------------------ */
/* 局域网 P2P 协议                                                      */
/* ------------------------------------------------------------------ */

/** UDP 组播信标（LAN 发现） */
export interface BeaconPacket {
  /** 协议版本 */
  v: 1
  userId: string
  /** 公钥（hex），用于验证签名与派生 userId */
  publicKey: string
  displayName: string
  /** 随机 nonce 防重放 */
  nonce: string
  /** 发送时间戳（ms） */
  ts: number
  /** ED25519 签名：sign(privateKey, `${userId}|${displayName}|${nonce}|${ts}`) */
  sig: string
}

/** P2P 连接欢迎包 */
export interface P2PHello {
  type: 'hello'
  userId: string
  displayName: string
  /** 对信标 payload 的签名（可选，用于二次验证） */
  sig?: string
}

/** P2P：客户端 -> 服务端（发起方） */
export type P2PClientMsg =
  | P2PHello
  | { type: 'message'; message: Message }
  | { type: 'ack'; messageId: string; ok: boolean; error?: string }
  | { type: 'typing'; on: boolean }
  | { type: 'file-meta'; transferId: string; attachment: Attachment }
  | { type: 'file-data'; transferId: string; offset: number; data: string }
  | { type: 'file-done'; transferId: string; sha256: string }
  | { type: 'file-cancel'; transferId: string; reason?: string }
  | { type: 'message-delete'; messageId: string }
  | { type: 'bye' }

/** P2P：服务端（被连方） -> 客户端 */
export type P2PServerMsg =
  | { type: 'welcome'; userId: string; displayName: string }
  | { type: 'message'; message: Message }
  | { type: 'ack'; messageId: string; ok: boolean; error?: string }
  | { type: 'typing'; on: boolean }
  | { type: 'file-meta'; transferId: string; attachment: Attachment }
  | { type: 'file-data'; transferId: string; offset: number; data: string }
  | { type: 'file-done'; transferId: string; sha256: string }
  | { type: 'file-cancel'; transferId: string; reason?: string }
  | { type: 'message-delete'; messageId: string }
  | { type: 'bye' }

export type P2PMsg = P2PClientMsg | P2PServerMsg

/* ------------------------------------------------------------------ */
/* 常用辅助                                                            */
/* ------------------------------------------------------------------ */

export const PROTOCOL_VERSION = 1

/** 直接会话 ID：两个 userId 排序后拼接 */
export function directConversationId(a: string, b: string): string {
  return [a, b].sort().join('__')
}

export function previewOfMessage(text?: string, kind?: Message['kind'], revoked?: boolean): string {
  if (revoked) return '消息已撤回'
  if (text) return text.length > 60 ? text.slice(0, 60) + '…' : text
  switch (kind) {
    case 'attachment':
      return '[附件]'
    case 'system':
      return '[系统消息]'
    default:
      return '[消息]'
  }
}
