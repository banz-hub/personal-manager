/**
 * その日の予定を1本のタイムラインに組み立て、空き時間を割り出す。
 * 授業 (半年固定の繰り返し) と単発の予定をここで同じ形にそろえる。
 */

import type {
  Course,
  EventCategory,
  EventItem,
  PeriodTime,
  Place,
  Profile,
  SpotKind,
} from '../types'
import { fromMinutes, parseDate, toMinutes } from './date'

export interface TimelineItem {
  id: string
  kind: 'course' | 'event'
  title: string
  start: string
  end: string
  startMin: number
  endMin: number
  category?: EventCategory
  /** 目的地の駅 */
  station?: string
  walkMinutes: number
  placeName?: string
  room?: string
  needsTravel: boolean
  /** その場所でできること */
  spot: SpotKind
  course?: Course
  event?: EventItem
}

/** 場所を決めるのに要るぶんだけ。TimelineItem も FixedItem もこれを満たす */
export interface PlaceSide {
  spot: SpotKind
  placeName?: string
  station?: string
}

function placeOf(places: Place[], id?: string): Place | undefined {
  return id ? places.find((p) => p.id === id) : undefined
}

/** その日に開かれる授業 */
export function coursesOn(
  dateKey: string,
  courses: Course[],
  periods: PeriodTime[],
  places: Place[],
): TimelineItem[] {
  const day = parseDate(dateKey).getDay()
  const out: TimelineItem[] = []
  for (const course of courses) {
    if (course.day !== day) continue
    if (dateKey < course.startDate || dateKey > course.endDate) continue
    if (course.skipDates.includes(dateKey)) continue
    const period = periods.find((p) => p.period === course.period)
    if (!period) continue
    const place = placeOf(places, course.placeId)
    out.push({
      id: `${course.id}@${dateKey}`,
      kind: 'course',
      title: course.name,
      start: period.start,
      end: period.end,
      startMin: toMinutes(period.start),
      endMin: toMinutes(period.end),
      station: place?.station,
      walkMinutes: place?.walkMinutes ?? 0,
      placeName: place?.name ?? '大学',
      room: course.room,
      needsTravel: Boolean(place?.station),
      spot: place?.spot ?? 'campus',
      course,
    })
  }
  return out
}

/** その日の単発の予定 */
export function eventsOn(dateKey: string, events: EventItem[], places: Place[]): TimelineItem[] {
  return events
    .filter((e) => e.date === dateKey)
    .map((e) => {
      const place = placeOf(places, e.placeId)
      const station = place?.station ?? e.station
      return {
        id: e.id,
        kind: 'event' as const,
        title: e.title,
        start: e.start,
        end: e.end,
        startMin: toMinutes(e.start),
        endMin: toMinutes(e.end),
        category: e.category,
        station,
        walkMinutes: place?.walkMinutes ?? e.walkMinutes ?? 0,
        placeName: place?.name,
        needsTravel: e.needsTravel && Boolean(station),
        spot: place?.spot ?? (station ? 'outside' : 'home'),
        event: e,
      }
    })
}

/** その日のタイムライン (開始時刻順) */
export function timelineOn(
  dateKey: string,
  data: { courses: Course[]; events: EventItem[]; places: Place[]; profile: Profile },
): TimelineItem[] {
  return [
    ...coursesOn(dateKey, data.courses, data.profile.periods, data.places),
    ...eventsOn(dateKey, data.events, data.places),
  ].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
}

export interface Gap {
  startMin: number
  endMin: number
  start: string
  end: string
  minutes: number
  /** その時間に居そうな場所 */
  spot: SpotKind
  placeLabel: string
  before?: TimelineItem
  after?: TimelineItem
  /** 移動に取られる時間を差し引いてあるか */
  travelReserved: number
}

