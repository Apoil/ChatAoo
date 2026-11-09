/**
 * ChatAoo 核心数据模型 —— 所有端（服务器 / 桌面 / 移动）共用。
 */

/** 客户端本地生成的身份（ED25519 密钥对 + 派生用户 ID） */
export interface Identity {
  /** 设备 ID：由本设备公钥哈希派生，全局唯一，如 u_1a2b... */
  userId: string
  /**
   * 账号 ID：服务器上的账号身份。
   * 单设备时等于 userId；同一账号登录多台设备时，各设备沿用账号 ID 作为数据身份，
   * 而 userId 保持设备自身（用于局域网信标验签）。
   */
  accountUserId?: string
  /** ED25519 公钥（hex） */
  publicKey: string
  /** ED25519 私钥（hex），仅存本地，不离开设备 */
  privateKey: string
  displayName: string
  createdAt: number
}

/** 账号下的一台设备（用于局域网把"设备"映射回"账号"） */
export interface DeviceInfo {
  /** 设备 ID = 该设备公钥哈希 */
  deviceId: string
  /** 设备公钥（hex） */
  publicKey: string
  displayName?: string
  createdAt?: number
}

/** 好友关系状态 */
export type FriendStatus = 'none' | 'outgoing' | 'incoming' | 'friends'

/** 用户公开资料 */
export interface Profile {
  userId: string
  displayName: string
  /** 服务器存储的相对路径（/files/avatar/xxx），离线时映射到本地缓存 */
  avatarUrl?: string
  /** 头像内容 SHA-256，用于本地缓存校验与去重 */
  avatarHash?: string
  statusText?: string
  /** 该账号下的设备列表（用于局域网发现时把设备 ID 映射到账号） */
  devices?: DeviceInfo[]
  updatedAt: number
}

/** 附件类型 */
export type AttachmentKind = 'image' | 'video' | 'file' | 'audio'

/** 附件（图片 / 视频 / 普通文件） */
export interface Attachment {
  id: string
  kind: AttachmentKind
  /** 原始文件名 */
  name: string
  mimeType: string
  size: number
  /** 内容 SHA-256（去重 + 完整性校验 + 缓存键） */
  sha256: string
  /** 服务器地址（相对路径，如 /files/m/xxx）；离线时为空 */
  url?: string
  /** 本地缓存文件路径 */
  localPath?: string
  /** 是否已完整缓存到本地 */
  cached?: boolean
  width?: number
  height?: number
  /** 视频时长（秒） */
  duration?: number
  /** 缩略图 URL / 本地路径 */
  thumbUrl?: string
  /** 发送中进度 0-100，完成后删除 */
  uploadProgress?: number
  /** 发送阶段（仅本地，不上报） */
  uploadPhase?: 'preparing' | 'uploading' | 'sending'
  createdAt: number
}

export type MessageKind = 'text' | 'attachment' | 'system'

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'failed'

/** 一条聊天消息 */
export interface Message {
  /** 客户端生成的全局唯一 ID */
  id: string
  conversationId: string
  senderId: string
  kind: MessageKind
  text?: string
  attachment?: Attachment
  createdAt: number
  status: MessageStatus
  replyTo?: string
  /** 服务器分配的单调递增序号（同步游标） */
  seq?: number
  deliveredAt?: number
  /** 本机删除，不再展示 */
  hiddenForMe?: boolean
  /** 双方撤回 */
  revoked?: boolean
}

export type ConversationKind = 'direct'

/** 会话（当前版本仅支持点对点私聊） */
export interface Conversation {
  id: string
  kind: ConversationKind
  /** 对方用户 ID */
  peerId: string
  lastMessageAt: number
  lastMessagePreview?: string
  unreadCount: number
  pinned?: boolean
  updatedAt: number
}

/** 会话中加载的消息窗口 */
export interface MessageWindow {
  conversationId: string
  messages: Message[]
  /** 是否还有更早的消息 */
  hasMore: boolean
}
