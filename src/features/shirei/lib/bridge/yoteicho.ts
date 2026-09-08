/**
 * よてい帳から今日の予定を読む (読み取り専用)。
 *
 * 予定・授業・移動の正本はよてい帳。こちらは **一切書き込まない。**
 * だからよてい帳のデータが壊れる心配がない。
 *
 * 同じオリジン (banz-hub.github.io) に置いてあることが前提。
 * IndexedDB はオリジンごとに隔離されるので、開発中の localhost では
 * ポートが違うと読めない。読めなかったときは手入力に切り替えられるようにしてある。
 *
 * ここにある時間割の組み立てと空き時間の切り出しは、よてい帳の
 * `src/lib/schedule.ts` と同じ考え方を、Personal Manager に必要な範囲だけ写したもの。
 * 別リポジトリなので共有できず、写している。**よてい帳側を直したらここも見直すこと。**
 */

import { get } from 'idb-keyval'
import { yoteiStore as store } from '../../../yotei/bridge'
import { placeLabelBetween, spotBetween } from '../../../yotei/lib/schedule'
import type { Interest as YTodoInterest, SpotKind, Todo as YTodo } from '../../../yotei/types'
import { fromMinutes, parseDate, toMinutes } from '../date'
import type { FreeSlot } from '../scheduler'

/** 趣味・関心。名前がぶつかるので別名で受ける */
type YInterest = YTodoInterest

/** よてい帳のデータのうち、こちらが読む部分だけの型 */
interface YPeriodTime {
  period: number
  start: string
  end: string
}
interface YProfile {
  periods: YPeriodTime[]
}
interface YPlace {
  id: string
  name: string
  station: string
  walkMinutes: number
  spot?: SpotKind
}
interface YCourse {
  id: string
  name: string
  day: number
  period: number
  room?: string
  placeId?: string
  startDate: string
  endDate: string
  skipDates: string[]
}
interface YEvent {
  id: string
  title: string
  category: string
  date: string
  start: string
  end: string
  placeId?: string
  station?: string
  needsTravel: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  baito: 'バイト',
  trip: '旅行',
  jobhunt: '就活',
  private: '大事な予定',
  other: 'その他',
}

/** その日に入っている動かせない予定 */
export interface FixedItem {
  id: string
  title: string
  start: string
  end: string
  startMin: number
  endMin: number
  /** 大学 / バイト先など */
  placeName?: string
  /** 最寄り駅。前後が同じ駅なら、その空き時間はそこに留まっている */
  station?: string
  /** その場所で何ができるか。よてい帳の「やること」の場所と突き合わせる */
  spot: SpotKind
  kind: 'course' | 'event'
  category?: string
}

export interface YoteichoDay {
  available: boolean
  items: FixedItem[]
  slots: FreeSlot[]
  /** よてい帳の「やること」。正本は向こう。ここでは読むだけ */
  todos: YTodo[]
  /** よてい帳の「趣味・関心」。同じく読むだけ */
  interests: YInterest[]
  /** 読めなかったときの理由 */
  reason?: string
}


async function read<T>(key: string): Promise<T | undefined> {
  return get<T>(key, store)
}

/** その日に開かれる授業 */
export function coursesOn(
  dateKey: string,
  courses: YCourse[],
  periods: YPeriodTime[],
  places: YPlace[],
): FixedItem[] {
  const day = parseDate(dateKey).getDay()
  const out: FixedItem[] = []
  for (const course of courses) {
    if (course.day !== day) continue
    if (dateKey < course.startDate || dateKey > course.endDate) continue
    if (course.skipDates?.includes(dateKey)) continue
    const period = periods.find((p) => p.period === course.period)
    if (!period) continue
    const place = places.find((p) => p.id === course.placeId)
    out.push({
      id: `${course.id}@${dateKey}`,
      title: course.name,
      start: period.start,
      end: period.end,
      startMin: toMinutes(period.start),
      endMin: toMinutes(period.end),
      placeName: place?.name ?? '大学',
      station: place?.station,
      spot: place?.spot ?? 'campus',
      kind: 'course',
    })
  }
  return out
}

/**
 * その日の単発の予定。
 *
 * 時刻の入っていない予定は飛ばす。1 件おかしいだけで
 * その日のよてい帳の連携がまるごと止まるのを防ぐため
 * (時刻が無いと空き時間を計算できないので、拾っても使えない)。
 */
export function eventsOn(dateKey: string, events: YEvent[], places: YPlace[]): FixedItem[] {
  return events
    .filter((e) => e.date === dateKey)
    .filter((e) => typeof e.start === 'string' && typeof e.end === 'string')
    .map((e) => {
      const place = places.find((p) => p.id === e.placeId)
      return {
        id: e.id,
        title: e.title || CATEGORY_LABELS[e.category] || '予定',
        start: e.start,
        end: e.end,
        startMin: toMinutes(e.start),
        endMin: toMinutes(e.end),
        placeName: place?.name ?? e.station,
        station: place?.station ?? e.station,
        spot: place?.spot ?? 'outside',
        kind: 'event' as const,
        category: e.category,
      }
    })
}

