package com.chataoo.lansocket

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * ChatAoo 局域网原生插件：
 *  - UDP 组播信标（发现）+ 周期广播（Android 需要 MulticastLock）
 *  - TCP JSON 行服务端/客户端（好友 P2P 消息与文件传输）
 */
@CapacitorPlugin(name = "LanSocket")
class LanSocketPlugin : Plugin() {
  companion object {
    const val GROUP = "239.255.42.77"
    const val UDP_PORT = 47777
    const val TCP_PORT = 47778
    const val BEACON_INTERVAL_MS = 4000L
  }

  private val executor = Executors.newCachedThreadPool()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val conns = ConcurrentHashMap<String, Socket>()
  private var udpSocket: DatagramSocket? = null
  private var serverSocket: ServerSocket? = null
  private var multicastLock: WifiManager.MulticastLock? = null
  private var beaconPacket: String? = null
  private var beaconRunning = false

  override fun load() {
    super.load()
    val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    multicastLock = wifi.createMulticastLock("chataoo-lan").apply {
      setReferenceCounted(false)
    }
  }

  /* ---------------- 生命周期 ---------------- */

  @PluginMethod
  fun start(call: PluginCall) {
    multicastLock?.acquire()

    // UDP 组播监听
    executor.execute {
      try {
        val s = DatagramSocket(UDP_PORT).apply { reuseAddress = true }
        s.joinGroup(InetAddress.getByName(GROUP))
        udpSocket = s
        call.resolve()
        val buf = ByteArray(65536)
        while (!s.isClosed) {
          val p = DatagramPacket(buf, buf.size)
          try {
            s.receive(p)
          } catch (e: Exception) {
            break
          }
          val text = String(p.data, 0, p.length, Charsets.UTF_8)
          val packet = try {
            JSObject(text)
          } catch (e: Exception) {
            continue
          }
          notifyListeners(
            "beacon",
            JSObject().apply {
              put("packet", packet)
              put("host", p.address.hostAddress)
            },
            true,
          )
        }
      } catch (e: Exception) {
        if (call.hasOption("throwOnError")) call.reject("udp start failed: ${e.message}")
      }
    }

    // TCP 服务端（接收好友连接）
    executor.execute {
      try {
        val ss = ServerSocket(TCP_PORT)
        serverSocket = ss
        while (!ss.isClosed) {
          val sock = ss.accept()
          val id = UUID.randomUUID().toString()
          conns[id] = sock
          notifyListeners("conn", JSObject().apply { put("connId", id) }, true)
          executor.execute { readLoop(id, sock) }
        }
      } catch (e: Exception) {
        // 端口被占用等：静默，连接方会自动重试
      }
    }
  }

  @PluginMethod
  fun stop(call: PluginCall) {
    try {
      udpSocket?.close()
      udpSocket = null
      serverSocket?.close()
      serverSocket = null
      for (s in conns.values) {
        try {
          s.close()
        } catch (_: Exception) {
        }
      }
      conns.clear()
      multicastLock?.release()
    } catch (_: Exception) {
    }
    call.resolve()
  }

  /* ---------------- 信标 ---------------- */

  @PluginMethod
  fun sendBeacon(call: PluginCall) {
    val packet = call.getString("packet") ?: run {
      call.reject("packet required")
      return
    }
    beaconPacket = packet
    sendUdp(packet)
    if (!beaconRunning) {
      beaconRunning = true
      mainHandler.post(object : Runnable {
        override fun run() {
          val p = beaconPacket
          if (p != null) sendUdp(p)
          mainHandler.postDelayed(this, BEACON_INTERVAL_MS)
        }
      })
    }
    call.resolve()
  }

  private fun sendUdp(packet: String) {
    executor.execute {
      try {
        val s = udpSocket ?: return@execute
        val data = packet.toByteArray(Charsets.UTF_8)
        s.send(DatagramPacket(data, data.size, InetAddress.getByName(GROUP), UDP_PORT))
      } catch (_: Exception) {
      }
    }
  }

  /* ---------------- TCP 连接 ---------------- */

  @PluginMethod
  fun connect(call: PluginCall) {
    val host = call.getString("host") ?: run {
      call.reject("host required")
      return
    }
    executor.execute {
      try {
        val sock = Socket(host, TCP_PORT)
        val id = UUID.randomUUID().toString()
        conns[id] = sock
        executor.execute { readLoop(id, sock) }
        call.resolve(JSObject().apply { put("connId", id) })
      } catch (e: Exception) {
        call.reject("connect failed: ${e.message}")
      }
    }
  }

  @PluginMethod
  fun send(call: PluginCall) {
    val connId = call.getString("connId") ?: run {
      call.reject("connId required")
      return
    }
    val line = call.getString("line") ?: run {
      call.reject("line required")
      return
    }
    executor.execute {
      try {
        val s = conns[connId] ?: run {
          call.reject("no such conn")
          return@execute
        }
        val out: OutputStream = s.getOutputStream()
        out.write((line + "\n").toByteArray(Charsets.UTF_8))
        out.flush()
        call.resolve()
      } catch (e: Exception) {
        call.reject("send failed: ${e.message}")
      }
    }
  }

  @PluginMethod
  fun closeConn(call: PluginCall) {
    val connId = call.getString("connId")
    if (connId != null) {
      try {
        conns.remove(connId)?.close()
      } catch (_: Exception) {
      }
    }
    call.resolve()
  }

  /* ---------------- 内部 ---------------- */

  private fun readLoop(connId: String, sock: Socket) {
    try {
      val reader = BufferedReader(InputStreamReader(sock.getInputStream(), Charsets.UTF_8))
      while (!sock.isClosed) {
        val line = reader.readLine() ?: break
        notifyListeners("data", JSObject().apply { put("connId", connId); put("line", line) }, true)
      }
    } catch (_: Exception) {
    } finally {
      try {
        sock.close()
      } catch (_: Exception) {
      }
      conns.remove(connId)
      notifyListeners("closed", JSObject().apply { put("connId", connId) }, true)
    }
  }
}
