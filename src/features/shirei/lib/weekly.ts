/**
 * 週次レビュー。3 つのアプリの記録をまとめて 1 週間を振り返る。
 *
 * 日次レビューと同じで、責めるためではなく次の週の精度を上げるためのもの。
 * だから最後に **「来週改善すべきこと 3 つ」** を、記録から言える範囲で出す。
 */

import type {
  Company,
  DailyReview,
  DayPlan,
  SelectionEvent,
  StudyNode,
  StudySession,
  Task,
  TaskArea,
  TaskLog,
  WeeklySummary,
} from '../types'
import { AREA_LABELS } from '../types'
import type { WorkoutDay } from './bridge/kintore'
import { addDays, dateKey, daysBetween, formatDuration, parseDate, toMinutes } from './date'
import { activeCompanies, upcomingSelections } from './jobhunt'
import { workBlocks } from './scheduler'
import { areaOf } from './study'

/** その日を含む週の月曜。週の区切りは月曜はじまりで固定する */
export function weekStartOf(date: string): string {
  const d = parseDate(date)
  // 日曜 (0) は前の週の終わりとして扱う
  const offset = (d.getDay() + 6) % 7
  return dateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset))
}

export function weekEndOf(date: string): string {
  return addDays(weekStartOf(date), 6)
}