export interface GapOptions {
  /** 活動を始める時刻。既定 08:00 */
  dayStart?: string
  /** 活動を終える時刻。既定 23:00 */
  dayEnd?: string
  /** この分数より短い隙間は数えない */
  minMinutes?: number
  /** 2つの予定の間で見込む移動時間 */
  travelMinutes?: (from: TimelineItem | undefined, to: TimelineItem | undefined) => number
}

/**
 * タイムラインの隙間を空き時間として取り出す。
 * 予定の間の移動に必要な時間は先に差し引く。
 */
export function findGaps(items: TimelineItem[], options: GapOptions = {}): Gap[] {
  const dayStart = toMinutes(options.dayStart ?? '08:00')
  const dayEnd = toMinutes(options.dayEnd ?? '23:00')
  const minMinutes = options.minMinutes ?? 20
  const travel = options.travelMinutes ?? (() => 0)

  // 重なった予定はひとつにまとめる
  const merged: TimelineItem[] = []
  for (const item of [...items].sort((a, b) => a.startMin - b.startMin)) {
    const last = merged[merged.length - 1]
    if (last && item.startMin < last.endMin) {
      if (item.endMin > last.endMin) merged[merged.length - 1] = { ...last, endMin: item.endMin }
      continue
    }
    merged.push(item)
  }

  const gaps: Gap[] = []
  let cursor = dayStart
  let before: TimelineItem | undefined

  const push = (from: number, to: number, after?: TimelineItem) => {
    const reserved = travel(before, after)
    const start = from
    const end = to - reserved
    const minutes = end - start
    if (minutes < minMinutes) return
    gaps.push({
      startMin: start,
      endMin: end,
      start: fromMinutes(start),
      end: fromMinutes(end),
      minutes,
      spot: spotBetween(before, after),
      placeLabel: placeLabelBetween(before, after),
      before,
      after,
      travelReserved: reserved,
    })
  }

  for (const item of merged) {
    if (item.startMin > cursor) push(cursor, item.startMin, item)
    cursor = Math.max(cursor, item.endMin)
    before = item
  }
  if (cursor < dayEnd) push(cursor, dayEnd, undefined)

  return gaps
}

/**
 * 前後の予定から、その空き時間に居そうな場所を決める。
 *
 * 引数を TimelineItem そのものではなく必要な 3 つに絞ってあるのは、
 * エージェント側の橋 (bridge/yoteicho.ts) からも同じ判定を使うため。
 * 場所の決め方を 2 か所に持つと、同じ空き時間に別の場所が出る。
 */
export function spotBetween(before?: PlaceSide, after?: PlaceSide): SpotKind {
  if (!before && !after) return 'home'
  // 朝いちの予定の前、最後の予定の後は自宅にいる想定
  if (!before) return 'home'
  if (!after) return before.spot === 'home' ? 'home' : 'outside'
  // 前後が同じ場所なら、その場所に留まっている
  if (before.placeName && before.placeName === after.placeName) return before.spot
  if (before.station && after.station && before.station === after.station) return before.spot
  return 'outside'
}

export function placeLabelBetween(before?: PlaceSide, after?: PlaceSide): string {
  if (!before) return '自宅'
  if (!after) return before.spot === 'home' ? '自宅' : '外出先'
  if (before.placeName && before.placeName === after.placeName) return before.placeName
  if (before.station && after.station && before.station === after.station) {
    return `${before.station}周辺`
  }
  return '移動をはさむ'
}

/** 今より後の直近の予定 */
export function nextItem(items: TimelineItem[], nowMinutes: number): TimelineItem | undefined {
  return items.find((i) => i.endMin > nowMinutes)
}

/** その日の予定が占める合計時間 */
export function busyMinutes(items: TimelineItem[]): number {
  const merged: Array<[number, number]> = []
  for (const item of [...items].sort((a, b) => a.startMin - b.startMin)) {
    const last = merged[merged.length - 1]
    if (last && item.startMin < last[1]) {
      last[1] = Math.max(last[1], item.endMin)
      continue
    }
    merged.push([item.startMin, item.endMin])
  }
  return merged.reduce((sum, [s, e]) => sum + (e - s), 0)
}
