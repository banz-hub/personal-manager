/**
 * zip の中から .ics を取り出す。
 *
 * Google カレンダーの書き出しは .ics 単体ではなく **zip で届く。**
 * iPhone で開いて解凍してから渡す手間をなくすため、そのまま読めるようにした。
 * ライブラリは足さない。読むのは「中身の一覧を見て 1 件ずつ解凍する」だけで、
 * 解凍はブラウザの `DecompressionStream` に任せられる。
 */

const END_OF_DIRECTORY = 0x06054b50
const DIRECTORY_ENTRY = 0x02014b50

const METHOD_STORED = 0
const METHOD_DEFLATE = 8

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

/** 中の .ics を全部テキストにして返す。ほかのファイルは見ない */
export async function readIcsFromZip(bytes: Uint8Array): Promise<Array<{ name: string; text: string }>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // 一覧の場所は末尾に書いてある。後ろにコメントが付くことがあるので、後ろから探す
  let end = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === END_OF_DIRECTORY) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('zip ファイルを読めませんでした')

  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const out: Array<{ name: string; text: string }> = []
  const decoder = new TextDecoder()

  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== DIRECTORY_ENTRY) throw new Error('zip ファイルを読めませんでした')
    const method = view.getUint16(at + 10, true)
    const packedSize = view.getUint32(at + 20, true)
    const nameLen = view.getUint16(at + 28, true)
    const extraLen = view.getUint16(at + 30, true)
    const commentLen = view.getUint16(at + 32, true)
    const local = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen))
    at += 46 + nameLen + extraLen + commentLen

    if (!name.toLowerCase().endsWith('.ics')) continue

    // 本体の位置は、各ファイルの見出しの長さを見ないと分からない
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const packed = bytes.subarray(start, start + packedSize)
    if (method === METHOD_STORED) out.push({ name, text: decoder.decode(packed) })
    else if (method === METHOD_DEFLATE) out.push({ name, text: decoder.decode(await inflate(packed)) })
    else throw new Error(`${name} は読めない圧縮形式です`)
  }
  return out
}
