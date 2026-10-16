/**
 * 予定を .ics（iCalendar）にする。Google カレンダーなどに読み込ませるため。
 *
 * **Google カレンダーの API は呼ばない。**このアプリはサーバーを持たない静的サイトなので、
 * API を呼ぶのに要る鍵を隠す場所がない（端末に置けば誰でも見られる）。
 * ファイルに書き出して、本人が読み込む形にすれば鍵が要らない。
 *
 * 出すのは**単発の予定と旅行。**旅行は時刻を持たないので、終日の予定として日をまたいで置く。
 * 授業は出さない。時間割から毎週組み立てているもので、
 * 向こうのカレンダーに毎週ぶん並べても持て余すため。
 *
 * 時刻は UTC（末尾 Z）で書く。読み込む側の時間帯の設定に左右されないようにするため。
 * `UID` は予定の id から作るので、**同じ予定を読み込み直しても増えない**（上書きされる）。
 */

import type { EventItem, Place, Trip } from '../types'
import { CATEGORY_LABELS } from '../types'
import { addDays, at } from './date'

const DOMAIN = 'banz-hub.github.io'

function utc(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}` +
    `T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`
  )
}

/** .ics の中で改行や記号が壊れないようにする */
export function esc(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * 1 行 75 バイトで折り返す（iCalendar の決まり）。
 * 日本語は 1 文字 3 バイトなので、文字数ではなくバイト数で数える。
 * 続きの行は先頭に空白を 1 つ置く。
 */
export function fold(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const out: string[] = []
  let current = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    // 続きの行は先頭の空白のぶん 1 バイト少なく使える
    const limit = out.length === 0 ? 75 : 74
    if (bytes + n > limit) {
      out.push(current)
      current = ''
      bytes = 0
    }
    current += ch
    bytes += n
  }
  if (current) out.push(current)
  return out.map((l, i) => (i === 0 ? l : ` ${l}`)).join('\r\n')
}

/** 終日の予定に書く日付。20261019 の形 */
function dateOnly(key: string): string {
  return key.replace(/-/g, '')
}

export interface IcsOptions {
  places?: Place[]
  /** 旅行。終日の予定として出す */
  trips?: Trip[]
  /** この日以降の予定だけ出す (YYYY-MM-DD)。省略するとすべて */
  from?: string
  /** 書き出した時刻。テストで固定するために渡せる */
  now?: Date
}

/** 予定の題名。題名が空のものは種類の名前にする（バイトなど） */
export function titleOf(e: EventItem): string {
  return e.title.trim() || CATEGORY_LABELS[e.category] || '予定'
}

/** 出す対象の予定。時刻の入っていないものは飛ばす（カレンダーに置けないため） */
export function eventsToExport(events: EventItem[], from?: string): EventItem[] {
  return events
    .filter((e) => typeof e.start === 'string' && typeof e.end === 'string' && e.start && e.end)
    .filter((e) => !from || e.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
}

/** 出す対象の旅行。終わる日が指定より前のものは出さない */
export function tripsToExport(trips: Trip[], from?: string): Trip[] {
  return trips
    .filter((t) => t.startDate && t.endDate)
    .filter((t) => !from || t.endDate >= from)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
}

export function buildIcs(events: EventItem[], options: IcsOptions = {}): string {
  const stamp = utc(options.now ?? new Date())
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//yoteicho//${DOMAIN}//JP`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  for (const e of eventsToExport(events, options.from)) {
    const place = options.places?.find((p) => p.id === e.placeId)
    const where = place ? `${place.name}（${place.station}）` : (e.station ?? '')
    const end = at(e.date, e.end)
    const start = at(e.date, e.start)
    // 日をまたぐ予定（22:00〜00:30）は、終わりを次の日にする
    if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1)

    lines.push(
      'BEGIN:VEVENT',
      `UID:yotei-${e.id}@${DOMAIN}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utc(start)}`,
      `DTEND:${utc(end)}`,
      `SUMMARY:${esc(titleOf(e))}`,
      `CATEGORIES:${esc(CATEGORY_LABELS[e.category] ?? 'その他')}`,
    )
    if (where) lines.push(`LOCATION:${esc(where)}`)
    if (e.memo) lines.push(`DESCRIPTION:${esc(e.memo)}`)
    lines.push('END:VEVENT')
  }

  for (const t of tripsToExport(options.trips ?? [], options.from)) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:yotei-trip-${t.id}@${DOMAIN}`,
      `DTSTAMP:${stamp}`,
      // 終日の予定は、終わりの日の「次の日」を書く決まり（その日を含まない）
      `DTSTART;VALUE=DATE:${dateOnly(t.startDate)}`,
      `DTEND;VALUE=DATE:${dateOnly(addDays(t.endDate, 1))}`,
      `SUMMARY:${esc(t.name)}`,
      'CATEGORIES:旅行',
      // 終日の旅行で予定表が「予定あり」で埋まらないようにする
      'TRANSP:TRANSPARENT',
    )
    if (t.memo) lines.push(`DESCRIPTION:${esc(t.memo)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function icsFilename(from?: string): string {
  return `yoteicho-${from ? `from-${from}` : 'all'}.ics`
}

/** 書き出したファイルを端末に保存する */
export function downloadIcs(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
