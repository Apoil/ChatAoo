/**
 * ChatAoo 图标生成器 —— 零依赖纯 Node：
 * 程序化绘制 Logo（柿色圆角底 + 叠放对话气泡），
 * 输出 PNG / ICO（PNG 内嵌）/ Android 自适应图标。
 * 用法：node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'assets', 'icons')

/* ---------------- PNG 编码 ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** rgba: Uint8Array 长度 w*h*4 */
function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // 每行加 filter 字节 0
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.subarray(y * w * 4, (y + 1) * w * 4).forEach((v, i) => {
      raw[y * (w * 4 + 1) + 1 + i] = v
    })
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

/* ---------------- 绘制基元 ---------------- */

function makeCanvas(w, h) {
  return { w, h, data: new Uint8Array(w * h * 4) }
}

function blend(canvas, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= canvas.w || y >= canvas.h || a <= 0) return
  const i = (y * canvas.w + x) * 4
  const da = canvas.data[i + 3] / 255
  const na = a / 255 + da * (1 - a / 255)
  if (na <= 0) return
  canvas.data[i] = Math.round((r * (a / 255) + canvas.data[i] * da * (1 - a / 255)) / na)
  canvas.data[i + 1] = Math.round((g * (a / 255) + canvas.data[i + 1] * da * (1 - a / 255)) / na)
  canvas.data[i + 2] = Math.round((b * (a / 255) + canvas.data[i + 2] * da * (1 - a / 255)) / na)
  canvas.data[i + 3] = Math.round(na * 255)
}

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t)
}

/** 圆角矩形（渐变填充 + 可选描边） */
function roundedRect(canvas, x0, y0, x1, y1, r, { fill = null, stroke = null, strokeW = 0, opacity = 1 } = {}) {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const hw = (x1 - x0) / 2
  const hh = (y1 - y0) / 2
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      const dx = Math.max(Math.abs(x - cx) - (hw - r), 0)
      const dy = Math.max(Math.abs(y - cy) - (hh - r), 0)
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist <= r) {
        if (stroke && dist > r - strokeW) {
          const [sr, sg, sb] = hex(stroke)
          blend(canvas, x, y, sr, sg, sb, 255 * opacity)
        } else if (fill) {
          if (Array.isArray(fill)) {
            const t = Math.max(0, Math.min(1, (y - y0) / Math.max(1, y1 - y0)))
            const [r1, g1, b1] = hex(fill[0])
            const [r2, g2, b2] = hex(fill[1])
            const [r3, g3, b3] = hex(fill[2] ?? fill[1])
            const tt = t < 0.5 ? t * 2 : (t - 0.5) * 2
            const base = t < 0.5 ? [r1, g1, b1] : [r2, g2, b2]
            const next = t < 0.5 ? [r2, g2, b2] : [r3, g3, b3]
            blend(canvas, x, y, lerp(base[0], next[0], tt), lerp(base[1], next[1], tt), lerp(base[2], next[2], tt), 255 * opacity)
          } else {
            const [fr, fg, fb] = hex(fill)
            blend(canvas, x, y, fr, fg, fb, 255 * opacity)
          }
        }
      }
    }
  }
}

function fillCircle(canvas, cx, cy, r, color, opacity = 1) {
  const [cr, cg, cb] = hex(color)
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        blend(canvas, x, y, cr, cg, cb, 255 * opacity)
      }
    }
  }
}

function pointInPoly(x, y, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0]
    const yi = pts[i][1]
    const xj = pts[j][0]
    const yj = pts[j][1]
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0001) + xi
    if (hit) inside = !inside
  }
  return inside
}

function fillPoly(canvas, pts, color, opacity = 1) {
  const [cr, cg, cb] = hex(color)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.floor(Math.min(...xs))
  const maxX = Math.ceil(Math.max(...xs))
  const minY = Math.floor(Math.min(...ys))
  const maxY = Math.ceil(Math.max(...ys))
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (pointInPoly(x + 0.5, y + 0.5, pts)) blend(canvas, x, y, cr, cg, cb, 255 * opacity)
    }
  }
}

