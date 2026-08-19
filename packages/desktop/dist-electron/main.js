/**
 * Electron 主进程：窗口、媒体缓存协议（chataoo-media://）、LAN、IPC。
 */
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LanMain } from './lan.js';
const MEDIA_SCHEME = 'chataoo-media';
const APP_SCHEME = 'app';
// 必须在 app ready 之前注册自定义协议
//  - app://：生产模式页面加载协议（secure context，crypto.subtle / randomUUID 可用，
//    避免 file:// 非安全上下文导致头像哈希等能力失效）
//  - chataoo-media://：本地媒体缓存
protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: MEDIA_SCHEME, privileges: { secure: true, supportFetchAPI: true, stream: true } },
]);
// 聊天类 UI 无需 GPU 合成加速；禁用可规避部分显卡驱动的渲染进程崩溃
app.disableHardwareAcceleration();
let mediaDir = '';
let lan = null;
let win = null;
/* 窗口尺寸：登录时小窗，登录后放大为聊天窗口 */
const LOGIN_W = 440;
const LOGIN_H = 640;
const LOGIN_MIN_W = 420;
const LOGIN_MIN_H = 560;
const CHAT_W = 1200;
const CHAT_H = 800;
const CHAT_MIN_W = 940;
const CHAT_MIN_H = 600;
/** 切换窗口尺寸（渲染进程在登录状态变化时调用） */
export function resizeWindow(mode) {
    if (!win)
        return;
    const w = mode === 'login' ? LOGIN_W : CHAT_W;
    const h = mode === 'login' ? LOGIN_H : CHAT_H;
    win.setMinimumSize(mode === 'login' ? LOGIN_MIN_W : CHAT_MIN_W, mode === 'login' ? LOGIN_MIN_H : CHAT_MIN_H);
    win.setSize(w, h);
    win.center();
}
function ensureMediaDir() {
    mediaDir = join(app.getPath('userData'), 'media');
    mkdirSync(mediaDir, { recursive: true });
    return mediaDir;
}
function createWindow() {
    // 图标：开发时在仓库根 assets/，打包后随应用分发
    const iconCandidates = [
        join(app.getAppPath(), '..', '..', 'assets', 'icons', 'icon.ico'),
        join(app.getAppPath(), 'assets', 'icons', 'icon.ico'),
    ];
    const iconPath = iconCandidates.find((p) => existsSync(p));
    win = new BrowserWindow({
        width: LOGIN_W,
        height: LOGIN_H,
        minWidth: LOGIN_MIN_W,
        minHeight: LOGIN_MIN_H,
        title: 'ChatAoo',
        backgroundColor: '#111417',
        icon: iconPath,
        autoHideMenuBar: true,
        // 无边框 + 系统标题栏按钮覆盖层（颜色与主题一致）
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#171b20',
            symbolColor: '#9aa4b1',
            height: 44,
        },
        webPreferences: {
            preload: join(app.getAppPath(), 'dist-electron', 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
        void win.loadURL(devUrl);
    }
    else {
        // 生产模式：通过安全的 app:// 协议加载（secure context）
        void win.loadURL(`${APP_SCHEME}://bundle/index.html`);
    }
    win.on('closed', () => {
        win = null;
    });
    // 崩溃/异常诊断与自动恢复
    win.webContents.on('render-process-gone', (_e, details) => {
        console.error('render-process-gone:', JSON.stringify(details));
        // 崩溃后自动重建窗口恢复
        setTimeout(() => {
            if (!win)
                createWindow();
        }, 800);
    });
    win.webContents.on('unresponsive', () => {
        console.error('renderer unresponsive');
    });
    win.webContents.on('console-message', (_e, level, message) => {
        if (level >= 2)
            console.error(`[renderer] ${message}`);
    });
}
/* ---------------- 媒体缓存 ---------------- */
ipcMain.handle('media:has', (_e, sha) => existsSync(join(ensureMediaDir(), sha)));
ipcMain.handle('media:write', (_e, sha, buf) => {
    writeFileSync(join(ensureMediaDir(), sha), Buffer.from(buf));
});
ipcMain.handle('media:read', (_e, sha) => {
    const p = join(ensureMediaDir(), sha);
    return existsSync(p) ? readFileSync(p).buffer : null;
});
ipcMain.handle('media:cache', async (_e, url, sha) => {
    try {
        const res = await net.fetch(url);
        if (!res.ok)
            return false;
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(join(ensureMediaDir(), sha), buf);
        return true;
    }
    catch {
        return false;
    }
});
/* ---------------- LAN ---------------- */
ipcMain.handle('lan:start', async (e) => {
    lan = new LanMain(e.sender);
    await lan.start();
});
ipcMain.handle('lan:stop', () => {
    lan?.stop();
    lan = null;
});
ipcMain.handle('lan:sendBeacon', (_e, packet) => lan?.sendBeacon(packet));
ipcMain.handle('lan:connect', (_e, host) => lan?.connect(host));
ipcMain.handle('lan:send', (_e, connId, line) => lan?.send(connId, line));
ipcMain.handle('lan:closeConn', (_e, connId) => lan?.closeConn(connId));
/* ---------------- 系统能力 ---------------- */
ipcMain.handle('app:openExternal', (_e, url) => shell.openExternal(url));
ipcMain.handle('app:saveFile', async (_e, name, url) => {
    const result = await dialog.showSaveDialog(win ?? undefined, { defaultPath: name });
    if (result.canceled || !result.filePath)
        return;
    const res = await net.fetch(url);
    if (!res.ok)
        throw new Error(`download failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(result.filePath, buf);
    void shell.openPath(result.filePath);
});
ipcMain.handle('win:resize', (_e, mode) => resizeWindow(mode));
/* ---------------- 启动 ---------------- */
void app.whenReady().then(() => {
    // 生产模式：app://bundle/ 映射到 dist 目录
    const distDir = join(app.getAppPath(), 'dist');
    protocol.handle(APP_SCHEME, (req) => {
        const url = new URL(req.url);
        let path = url.pathname === '/' ? '/index.html' : url.pathname;
        if (!path.startsWith('/'))
            path = '/' + path;
        return net.fetch(pathToFileURL(join(distDir, path)).toString());
    });
    protocol.handle(MEDIA_SCHEME, (req) => {
        const hash = req.url.replace(`${MEDIA_SCHEME}://`, '').split('?')[0] ?? '';
        return net.fetch(pathToFileURL(join(ensureMediaDir(), hash)).toString());
    });
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
app.on('window-all-closed', () => {
    lan?.stop();
    if (process.platform !== 'darwin')
        app.quit();
});
//# sourceMappingURL=main.js.map