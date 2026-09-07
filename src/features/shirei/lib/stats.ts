/**
 * 月次・年次の集計と、推移を見るための並び。
 *
 * 週次は「来週どうするか」のためのものだが、月次・年次は
 * **続いているかどうか**を見るためのもの。だから細かい所見は出さず、
 * 数字と推移をそのまま見せる。
 */

import type { DayPlan, StudyNode, StudySession, TaskArea, TaskLog } from '../types'
import { AREA_LABELS } from '../types'
import type { WorkoutDay } from './bridge/kintore'
import { addDays, dateKey, parseDate } from './date'
import { workBlocks } from './scheduler'
import { areaOf } from './study'

export interface Bucket {
  /** 表示用の名前。「9月」「2026年」「9/7」など */
  label: string
  /** 範囲の始まり (YYYY-MM-DD) */
  from: string
  /** 範囲の終わり (YYYY-MM-DD) */
  to: string
}

/** 直近 n か月ぶんの区切り。古い順 */
export function monthBuckets(today: string, count = 6): Bucket[] {
  const base = parseDate(today)
  const out: Bucket[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    out.push({
      label: `${d.getMonth() + 1}月`,
      from: dateKey(d),
      to: dateKey(last),
    })
  }
  return out
}

/** 直近 n 年ぶんの区切り。古い順 */
export function yearBuckets(today: string, count = 3): Bucket[] {
  const y = parseDate(today).getFullYear()
  return Array.from({ length: count }, (_, i) => {
    const year = y - (count - 1 - i)
    return { label: `${year}年`, from: `${year}-01-01`, to: `${year}-12-31` }
  })
}

/** 直近 n 日ぶんの区切り。古い順 */
export function dayBuckets(today: string, count = 14): Bucket[] {
  return Array.from({ length: count }, (_, i) => {
    const d = addDays(today, -(count - 1 - i))
    const p = parseDate(d)
    return { label: `${p.getMonth() + 1}/${p.getDate()}`, from: d, to: d }
  })
}

export interface PeriodStats {
  bucket: Bucket
  /** 作業した時間 (タスク + 学習 + 筋トレ) */
  totalMin: number
  taskMin: number
  studyMin: number
  workoutMin: number
  /** 予定に入れたコマ数と、そのうち終えた数 */
  planned: number
  done: number
  /** 分野ごとの時間。多い順 */
  byArea: Array<[TaskArea, number]>
  /** 習得まで進んだ学習項目 */
  masteredCount: number
  /** 筋トレの回数 */
  workoutCount: number
}

export interface StatsInput {
  buckets: Bucket[]
  logs: TaskLog[]
  sessions: StudySession[]
  nodes: StudyNode[]
  plans: DayPlan[]
  workouts: WorkoutDay[] | null
}

export function buildStats(input: StatsInput): PeriodStats[] {
  return input.buckets.map((bucket) => {
    const inRange = (d: string) => d >= bucket.from && d <= bucket.to

    const logs = input.logs.filter((l) => inRange(l.date))
    const sessions = input.sessions.filter((s) => inRange(s.date))
    const plans = input.plans.filter((p) => inRange(p.date))
    const workouts = (input.workouts ?? []).filter((w) => inRange(w.date))

    const taskMin = logs.reduce((sum, l) => sum + l.actualMin, 0)
    const studyMin = sessions.reduce((sum, s) => sum + s.minutes, 0)
    const workoutMin = workouts.reduce((sum, w) => sum + w.minutes, 0)

    const areaMap = new Map<TaskArea, number>()
    for (const l of logs) areaMap.set(l.area, (areaMap.get(l.area) ?? 0) + l.actualMin)
    for (const s of sessions) {
      const area = areaOf(input.nodes, s.nodeId)
      areaMap.set(area, (areaMap.get(area) ?? 0) + s.minutes)
    }

    const blocks = plans.flatMap((p) => workBlocks(p))

    return {
      bucket,
      totalMin: taskMin + studyMin + workoutMin,
      taskMin,
      studyMin,
      workoutMin,
      planned: blocks.length,
      done: blocks.filter((b) => b.doneAt).length,
      byArea: [...areaMap.entries()].sort((a, b) => b[1] - a[1]),
      masteredCount: sessions.filter((s) => s.mastery === 'mastered').length,
      workoutCount: workouts.length,
    }
  })
}

/** 期間全体をひとつにまとめた数字 */
export function totalOf(stats: PeriodStats[]): PeriodStats | null {
  if (stats.length === 0) return null
  const areaMap = new Map<TaskArea, number>()
  for (const s of stats) for (const [a, m] of s.byArea) areaMap.set(a, (areaMap.get(a) ?? 0) + m)

  return {
    bucket: { label: '合計', from: stats[0].bucket.from, to: stats.at(-1)!.bucket.to },
    totalMin: stats.reduce((n, s) => n + s.totalMin, 0),
    taskMin: stats.reduce((n, s) => n + s.taskMin, 0),
    studyMin: stats.reduce((n, s) => n + s.studyMin, 0),
    workoutMin: stats.reduce((n, s) => n + s.workoutMin, 0),
    planned: stats.reduce((n, s) => n + s.planned, 0),
    done: stats.reduce((n, s) => n + s.done, 0),
    byArea: [...areaMap.entries()].sort((a, b) => b[1] - a[1]),
    masteredCount: stats.reduce((n, s) => n + s.masteredCount, 0),
    workoutCount: stats.reduce((n, s) => n + s.workoutCount, 0),
  }
}

/**
 * 棒グラフのために、いちばん大きい値で割った 0〜1 を出す。
 * すべて 0 のときは 0 を返す (0 で割らない)。
 */
export function ratios(values: number[]): number[] {
  const max = Math.max(...values, 0)
  return values.map((v) => (max > 0 ? v / max : 0))
}

/** 「増えている / 減っている / 変わらない」を、最後の2つの区切りから言う */
export function trendOf(stats: PeriodStats[]): string | null {
  if (stats.length < 2) return null
  const prev = stats.at(-2)!.totalMin
  const last = stats.at(-1)!.totalMin
  if (prev === 0 && last === 0) return null
  if (prev === 0) return `${stats.at(-1)!.bucket.label}から動き始めています。`

  const diff = (last - prev) / prev
  if (Math.abs(diff) < 0.1) return `${stats.at(-2)!.bucket.label}とほぼ同じペースです。`
  return diff > 0
    ? `${stats.at(-2)!.bucket.label}より${Math.round(diff * 100)}%増えています。`
    : `${stats.at(-2)!.bucket.label}より${Math.round(-diff * 100)}%減っています。`
}

export function areaLabel(area: TaskArea): string {
  return AREA_LABELS[area]
}
