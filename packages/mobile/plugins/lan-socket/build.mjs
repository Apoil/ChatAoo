// 复制 src/plugin.js 到 dist 并生成 d.ts
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
mkdirSync(join(here, 'dist'), { recursive: true })
copyFileSync(join(here, 'src', 'plugin.js'), join(here, 'dist', 'plugin.js'))

const dts = `export interface PluginListenerHandle {
  remove: () => Promise<void>
}
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
export declare const LanSocket: LanSocketPlugin
`
writeFileSync(join(here, 'dist', 'plugin.d.ts'), dts)
console.log('lan-socket built')
