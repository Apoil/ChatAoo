/**
 * Web 端实现：浏览器/桌面开发时不支持原生 socket，给出明确报错。
 * 真机（Android）上由原生 Kotlin 实现接管。
 */
import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

export interface LanSocketPlugin {
  start(): Promise<void>
  stop(): Promise<void>
  sendBeacon(packet: string): Promise<void>
  connect(host: string): Promise<{ connId: string }>
  send(connId: string, line: string): Promise<void>
  closeConn(connId: string): Promise<void>
  addListener(eventName: 'beacon', listener: (data: { packet: string; host: string }) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'conn', listener: (data: { connId: string }) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'data', listener: (data: { connId: string; line: string }) => void): Promise<PluginListenerHandle>
  addListener(eventName: 'closed', listener: (data: { connId: string }) => void): Promise<PluginListenerHandle>
}

const webImpl: LanSocketPlugin = {
  async start() {
    throw new Error('LAN socket 仅支持 Android 真机运行（UDP 组播/TCP 需原生实现）')
  },
  async stop() {},
  async sendBeacon() {},
  async connect() {
    throw new Error('LAN socket 仅支持 Android 真机运行')
  },
  async send() {},
  async closeConn() {},
  addListener() {
    throw new Error('LAN socket 仅支持 Android 真机运行')
  },
}

export const LanSocket = registerPlugin<LanSocketPlugin>('LanSocket', {
  web: () => webImpl,
})