export interface WeeklyInput {
  /** 週のどこかの日付。ここから月曜〜日曜を決める */
  date: string
  tasks: Task[]
  logs: TaskLog[]
  plans: DayPlan[]
  reviews: DailyReview[]
  nodes: StudyNode[]
  sessions: StudySession[]
  companies: Company[]
  selections: SelectionEvent[]
  /** 筋トレログから読んだ実績。読めなければ null */
  workouts: WorkoutDay[] | null
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function buildWeekly(input: WeeklyInput): WeeklySummary {
  const weekStart = weekStartOf(input.date)
  const weekEnd = addDays(weekStart, 6)
  const inWeek = (d: string) => d >= weekStart && d <= weekEnd

  // ---- タスク ----
  const plans = input.plans.filter((p) => inWeek(p.date))
  const logs = input.logs.filter((l) => inWeek(l.date))
  const reviews = input.reviews.filter((r) => inWeek(r.date))

  const plannedBlocks = plans.flatMap((p) => workBlocks(p))
  const planned = plannedBlocks.length
  const doneBlocks = plannedBlocks.filter((b) => b.doneAt).length
  const deferred = reviews.reduce((sum, r) => sum + r.deferredTaskIds.length, 0)

  const plannedMin = plannedBlocks.reduce(
    (sum, b) => sum + (toMinutes(b.end) - toMinutes(b.start)),
    0,
  )
  const actualMin = logs.reduce((sum, l) => sum + l.actualMin, 0)

  const ratios = logs.filter((l) => l.plannedMin > 0).map((l) => l.actualMin / l.plannedMin)

  // ---- 学習 ----
  const sessions = input.sessions.filter((s) => inWeek(s.date))
  const studyMin = sessions.reduce((sum, s) => sum + s.minutes, 0)
  const areaMap = new Map<TaskArea, number>()
  for (const s of sessions) {
    const area = areaOf(input.nodes, s.nodeId)
    areaMap.set(area, (areaMap.get(area) ?? 0) + s.minutes)
  }
  for (const l of logs) areaMap.set(l.area, (areaMap.get(l.area) ?? 0) + l.actualMin)
  const masteredCount = sessions.filter((s) => s.mastery === 'mastered').length

  // ---- 就活 ----
  const weekSelections = input.selections.filter((e) => inWeek(e.date))
  const upcoming = upcomingSelections(input.selections, input.companies, weekEnd).filter(
    (d) => d.daysLeft >= 0 && d.daysLeft <= 3,
  )

  // ---- 筋トレ ----
  const workouts = input.workouts?.filter((w) => inWeek(w.date)) ?? []
  const workoutDates = new Set(workouts.map((w) => w.date))

  const summary: WeeklySummary = {
    weekStart,
    weekEnd,
    tasks: {
      planned,
      done: doneBlocks,
      deferred,
      completionRate: planned > 0 ? doneBlocks / planned : 0,
      deferRate: planned > 0 ? deferred / planned : 0,
      plannedMin,
      actualMin,
      estimateRatio: ratios.length > 0 ? median(ratios) : null,
    },
    study: {
      totalMin: studyMin,
      sessions: sessions.length,
      byArea: [...areaMap.entries()].sort((a, b) => b[1] - a[1]),
      masteredCount,
    },
    jobhunt: {
      esCount: weekSelections.filter((e) => e.kind === 'es').length,
      briefingCount: weekSelections.filter((e) => e.kind === 'briefing').length,
      interviewCount: weekSelections.filter((e) => e.kind === 'interview').length,
      activeCompanies: activeCompanies(input.companies).length,
      upcomingCount: upcoming.length,
    },
    workout: {
      count: workouts.length,
      totalMin: workouts.reduce((sum, w) => sum + w.minutes, 0),
      restDays: 7 - workoutDates.size,
      available: input.workouts != null,
    },
    // タスクと学習の両方から集める。どちらも同じ 1 セットとして数える。
    // 手で付けた記録は pomodoros を持たないので 0 になる
    focusSets: [...logs, ...sessions].reduce((sum, r) => sum + (r.pomodoros ?? 0), 0),
    improvements: [],
  }

  summary.improvements = improvementsFor(summary, input)
  return summary
}

interface Candidate {
  /** 大きいほど先に出す。困りごとの深さ */
  severity: number
  text: string
}

/**
 * 「来週改善すべきこと」の候補を出して、深いものから 3 つ返す。
 *
 * 記録から言えることだけを書く。データが無いことは書かない。
 * 3 つに絞るのは、全部並べると結局どれも手をつけないため。
 */
function improvementsFor(s: WeeklySummary, input: WeeklyInput): string[] {
  const out: Candidate[] = []

  if (s.tasks.planned === 0) {
    return ['この週は予定を作っていません。まず朝に「今日の予定を作る」を押すところから始めてください。']
  }

  // 完了率。低いほど困っている
  if (s.tasks.completionRate < 0.6) {
    out.push({
      severity: 100 * (0.6 - s.tasks.completionRate),
      text: `予定${s.tasks.planned}件のうち完了は${s.tasks.done}件（${Math.round(s.tasks.completionRate * 100)}%）でした。1日に入れる量を減らすか、設定の「詰め込みの上限」を下げてください。`,
    })
  }

  // 見積もりのズレ
  if (s.tasks.estimateRatio != null && s.tasks.estimateRatio >= 1.3) {
    out.push({
      severity: 40 * s.tasks.estimateRatio,
      text: `実績が見積もりの${s.tasks.estimateRatio.toFixed(1)}倍かかっています。見積もりは自動で補正されますが、そもそも1回の作業を短く切ったほうが崩れにくくなります。`,
    })
  } else if (s.tasks.estimateRatio != null && s.tasks.estimateRatio <= 0.7) {
    out.push({
      severity: 20,
      text: `実績が見積もりの${s.tasks.estimateRatio.toFixed(1)}倍で、早く終わっています。もう少し詰めて組めます。`,
    })
  }

  // 先送り
  if (s.tasks.deferRate >= 0.3) {
    out.push({
      severity: 60 * s.tasks.deferRate,
      text: `${s.tasks.deferred}件を先送りしています。何度も送っているものは、やる日を決めるか、思い切ってやめるかを決めてください。`,
    })
  }

  // 就活の締切。逃すと取り返しがつかないので重く見る
  if (s.jobhunt.upcomingCount > 0) {
    out.push({
      severity: 80 + s.jobhunt.upcomingCount * 10,
      text: `就活の予定が3日以内に${s.jobhunt.upcomingCount}件あります。就活の締切はこちらの都合で動かせないので、来週はここから先に埋めてください。`,
    })
  }

  // 学習の偏り。上位が全体の 7 割を超えていたら偏っている
  const total = s.study.byArea.reduce((sum, [, m]) => sum + m, 0)
  if (total > 0 && s.study.byArea.length >= 2) {
    const [topArea, topMin] = s.study.byArea[0]
    if (topMin / total >= 0.7) {
      const others = s.study.byArea
        .slice(1)
        .map(([a, m]) => `${AREA_LABELS[a]} ${formatDuration(m)}`)
        .join(' / ')
      out.push({
        severity: 45,
        text: `時間の${Math.round((topMin / total) * 100)}%が${AREA_LABELS[topArea]}に寄っています（他は ${others}）。手薄なほうに1コマだけでも回すと、あとで慌てずに済みます。`,
      })
    }
  }

  // 学習そのものが動いていない
  if (s.study.sessions === 0 && input.nodes.length > 0) {
    out.push({
      severity: 55,
      text: 'この週は学習の記録がありません。1回20〜30分でも記録を残すと、次の復習日と優先順位が動き始めます。',
    })
  }

  // 筋トレ。読めた週だけ
  if (s.workout.available) {
    if (s.workout.count === 0) {
      out.push({
        severity: 35,
        text: 'この週は筋トレの記録がありません。まず1回、短くても入れてみてください。',
      })
    } else if (s.workout.restDays === 0) {
      out.push({
        severity: 50,
        text: `7日すべてトレーニングしています（計${formatDuration(s.workout.totalMin)}）。休養日を1日入れたほうが、結果として続きます。`,
      })
    }
  }

  // 何も問題が無いときは、そう言う
  if (out.length === 0) {
    return [
      `予定${s.tasks.planned}件のうち${s.tasks.done}件を完了、学習${formatDuration(s.study.totalMin)}。大きな崩れはありません。来週も同じ配分でいけます。`,
    ]
  }

  return out
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 3)
    .map((c) => c.text)
}

/** 前の週・次の週へ動かす */
export function shiftWeek(date: string, weeks: number): string {
  return addDays(weekStartOf(date), weeks * 7)
}

/** 「9月8日(火)」ではなく「9/8〜9/14」の形 */
export function formatWeek(weekStart: string): string {
  const s = parseDate(weekStart)
  const e = parseDate(addDays(weekStart, 6))
  return `${s.getMonth() + 1}/${s.getDate()}〜${e.getMonth() + 1}/${e.getDate()}`
}

/** その週が今日を含むか */
export function isCurrentWeek(weekStart: string, today: string): boolean {
  return weekStartOf(today) === weekStart
}

/** 週の残り日数 (今日を含む)。過ぎた週は 0 */
export function daysLeftInWeek(weekStart: string, today: string): number {
  const end = addDays(weekStart, 6)
  if (today > end) return 0
  return Math.max(0, daysBetween(today, end) + 1)
}
