/** 全局常量 */

export const APP_NAME = 'ChatAoo'
export const APP_VERSION = '1.2.0'
/** 界面展示用，首个公开版本 */
export const APP_VERSION_LABEL = 'Bata 1.2.0'

/** 局域网 UDP 组播组（管理员本地管理的地址段 239.255.0.0/16，无需互联网） */
export const LAN_MULTICAST_GROUP = '239.255.42.77'
export const LAN_MULTICAST_PORT = 47777
/** 局域网 P2P TCP 默认监听端口 */
export const LAN_TCP_PORT = 47778
/** 信标广播间隔 */
export const LAN_BEACON_INTERVAL_MS = 4000
/** 对端信标过期时间 */
export const LAN_PEER_EXPIRE_MS = 15000
/** P2P 心跳间隔 */
export const LAN_HEARTBEAT_MS = 10000

/** 服务器 API 前缀 */
export const API_PREFIX = '/api/v1'

/** 文件分块大小（P2P 传输，64KB base64 上限附近） */
export const P2P_CHUNK_SIZE = 48 * 1024

/** 服务器文件路径前缀 */
export const FILE_PREFIX = {
  message: '/files/m',
  avatar: '/files/a',
} as const
