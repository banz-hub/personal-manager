/**
 * アプリアイコンの PNG を生成する。
 *
 * iOS はホーム画面アイコンに PNG しか使わないため、SVG だけでは
 * 「ホーム画面に追加」したときにアイコンが出ない。ここで実体を用意する。
 *
 *   node scripts/generate-icons.mjs
 *
 * 依存ライブラリなし。図形をピクセルに描いて zlib で PNG に固める。
 * 形を変えたいときは drawIcon() の座標だけ触ればよい。
 *
 * 図柄は「一日の柱」。朝から夜へ積んだ時間の区画で、
 * 色が付いている 1 つが「いちばん長く取る時間」。
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public')

/** 描画は 4 倍で行ってから縮小し、輪郭を滑らかにする */
const SUPERSAMPLE = 4

const BG = [13, 18, 16] // --bg
/**
 * 色の付かない区画。アプリの --line (#26332c) より明るくしてある。
 * そのままだと 60px のホーム画面では背景と見分けがつかず、
 * 緑の棒が 1 本浮いているだけのアイコンになるため。
 */
const DIM = [71, 89, 79]
const ACCENT = [62, 207, 174] // --accent

// ---------- 図形を塗るための最小限のキャンバス ----------

function createCanvas(size) {
  return { size, data: new Uint8Array(size * size * 3) }
}

function fillAll(canvas, [r, g, b]) {
  for (let i = 0; i < canvas.data.length; i += 3) {
    canvas.data[i] = r
    canvas.data[i + 1] = g
    canvas.data[i + 2] = b
  }
}

/** 角丸長方形。座標は 512 基準で渡し、内部で拡大する */
function fillRoundRect(canvas, x, y, w, h, radius, [r, g, b], scale) {
  const x0 = Math.round(x * scale)
  const y0 = Math.round(y * scale)
  const x1 = Math.round((x + w) * scale)
  const y1 = Math.round((y + h) * scale)
  const rad = radius * scale

  for (let py = Math.max(0, y0); py < Math.min(canvas.size, y1); py++) {
    for (let px = Math.max(0, x0); px < Math.min(canvas.size, x1); px++) {
      // 角の内側かどうかを判定する
      const dx = Math.max(x0 + rad - px, 0, px - (x1 - rad - 1))
      const dy = Math.max(y0 + rad - py, 0, py - (y1 - rad - 1))
      if (dx > 0 && dy > 0 && dx * dx + dy * dy > rad * rad) continue
      const idx = (py * canvas.size + px) * 3
      canvas.data[idx] = r
      canvas.data[idx + 1] = g
      canvas.data[idx + 2] = b
    }
  }
}

/** 4倍で描いた絵を目的のサイズへ平均縮小する */
function downsample(canvas, targetSize) {
  const out = createCanvas(targetSize)
  const factor = canvas.size / targetSize
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      let r = 0
      let g = 0
      let b = 0
      let count = 0
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const px = Math.floor(x * factor + sx)
          const py = Math.floor(y * factor + sy)
          const idx = (py * canvas.size + px) * 3
          r += canvas.data[idx]
          g += canvas.data[idx + 1]
          b += canvas.data[idx + 2]
          count++
        }
      }
      const idx = (y * targetSize + x) * 3
      out.data[idx] = Math.round(r / count)
      out.data[idx + 1] = Math.round(g / count)
      out.data[idx + 2] = Math.round(b / count)
    }
  }
  return out
}

// ---------- アイコンの形 (512 基準で設計) ----------

/**
 * 縦 1 本の柱を 4 つの区画に割る。上が朝、下が夜。
 * 絵は中央 60% (102〜410) に収めてある。Android は丸や角丸で切り抜くので、
 * ここを越えると端が欠ける。
 */
const COLUMN_X = 180
const COLUMN_W = 152

function drawIcon(canvas, scale) {
  fillAll(canvas, BG)

  const seg = (y, h, radius, color) =>
    fillRoundRect(canvas, COLUMN_X, y, COLUMN_W, h, radius, color, scale)

  seg(125, 62, 26, DIM) // 朝
  seg(199, 100, 30, ACCENT) // いちばん長く取る時間
  seg(311, 44, 20, DIM)
  seg(367, 20, 10, DIM) // 夜
}

// ---------- PNG エンコード ----------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([len, typeAndData, crc])
}

function encodePng(canvas) {
  const { size, data } = canvas
  // 各行の先頭にフィルタ種別 (0 = なし) を置く
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1)
    raw[rowStart] = 0
    Buffer.from(data.buffer, y * size * 3, size * 3).copy(raw, rowStart + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- SVG ----------

/** ブラウザのタブ用。PNG と同じ形を書き出す */
function buildSvg() {
  const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`
  const rect = (y, h, radius, color) =>
    `<rect x="${COLUMN_X}" y="${y}" width="${COLUMN_W}" height="${h}" rx="${radius}" fill="${rgb(color)}"/>`
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img">',
    '<title>エージェント</title>',
    `<rect width="512" height="512" rx="115" fill="${rgb(BG)}"/>`,
    rect(125, 62, 26, DIM),
    rect(199, 100, 30, ACCENT),
    rect(311, 44, 20, DIM),
    rect(367, 20, 10, DIM),
    '</svg>',
  ].join('')
}

// ---------- 実行 ----------

const SIZES = [
  ['pwa-192.png', 192],
  ['pwa-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
]

mkdirSync(OUT_DIR, { recursive: true })

const big = createCanvas(512 * SUPERSAMPLE)
drawIcon(big, SUPERSAMPLE)

for (const [name, size] of SIZES) {
  const png = encodePng(downsample(big, size))
  writeFileSync(join(OUT_DIR, name), png)
  console.log(`${name} (${size}x${size}) ${(png.length / 1024).toFixed(1)}kB`)
}

writeFileSync(join(OUT_DIR, 'app-icon.svg'), buildSvg(), 'utf8')
console.log('app-icon.svg')
