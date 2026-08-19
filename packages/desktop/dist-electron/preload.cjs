/**
 * preload（CommonJS，sandbox 兼容）：以最小权限暴露 IPC 桥。
 * 注意：Electron sandbox preload 仅支持 CommonJS，不能用 TS/ESM 编译产物。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('chataoo', {
  platform: 'desktop',
  media: {
    has: (sha) => ipcRenderer.invoke('media:has', sha),
    write: (sha, buf) => ipcRenderer.invoke('media:write', sha, buf),
    read: (sha) => ipcRenderer.invoke('media:read', sha),
    cache: (url, sha) => ipcRenderer.invoke('media:cache', url, sha),
    url: (sha) => `chataoo-media://${sha}`,
  },
  lan: {
    start: () => ipcRenderer.invoke('lan:start'),
    stop: () => ipcRenderer.invoke('lan:stop'),
    sendBeacon: (packet) => ipcRenderer.invoke('lan:sendBeacon', packet),
    connect: (host) => ipcRenderer.invoke('lan:connect', host),
    send: (connId, line) => ipcRenderer.invoke('lan:send', connId, line),
    closeConn: (connId) => ipcRenderer.invoke('lan:closeConn', connId),
    onBeacon: (cb) => {
      const h = (_e, d) => cb(d.packet, d.host)
      ipcRenderer.on('lan:beacon', h)
      return () => ipcRenderer.removeListener('lan:beacon', h)
    },
    onConn: (cb) => {
      const h = (_e, d) => cb(d.connId)
      ipcRenderer.on('lan:conn', h)
      return () => ipcRenderer.removeListener('lan:conn', h)
    },
    onData: (cb) => {
      const h = (_e, d) => cb(d.connId, d.line)
      ipcRenderer.on('lan:data', h)
      return () => ipcRenderer.removeListener('lan:data', h)
    },
    onClosed: (cb) => {
      const h = (_e, d) => cb(d.connId)
      ipcRenderer.on('lan:closed', h)
      return () => ipcRenderer.removeListener('lan:closed', h)
    },
  },
  app: {
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    saveFile: (name, url) => ipcRenderer.invoke('app:saveFile', name, url),
  },
  win: {
    resize: (mode) => ipcRenderer.invoke('win:resize', mode),
  },
})