export interface SlotOptions {
  dayStart: string
  dayEnd: string
  minSlotMin: number
  /**
   * 場所が変わるときに見込む移動時間 (分)。
   * 経路の計算はよてい帳の担当なので、こちらは粗い引き当てしかしない。
   */
  travelAllowanceMin: number
}

/**
 * 予定の隙間を空き時間として取り出す。
 * 場所が変わる境目では移動のぶんを先に差し引く (差し引かないと守れない予定になる)。
 */
export function findSlots(items: FixedItem[], o: SlotOptions): FreeSlot[] {
  const dayStart = toMinutes(o.dayStart)
  const dayEnd = toMinutes(o.dayEnd)

  // 重なった予定はひとつにまとめる
  const merged: FixedItem[] = []
  for (const item of [...items].sort((a, b) => a.startMin - b.startMin)) {
    const last = merged[merged.length - 1]
    if (last && item.startMin < last.endMin) {
      if (item.endMin > last.endMin) merged[merged.length - 1] = { ...last, endMin: item.endMin }
      continue
    }
    merged.push(item)
  }

  const slots: FreeSlot[] = []
  let cursor = dayStart
  let before: FixedItem | undefined

  const push = (from: number, to: number, after?: FixedItem) => {
    const moves = Boolean(after) && before?.placeName !== after?.placeName
    const reserved = moves ? o.travelAllowanceMin : 0
    const end = to - reserved
    if (end - from < o.minSlotMin) return
    slots.push({
      startMin: from,
      endMin: end,
      label: labelFor(before, after),
      spot: spotBetween(before, after),
      placeLabel: placeLabelBetween(before, after),
    })
  }

  for (const item of merged) {
    if (item.startMin > cursor) push(cursor, item.startMin, item)
    cursor = Math.max(cursor, item.endMin)
    before = item
  }
  if (cursor < dayEnd) push(cursor, dayEnd, undefined)

  return slots
}

function labelFor(before?: FixedItem, after?: FixedItem): string {
  if (!before && !after) return '終日'
  if (!before) return `${after!.title}の前`
  if (!after) return `${before.title}のあと`
  if (before.placeName && before.placeName === after.placeName) return before.placeName
  return `${before.title}のあと`
}

/**
 * 今日の予定と空き時間を読む。
 * よてい帳が使えないときは available:false を返し、理由を添える。
 * 例外は投げない (連携が使えないだけで、エージェントは手入力で動かせるべきなので)。
 */
export async function loadYoteichoDay(dateKey: string, o: SlotOptions): Promise<YoteichoDay> {
  try {
    const [profile, places, courses, events, todos, interests] = await Promise.all([
      read<YProfile>('profile'),
      read<YPlace[]>('places'),
      read<YCourse[]>('courses'),
      read<YEvent[]>('events'),
      read<YTodo[]>('todos'),
      read<YInterest[]>('interests'),
    ])

    if (!profile && !courses?.length && !events?.length) {
      return {
        available: false,
        items: [],
        slots: [],
        todos: [],
        interests: [],
        reason:
          'よてい帳のデータが見つかりません。同じオリジン (banz-hub.github.io) で開いているか確認してください。開発中の localhost ではポートが違うと読めません。',
      }
    }

    const items = [
      ...coursesOn(dateKey, courses ?? [], profile?.periods ?? [], places ?? []),
      ...eventsOn(dateKey, events ?? [], places ?? []),
    ].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

    return {
      available: true,
      items,
      slots: findSlots(items, o),
      todos: todos ?? [],
      interests: interests ?? [],
    }
  } catch (e) {
    return {
      available: false,
      items: [],
      slots: [],
      todos: [],
      interests: [],
      reason: `よてい帳のデータを読めませんでした (${e instanceof Error ? e.message : String(e)})`,
    }
  }
}

/** 「19:00〜23:00」のような手入力を空き時間に直す */
export function parseManualSlots(text: string): FreeSlot[] {
  const out: FreeSlot[] = []
  const re = /(\d{1,2})\s*[:時]\s*(\d{0,2})\s*[〜~\-–—から]\s*(\d{1,2})\s*[:時]?\s*(\d{0,2})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const s = Number(m[1]) * 60 + Number(m[2] || 0)
    const e = Number(m[3]) * 60 + Number(m[4] || 0)
    if (e > s) out.push({ startMin: s, endMin: e, label: `${fromMinutes(s)}〜${fromMinutes(e)}` })
  }
  return out.sort((a, b) => a.startMin - b.startMin)
}
