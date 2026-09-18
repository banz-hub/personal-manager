/**
 * 1 日 24 時間のタイムスケジュール。予定・睡眠・空き時間を同じ物差し（0 時からの分）に並べる。
 *
 * 空き時間は「予定も睡眠も入っていない時間」をそのまま出すだけ。
 * そこに何を入れるかは決めない（時間の割り当てはしない、という約束のまま）。
 */

import type { SleepLog } from '../types'
import { parseDate } from './date'

export const DAY_MIN = 24 * 60

export interface Span {
  startMin: number
  endMin: number
}

/** 重なり・隣り合う区間を 1 つにまとめる */
export function mergeSpans(spans: Span[]): Span[] {
  const out: Span[] = []
  for (const s of [...spans].sort((a, b) => a.startMin - b.startMin)) {
    const last = out[out.length - 1]
    if (last && s.startMin <= last.endMin) last.endMin = Math.max(last.endMin, s.endMin)
    else out.push({ startMin: s.startMin, endMin: s.endMin })
  }
  return out
}

/**
 * 予定の終わりを 1 日の中に収める。
 * 「22:00〜00:30」のように日をまたぐ予定は、その日のぶんとして 24:00 で切る。
 */
export function clampToDay(s: Span): Span {
  const startMin = Math.max(0, Math.min(DAY_MIN, s.startMin))
  const endMin = s.endMin <= s.startMin ? DAY_MIN : Math.min(DAY_MIN, s.endMin)
  return { startMin, endMin }
}

/** 埋まっていない時間。`minMin` 分より短い隙間は数えない（移動や準備で消える） */
export function freeGaps(busy: Span[], minMin = 15): Span[] {
  const gaps: Span[] = []
  let cursor = 0
  for (const b of mergeSpans(busy.map(clampToDay))) {
    if (b.startMin - cursor >= minMin) gaps.push({ startMin: cursor, endMin: b.startMin })
    cursor = Math.max(cursor, b.endMin)
  }
  if (DAY_MIN - cursor >= minMin) gaps.push({ startMin: cursor, endMin: DAY_MIN })
  return gaps
}

/**
 * その日の 0 時〜24 時にかかる睡眠。
 * 前の晩から朝まで（0:00〜起きた時刻）と、その日の夜に寝たぶん（寝た時刻〜24:00）の両方を拾う。
 * いま寝ている最中の記録（終わりが無いもの）は長さが分からないので入れない。
 */
export function sleepOn(logs: SleepLog[], date: string): Span[] {
  const dayStart = parseDate(date).getTime()
  const out: Span[] = []
  for (const log of logs) {
    for (const sp of log.spans) {
      if (!sp.to) continue
      const a = (new Date(sp.from).getTime() - dayStart) / 60000
      const b = (new Date(sp.to).getTime() - dayStart) / 60000
      const s = Math.max(0, Math.round(a))
      const e = Math.min(DAY_MIN, Math.round(b))
      if (e > s) out.push({ startMin: s, endMin: e })
    }
  }
  return mergeSpans(out)
}

export function totalMin(spans: Span[]): number {
  return spans.reduce((sum, s) => sum + (s.endMin - s.startMin), 0)
}

export function longest(spans: Span[]): Span | undefined {
  return spans.reduce<Span | undefined>(
    (best, s) => (!best || s.endMin - s.startMin > best.endMin - best.startMin ? s : best),
    undefined,
  )
}
