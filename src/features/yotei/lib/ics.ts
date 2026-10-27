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
 * **時刻は入力したとおりの時刻で書き、時間帯（TZID）を添える。**
 * はじめは UTC（末尾 Z）で書いていたが、読み込んだ先で「その土地の時刻」として扱われ、
 * 16:00 の予定が 7:00 になった（2026-10-16 に実際に起きた）。
 * 入力どおりの時刻で書いておけば、時間帯を見てくれる相手なら正しい時刻に、
 * 見てくれない相手でも**書いたとおりの時刻**になる。どちらに転んでも 9 時間ずれない。
 *
 * `UID` は予定の id から作るので、**同じ予定を読み込み直しても増えない**（上書きされる）。
 *
 * **通知について。**予定ごとに 1 週間前・3 日前・1 日前・30 分前の通知を入れてある。
 * 読み込んだ先でそのまま通知として入る（取り込まない相手もいる）。
 * 旅行は終日なので 30 分前は入れない（0 時 30 分前 = 前日の 23:30 に鳴っても仕方がない）。
 *
 * **色について。**予定ごとの色は `COLOR`（RFC 7986）で書いてあるが、
 * Google カレンダーの読み込みはこれを見ない（取り込んだ先のカレンダーの色になる）。
 * Google で色を分けたいときは `only` で**種類ごとに分けて書き出し**、
 * 向こうで種類ごとのカレンダーを作って、それぞれに読み込ませる。カレンダーの色は向こうで選べる。
 */

import type { EventCategory, EventItem, Place, Trip } from '../types'
import { CATEGORY_LABELS } from '../types'
import { addDays, at } from './date'

const DOMAIN = 'banz-hub.github.io'

/**
 * 種類ごとの色。読める相手（Apple カレンダーなど）だけが使う。
 * 名前は CSS の色名で書く決まり（RFC 7986）。アプリの色に近いものを選んである。
 */
const COLORS: Record<EventCategory, string> = {
  baito: 'deepskyblue',
  jobhunt: 'orange',
  exam: 'tomato',
  private: 'hotpink',
  trip: 'hotpink',
  other: 'gray',
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** 書き出した時刻（DTSTAMP）だけは UTC でよい。予定の時刻ではないため */
function utc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}` +
    `T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`
  )
}

/** 入力したとおりの時刻（20261016T160000）。末尾に Z は付けない */
function local(d: Date): string {
  return (
    `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}` +
    `T${p2(d.getHours())}${p2(d.getMinutes())}00`
  )
}

/** この端末の時間帯。分からない端末では日本時間とみなす */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo'
  } catch {
    return 'Asia/Tokyo'
  }
}

/** その日の UTC からのずれ。「+0900」の形 */
export function utcOffset(d: Date): string {
  // getTimezoneOffset は「UTC - 現地」の分数。符号が逆なので反転させる
  const mins = -d.getTimezoneOffset()
  const sign = mins < 0 ? '-' : '+'
  const abs = Math.abs(mins)
  return `${sign}${p2(Math.floor(abs / 60))}${p2(abs % 60)}`
}

/**
 * 時間帯の説明。これが無いと、TZID を見る相手が時刻を決められない。
 * 日本は夏時間が無いので 1 つ書けば足りる。
 */
function timeZoneBlock(tzid: string, offset: string): string[] {
  return [
    'BEGIN:VTIMEZONE',
    `TZID:${tzid}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    `TZOFFSETFROM:${offset}`,
    `TZOFFSETTO:${offset}`,
    'END:STANDARD',
    'END:VTIMEZONE',
  ]
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

/**
 * いつ知らせるか。ISO 8601 の期間で書く決まり（-P1W = 1 週間前）。
 * 就活の説明会は申し込みや準備が要るので、早めにも鳴らしている。
 */
const ALARMS = [
  { trigger: '-P1W', label: '1週間前' },
  { trigger: '-P3D', label: '3日前' },
  { trigger: '-P1D', label: '1日前' },
  { trigger: '-PT30M', label: '30分前' },
]

