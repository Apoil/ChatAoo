/**
 * 主进程局域网传输：UDP 组播信标 + TCP JSON 行。
 * 数据经 IPC 与渲染进程双向转发（渲染进程无原生 socket 权限）。
 */
import dgram from 'node:dgram';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { LAN_MULTICAST_GROUP, LAN_MULTICAST_PORT, LAN_TCP_PORT } from '@chataoo/shared';
export class LanMain {
    wc;
    udp = null;
    tcp = null;
    conns = new Map();
    buffers = new Map();
    stopped = false;
    constructor(wc) {
        this.wc = wc;
    }
    async start() {
        if (this.udp)
            return;
        this.stopped = false;
        // UDP 组播
        this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        await new Promise((resolve, reject) => {
            const udp = this.udp;
            udp.once('error', reject);
            udp.on('message', (msg, rinfo) => {
                try {
                    const packet = JSON.parse(msg.toString());
                    this.wc.send('lan:beacon', { packet, host: rinfo.address });
                }
                catch {
                    /* 忽略非本协议报文 */
                }
            });
            udp.bind(LAN_MULTICAST_PORT, () => {
                try {
                    udp.addMembership(LAN_MULTICAST_GROUP);
                }
                catch (e) {
                    console.warn('multicast membership failed:', e);
                }
                udp.setBroadcast(true);
                udp.setMulticastTTL(2);
                resolve();
            });
        });
        // TCP 服务端（接收好友入站连接）
        this.tcp = net.createServer((socket) => this.accept(socket));
        await new Promise((resolve, reject) => {
            this.tcp.once('error', reject);
            this.tcp.listen(LAN_TCP_PORT, '0.0.0.0', () => resolve());
        });
    }
    stop() {
        this.stopped = true;
        for (const s of this.conns.values())
            s.destroy();
        this.conns.clear();
        this.buffers.clear();
        this.udp?.close();
        this.udp = null;
        this.tcp?.close();
        this.tcp = null;
    }
    sendBeacon(packet) {
        if (!this.udp)
            return;
        this.udp.send(JSON.stringify(packet), LAN_MULTICAST_PORT, LAN_MULTICAST_GROUP);
    }
    connect(host) {
        return new Promise((resolve, reject) => {
            if (this.stopped)
                return reject(new Error('lan stopped'));
            const socket = net.connect(LAN_TCP_PORT, host);
            socket.once('error', reject);
            socket.once('connect', () => {
                socket.removeListener('error', reject);
                const id = this.wire(socket);
                resolve(id);
            });
        });
    }
    send(connId, line) {
        const s = this.conns.get(connId);
        if (s && !s.destroyed)
            s.write(line + '\n');
    }
    closeConn(connId) {
        this.conns.get(connId)?.destroy();
    }
    accept(socket) {
        const id = this.wire(socket);
        this.wc.send('lan:conn', { connId: id });
    }
    wire(socket) {
        const id = randomUUID();
        this.conns.set(id, socket);
        this.buffers.set(id, '');
        socket.on('data', (chunk) => {
            const buf = (this.buffers.get(id) ?? '') + chunk.toString('utf8');
            const lines = buf.split('\n');
            this.buffers.set(id, lines.pop() ?? '');
            for (const line of lines) {
                if (line.trim())
                    this.wc.send('lan:data', { connId: id, line });
            }
        });
        socket.on('close', () => {
            this.conns.delete(id);
            this.buffers.delete(id);
            this.wc.send('lan:closed', { connId: id });
        });
        socket.on('error', () => {
            socket.destroy();
        });
        return id;
    }
}
//# sourceMappingURL=lan.js.map