/** 圆弧描边（点对点弧线） */
function arcStroke(canvas, cx, cy, radius, a0, a1, width, color, opacity = 1) {
  const [ar, ag, ab] = hex(color)
  const steps = Math.max(64, Math.ceil(Math.abs(a1 - a0) * radius / 2))
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    const px = cx + Math.cos(a) * radius
    const py = cy + Math.sin(a) * radius
    for (let dy = -width / 2; dy <= width / 2; dy++) {
      for (let dx = -width / 2; dx <= width / 2; dx++) {
        if (dx * dx + dy * dy <= (width / 2) ** 2) {
          blend(canvas, Math.round(px + dx), Math.round(py + dy), ar, ag, ab, 255 * opacity)
        }
      }
    }
  }
}

/* ---------------- Logo 绘制（512 坐标系） ---------------- */

const BG = '#c45c26'
const PAPER = '#faf7f2'
const BUBBLE = '#f0c9ae'

function drawLogo(canvas, scale = 1, ox = 0, oy = 0) {
  const s = (v) => v * scale
  const X = (v) => s(v) + ox
  const Y = (v) => s(v) + oy
  roundedRect(canvas, X(16), Y(16), X(496), Y(496), s(108), { fill: BG })
  roundedRect(canvas, X(188), Y(100), X(416), Y(268), s(36), { fill: BUBBLE })
  roundedRect(canvas, X(96), Y(196), X(344), Y(380), s(36), { fill: PAPER })
  fillPoly(
    canvas,
    [
      [X(96), Y(332)],
      [X(168), Y(380)],
      [X(78), Y(432)],
    ],
    PAPER,
  )
}

/* ---------------- 输出 ---------------- */

function render(size, { transparent = false, pad = 0 } = {}) {
  const canvas = makeCanvas(size, size)
  if (transparent) {
    // 缩放到安全区内并居中（自适应图标前景要求中心 66% 内可见）
    const scale = (size / 512) * (1 - pad * 2)
    const off = (size - 512 * scale) / 2
    drawLogo(canvas, scale, off, off)
  } else {
    drawLogo(canvas, size / 512)
  }
  return encodePng(size, size, canvas.data)
}

mkdirSync(OUT, { recursive: true })

// 常规图标
for (const size of [512, 256, 192, 144, 96, 72, 48, 32, 16]) {
  writeFileSync(join(OUT, `icon-${size}.png`), render(size))
  console.log(`icon-${size}.png`)
}

// ICO（内嵌 256 PNG）：ICONDIR(6) + ICONDIRENTRY(16) + PNG
const png256 = render(256)
const dirEntry = Buffer.alloc(16)
dirEntry[0] = 0 // width 256
dirEntry[1] = 0 // height 256
dirEntry[2] = 0 // color count
dirEntry[3] = 0 // reserved
dirEntry.writeUInt16LE(1, 4) // planes
dirEntry.writeUInt16LE(32, 6) // bpp
dirEntry.writeUInt32LE(png256.length, 8) // size
dirEntry.writeUInt32LE(22, 12) // offset = 6 + 16
const ico = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), dirEntry, png256])
writeFileSync(join(OUT, 'icon.ico'), ico)
console.log('icon.ico')

// Android 自适应图标（前景：Logo 缩进 66% 安全区并居中，背景纯色渐变）
writeFileSync(join(OUT, 'android-foreground.png'), render(432, { transparent: true, pad: 0.17 }))
const bgCanvas = makeCanvas(432, 432)
roundedRect(bgCanvas, 0, 0, 432, 432, 0, { fill: BG })
writeFileSync(join(OUT, 'android-background.png'), encodePng(432, 432, bgCanvas.data))
console.log('android-foreground/background.png')

// 输出到 android res（若目录存在）
const resBase = join(ROOT, 'packages', 'mobile', 'android', 'app', 'src', 'main', 'res')
const mipmaps = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
}
for (const [dir, size] of Object.entries(mipmaps)) {
  const d = join(resBase, dir)
  if (existsSync(d)) {
    writeFileSync(join(d, 'ic_launcher.png'), render(size))
    writeFileSync(join(d, 'ic_launcher_round.png'), render(size))
    console.log(`android ${dir}/ic_launcher.png`)
  }
}

console.log('done ->', OUT)
