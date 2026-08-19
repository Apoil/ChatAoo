import type { WebSocket } from 'ws'
import type { ServerToClient } from '@chataoo/shared'

/** 在线连接中枢：userId -> 该用户的所有 WebSocket */
export class Hub {
  private sockets = new Map<string, Set<WebSocket>>()

  add(userId: string, socket: WebSocket): void {
    let set = this.sockets.get(userId)
    if (!set) {
      set = new Set()
      this.sockets.set(userId, set)
    }
    set.add(socket)
    socket.on('close', () => this.remove(userId, socket))
    socket.on('error', () => this.remove(userId, socket))
  }

  remove(userId: string, socket: WebSocket): void {
    const set = this.sockets.get(userId)
    if (!set) return
    set.delete(socket)
    if (set.size === 0) this.sockets.delete(userId)
  }

  isOnline(userId: string): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0
  }

  onlineUsers(): string[] {
    return [...this.sockets.keys()]
  }

  sendTo(userId: string, msg: ServerToClient): void {
    const set = this.sockets.get(userId)
    if (!set) return
    const data = JSON.stringify(msg)
    for (const s of set) {
      if (s.readyState === s.OPEN) s.send(data)
    }
  }

  broadcastPresence(userId: string): void {
    const online = this.isOnline(userId)
    for (const other of this.sockets.keys()) {
      if (other !== userId) this.sendTo(other, { type: 'presence', userId, online })
    }
  }
}
