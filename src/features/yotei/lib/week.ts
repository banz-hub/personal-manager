/**
 * 週のカレンダーの並べ方。画面から切り離してあるのはテストのため。
 *
 *  - 週は**月曜はじまり**。ふりかえりの週と区切りをそろえる
 *  - 縦に並べる時間の幅は、その週の予定が全部入る幅にする（最低でも 8 時〜 22 時）
 *  - 時刻が重なった予定は横に並べる。重ねて描くと下の予定が読めなくなる
 */

import { addDays, parseDate } from './date'

/** その日を含む週の月曜 */
export function mondayOf(date: string): string {
  const offset = (parseDate(date).getDay() + 6) % 7
  return addDays(date, -offset)
}

export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

export interface Span {
  startMin: number
  endMin: number
}

/** 縦に並べる時間の幅 (時)。予定が 8 時前や 22 時過ぎにあれば広げる */
export function hourRange(items: Span[], min = 8, max = 22): [number, number] {
  let from = min
  let to = max
  for (const it of items) {
    from = Math.min(from, Math.floor(it.startMin / 60))
    to = Math.max(to, Math.ceil(it.endMin / 60))
  }
  return [Math.max(0, from), Math.min(24, to)]
}

export interface Placed<T> {
  item: T
  /** 横に並べたときの何列目か (0 始まり) */
  lane: number
  /** 重なっている組の列の数 */
  lanes: number
}

/**
 * 重なった予定を横に並べる。
 * つながって重なっている予定をひとまとまりにして、その中で空いている列に順に入れる。
 */
export function layoutDay<T extends Span>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
  const out: Placed<T>[] = []
  let group: Placed<T>[] = []
  let laneEnds: number[] = []
  let groupEnd = -1

  const flush = () => {
    for (const p of group) p.lanes = laneEnds.length
    out.push(...group)
    group = []
    laneEnds = []
  }

  for (const item of sorted) {
    if (item.startMin >= groupEnd) {
      flush()
      groupEnd = item.endMin
    } else {
      groupEnd = Math.max(groupEnd, item.endMin)
    }
    let lane = laneEnds.findIndex((end) => end <= item.startMin)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(item.endMin)
    } else {
      laneEnds[lane] = item.endMin
    }
    group.push({ item, lane, lanes: 1 })
  }
  flush()
  return out
}