/** 終日の予定には 30 分前を入れない（前日の 23:30 に鳴るだけなので） */
function alarmLines(title: string, allDay = false): string[] {
  return ALARMS.filter((a) => !allDay || a.trigger !== '-PT30M').flatMap((a) => [
    'BEGIN:VALARM',
    `TRIGGER:${a.trigger}`,
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(`${a.label} - ${title}`)}`,
    'END:VALARM',
  ])
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
  /**
   * この種類だけ出す。Google カレンダーで色を分けたいときに使う
   * （種類ごとのカレンダーに分けて読み込ませると、向こうで色が付く）。
   */
  only?: EventCategory
  /** 書き出した時刻。テストで固定するために渡せる */
  now?: Date
  /** 時間帯。省略すると端末の時間帯（日本なら Asia/Tokyo） */
  timeZone?: string
}

/** 予定の題名。題名が空のものは種類の名前にする（バイトなど） */
export function titleOf(e: EventItem): string {
  return e.title.trim() || CATEGORY_LABELS[e.category] || '予定'
}

/** 出す対象の予定。時刻の入っていないものは飛ばす（カレンダーに置けないため） */
export function eventsToExport(
  events: EventItem[],
  from?: string,
  only?: EventCategory,
): EventItem[] {
  return events
    .filter((e) => typeof e.start === 'string' && typeof e.end === 'string' && e.start && e.end)
    .filter((e) => !from || e.date >= from)
    .filter((e) => !only || e.category === only)
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
  const tzid = options.timeZone ?? deviceTimeZone()
  const offset = utcOffset(options.now ?? new Date())
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//yoteicho//${DOMAIN}//JP`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    // 読み込む側がカレンダー全体の時間帯を見ることがあるので、ここにも書く
    `X-WR-TIMEZONE:${tzid}`,
    ...timeZoneBlock(tzid, offset),
  ]

  for (const e of eventsToExport(events, options.from, options.only)) {
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
      `DTSTART;TZID=${tzid}:${local(start)}`,
      `DTEND;TZID=${tzid}:${local(end)}`,
      `SUMMARY:${esc(titleOf(e))}`,
      `CATEGORIES:${esc(CATEGORY_LABELS[e.category] ?? 'その他')}`,
      // 読める相手だけが使う。Google カレンダーは見ない
      `COLOR:${COLORS[e.category] ?? COLORS.other}`,
    )
    if (where) lines.push(`LOCATION:${esc(where)}`)
    if (e.memo) lines.push(`DESCRIPTION:${esc(e.memo)}`)
    lines.push(...alarmLines(titleOf(e)), 'END:VEVENT')
  }

  // 旅行は「旅行」を出すときだけ（種類を絞っているときに混ざらないように）
  const trips = !options.only || options.only === 'trip' ? (options.trips ?? []) : []
  for (const t of tripsToExport(trips, options.from)) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:yotei-trip-${t.id}@${DOMAIN}`,
      `DTSTAMP:${stamp}`,
      // 終日の予定は、終わりの日の「次の日」を書く決まり（その日を含まない）
      `DTSTART;VALUE=DATE:${dateOnly(t.startDate)}`,
      `DTEND;VALUE=DATE:${dateOnly(addDays(t.endDate, 1))}`,
      `SUMMARY:${esc(t.name)}`,
      'CATEGORIES:旅行',
      `COLOR:${COLORS.trip}`,
      // 終日の旅行で予定表が「予定あり」で埋まらないようにする
      'TRANSP:TRANSPARENT',
    )
    if (t.memo) lines.push(`DESCRIPTION:${esc(t.memo)}`)
    lines.push(...alarmLines(t.name, true), 'END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function icsFilename(from?: string, only?: EventCategory): string {
  return `yoteicho-${only ?? 'all-kinds'}-${from ? `from-${from}` : 'all'}.ics`
}

/**
 * 書き出した結果。何が起きたかを画面に出すために返す。
 * 「書き出しました」と出したのに何も起きていない、を無くすため。
 */
export type IcsDelivery = 'shared' | 'downloaded' | 'cancelled' | 'failed'

/**
 * 書き出したファイルを渡す。**iPhone では共有メニュー、パソコンでは保存。**
 *
 * iPhone でホーム画面から開いているとき（PWA）、`<a download>` での保存は**黙って何も起きない。**
 * 画面には「書き出しました」と出るのにファイルがどこにも無い、という状態になっていた
 * （2026-10-27 に実際に起きた）。共有メニューなら、その場でカレンダーやファイルに渡せる。
 */
export async function deliverIcs(filename: string, text: string): Promise<IcsDelivery> {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (typeof File !== 'undefined' && typeof nav.share === 'function') {
    const file = new File([text], filename, { type: 'text/calendar' })
    // canShare が無い端末もある。その場合は share を試して、断られたら保存に回す
    if (!nav.canShare || nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: filename })
        return 'shared'
      } catch (e) {
        // 本人が共有メニューを閉じただけ。保存し直さない（二重に出ると驚くため）
        if (e instanceof Error && e.name === 'AbortError') return 'cancelled'
      }
    }
  }
  try {
    downloadIcs(filename, text)
    return 'downloaded'
  } catch {
    return 'failed'
  }
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
