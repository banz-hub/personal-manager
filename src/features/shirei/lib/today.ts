/**
 * 今日の状況をひとまとめにする。
 * 画面はこの結果を並べるだけにして、判断はすべて priority / study / scheduler に置く。
 */

import type {
  Company,
  DayPlan,
  Exam,
  SelectionEvent,
  Settings,
  StudyNode,
  StudySession,
  Task,
  TaskLog,
} from '../types'
import { AREA_LABELS, MASTERY_LABELS } from '../types'
import type { KintoreDay } from './bridge/kintore'
import type { FixedItem } from './bridge/yoteicho'
import { formatDate, formatDuration, fromMinutes, toMinutes } from './date'
import type { Bucket, ScoredTask } from './priority'
import { BUCKET_LABELS, groupByBucket, rankTasks } from './priority'
import type { FreeSlot, Schedulable } from './scheduler'
import { minutesOf, usableSlots } from './scheduler'
import type { ScoredStudy } from './study'
import {
  groupByUrgency,
  selectionSummary,
  upcomingSelections,
  type DatedSelection,
  type Urgency,
} from './jobhunt'
import { buildExamPlan, rankStudy, upcomingExams, type ExamPlan } from './study'

export interface TodayContext {
  date: string
  now: number
  /** 動かせない予定 */
  fixed: FixedItem[]
  /** これから使える空き時間 */
  slots: FreeSlot[]
  availableMin: number
  ranked: ScoredTask[]
  buckets: Record<Bucket, ScoredTask[]>
  /** 今日の学習の候補 (上位から) */
  study: ScoredStudy[]
  /** 近い順の試験の逆算 */
  examPlans: ExamPlan[]
  /** 締切の近い順に並べた選考の予定 */
  selections: DatedSelection[]
  selectionsByUrgency: Record<Urgency, DatedSelection[]>
  /** 筋トレログから読んだ今日の状況 */
  workout?: KintoreDay
  /** 疲労を見て詰め込みを緩めたときの説明 */
  easedNote?: string
  /** 実際に予定表を組むときに使う設定 (緩めたぶんが入っている) */
  planSettings: Settings
  /** 予定表を組むときに渡すもの。タスクと学習を混ぜてある */
  schedulable: Schedulable[]
  plan?: DayPlan
}

export interface BuildInput {
  date: string
  now: number
  tasks: Task[]
  logs: TaskLog[]
  nodes: StudyNode[]
  exams: Exam[]
  sessions: StudySession[]
  companies: Company[]
  selections: SelectionEvent[]
  fixed: FixedItem[]
  slots: FreeSlot[]
  settings: Settings
  workout?: KintoreDay
  plan?: DayPlan
}

export function buildToday(input: BuildInput): TodayContext {
  const { settings } = input
  const slots = usableSlots(input.slots, input.now, settings.minSlotMin)
  const availableMin = slots.reduce((sum, s) => sum + minutesOf(s), 0)

  const ranked = rankTasks({
    tasks: input.tasks,
    logs: input.logs,
    today: input.date,
    now: input.now,
    availableMin,
  })

  const study = rankStudy({
    nodes: input.nodes,
    exams: input.exams,
    sessions: input.sessions,
    today: input.date,
    chunkMin: settings.studyChunkMin,
  })

  const examPlans = upcomingExams(input.exams, input.date).map((e) =>
    buildExamPlan(e, input.nodes, input.sessions, input.date),
  )

  const selections = upcomingSelections(input.selections, input.companies, input.date)

  const eased = easedSettings(settings, input.workout)

  return {
    date: input.date,
    now: input.now,
    fixed: input.fixed,
    slots,
    availableMin,
    ranked,
    buckets: groupByBucket(ranked),
    study,
    examPlans,
    selections,
    selectionsByUrgency: groupByUrgency(selections),
    workout: input.workout,
    easedNote: eased.note,
    planSettings: eased.settings,
    schedulable: mergeForSchedule(ranked, study, input.workout, settings),
    plan: input.plan,
  }
}

/**
 * 前日の負荷が高い日は、詰め込みの上限を自動で下げる。
 *
 * 筋トレのあとに普段どおりの量を積むと、たいてい崩れる。
 * ただし黙って下げると理由が分からないので、下げたことと理由を必ず返す。
 */
export function easedSettings(
  settings: Settings,
  workout?: KintoreDay,
): { settings: Settings; note?: string } {
  if (!settings.easeAfterWorkout || !workout?.available) return { settings }

  const heavyYesterday = (workout.yesterdayMinutes ?? 0) >= 60
  if (!workout.restRecommended && !heavyYesterday) return { settings }

  const fillRatio = Math.max(0.5, settings.fillRatio - 0.1)
  if (fillRatio === settings.fillRatio) return { settings }

  const why = workout.restRecommended
    ? `${workout.streakDays}日続けてトレーニングしている`
    : `昨日${formatDuration(workout.yesterdayMinutes as number)}トレーニングした`

  return {
    settings: { ...settings, fillRatio },
    note: `${why}ので、今日の詰め込みの上限を${Math.round(settings.fillRatio * 100)}%から${Math.round(fillRatio * 100)}%に下げました。`,
  }
}

// ---------- 予定表に渡す形にそろえる ----------

export function taskToSchedulable(s: ScoredTask): Schedulable {
  return {
    kind: 'task',
    refId: s.task.id,
    title: s.task.title,
    todayMin: s.todayMin,
    dueDate: s.task.dueDate,
    dueTime: s.task.dueTime,
    reason: s.reasons[0] ?? '今日できる範囲で優先度が高い',
    critical: s.bucket === 'overdue' || s.bucket === 'urgent',
    counted: s.bucket !== 'optional',
  }
}

export function studyToSchedulable(s: ScoredStudy): Schedulable {
  return {
    kind: 'study',
    refId: s.node.id,
    title: s.path ? `${s.node.title}（${s.path}）` : s.node.title,
    todayMin: s.todayMin,
    // 試験日はタスクの締切と違って「その日までに仕上げる」なので、時刻は持たせない
    dueDate: s.exam?.date,
    reason: s.reasons[0] ?? '学習の優先順位が高い',
    critical: s.daysToExam != null && s.daysToExam >= 0 && s.daysToExam <= 3,
    counted: true,
  }
}

/**
 * タスクと学習項目をひとつの並びにする。
 *
 * priority.ts と study.ts のスコアは、どちらも「締切/試験日がいちばん重く、次に重要度」で
 * 同じくらいの幅 (おおむね 0〜250) に収まるように重みを決めてある。だからそのまま混ぜて並べられる。
 * 片方の重みを変えるときは、もう片方との釣り合いも見ること。
 *
 * 学習項目は数が多くなりがちなので、上位だけを今日の対象にする。
 * 全部渡すと「今日やりたいことの合計」が現実離れした数字になり、所見が意味を失う。
 */
export function mergeForSchedule(
  tasks: ScoredTask[],
  study: ScoredStudy[],
  workout: KintoreDay | undefined,
  settings: Settings,
): Schedulable[] {
  const items = [
    ...tasks.map((s) => ({ score: s.score, item: taskToSchedulable(s) })),
    ...study
      .slice(0, settings.studyPerDayMax)
      .map((s) => ({ score: s.score, item: studyToSchedulable(s) })),
  ]

  const w = workoutToSchedulable(workout)
  if (w) items.push(w)

  return items.sort((a, b) => b.score - a.score).map((x) => x.item)
}

/** 予定表の中で筋トレを指す id。筋トレログ側の記録とは紐づけない */
export const WORKOUT_REF_ID = 'workout'

/**
 * 筋トレを予定に入れる形にする。**メニューの中身は決めない。**
 * 種目・セット・重量は筋トレログの担当なので、エージェントは時間を空けるところまで。
 *
 * 点数は、締切のある仕事に割り込まない程度に置き、
 * 週の目標から遅れているほど上がるようにしてある。
 */
export function workoutToSchedulable(
  workout: KintoreDay | undefined,
): { score: number; item: Schedulable } | null {
  if (!workout?.available || !workout.plannedToday) return null

  const behind = Math.max(0, workout.daysPerWeek - workout.last7Count)
  const score = Math.min(90, 40 + behind * 8)

  return {
    score,
    item: {
      kind: 'workout',
      refId: WORKOUT_REF_ID,
      title: '筋トレ',
      todayMin: workout.estimateMin,
      reason: workout.planReason,
      critical: false,
      counted: true,
    },
  }
}

/**
 * 「今日の最重要 3 項目」。タスクと学習をまたいで選ぶ。
 * 任意のもの (締切が遠く重要度も低いタスク) は入れない。
 */
export function topThreeToday(ctx: TodayContext): Schedulable[] {
  return ctx.schedulable.filter((s) => s.counted).slice(0, 3)
}

// ---------- Claude に渡すテキスト ----------

/**
 * アプリの中に対話 AI を入れると API キーが端末に露出するので、
 * 深い相談はこれをコピーして外で行う、という切り分けにしている。
 */
export function buildContextText(ctx: TodayContext): string {
  const lines: string[] = []
  lines.push(`# 今日の状況 (${formatDate(ctx.date)} ${fromMinutes(ctx.now)} 時点)`)
  lines.push('')

  lines.push('## 動かせない予定')
  if (ctx.fixed.length === 0) lines.push('- なし')
  for (const f of ctx.fixed) {
    lines.push(`- ${f.start}〜${f.end} ${f.title}${f.placeName ? ` @${f.placeName}` : ''}`)
  }
  lines.push('')

  lines.push(`## 空き時間 (合計 ${formatDuration(ctx.availableMin)})`)
  if (ctx.slots.length === 0) lines.push('- なし')
  for (const s of ctx.slots) {
    lines.push(
      `- ${fromMinutes(s.startMin)}〜${fromMinutes(s.endMin)} (${formatDuration(minutesOf(s))})${s.label ? ` ${s.label}` : ''}`,
    )
  }
  lines.push('')

  lines.push('## 未完了のタスク')
  if (ctx.ranked.length === 0) lines.push('- なし')
  for (const s of ctx.ranked) {
    const due = s.task.dueDate
      ? `締切 ${s.task.dueDate}${s.task.dueTime ? ` ${s.task.dueTime}` : ''}`
      : '締切なし'
    lines.push(
      `- [${BUCKET_LABELS[s.bucket]}] ${s.task.title} (${AREA_LABELS[s.task.area]}) — ${due} / 今日${formatDuration(s.todayMin)} / 残り${formatDuration(s.task.estimateMin)} / 重要度${s.task.importance} / スコア${s.score}` +
        (s.reasons.length ? ` / 理由: ${s.reasons.join('、')}` : ''),
    )
  }

  if (ctx.examPlans.length > 0) {
    lines.push('')
    lines.push('## 試験')
    for (const p of ctx.examPlans) {
      lines.push(
        `- ${p.exam.title} (${p.exam.date}, あと${p.daysLeft}日) — 範囲${p.leaves.length}項目 / 習得${p.summary.counts.mastered} / 残り${formatDuration(p.requiredMin)} / 1日あたり${formatDuration(p.perDayMin)}`,
      )
      for (const f of p.findings) lines.push(`  - ${f}`)
    }
  }

  if (ctx.study.length > 0) {
    lines.push('')
    lines.push('## 学習の候補 (上位)')
    for (const s of ctx.study.slice(0, 10)) {
      lines.push(
        `- ${s.path ? `${s.path} / ` : ''}${s.node.title} — ${MASTERY_LABELS[s.mastery]} / 今日${formatDuration(s.todayMin)} / 重要度${s.node.importance} / スコア${s.score}` +
          (s.progress.accuracy != null
            ? ` / 正答率${Math.round(s.progress.accuracy * 100)}%`
            : '') +
          (s.progress.staleDays != null ? ` / ${s.progress.staleDays}日ぶり` : ' / 未着手') +
          (s.reasons.length ? ` / 理由: ${s.reasons.join('、')}` : ''),
      )
    }
  }

  if (ctx.selections.length > 0) {
    lines.push('')
    lines.push('## 就活の予定')
    for (const d of ctx.selections.slice(0, 12)) {
      lines.push(
        `- [${d.urgency === 'overdue' ? '期限切れ' : d.urgency === 'today' ? '今日' : `あと${d.daysLeft}日`}] ${selectionSummary(d)}` +
          (d.company ? ` / 選考段階 ${d.company.stage} / 志望度 ${d.company.interest}` : ''),
      )
    }
  }

  if (ctx.workout?.available) {
    const w = ctx.workout
    lines.push('')
    lines.push('## 筋トレ (正本は筋トレログ)')
    lines.push(
      `- 今日: ${w.doneToday ? `実施済み (${formatDuration(w.todayMinutes ?? 0)})` : w.plannedToday ? `予定あり (見込み ${formatDuration(w.estimateMin)})` : '予定なし'} — ${w.planReason}`,
    )
    lines.push(
      `- 直近7日 ${w.last7Count}回 / 週${w.daysPerWeek}回の目標 · 連続${w.streakDays}日` +
        (w.lastWorkoutOn ? ` · 最終 ${w.lastWorkoutOn}` : '') +
        (w.yesterdayMinutes != null ? ` · 昨日 ${formatDuration(w.yesterdayMinutes)}` : ''),
    )
    if (w.restRecommended) lines.push('- 休養を勧める状態')
  }

  if (ctx.easedNote) {
    lines.push('')
    lines.push(`## 今日の調整\n- ${ctx.easedNote}`)
  }

  if (ctx.plan) {
    lines.push('')
    lines.push('## いま組んである予定')
    for (const b of ctx.plan.blocks) {
      lines.push(`- ${b.start}〜${b.end} ${b.title}${b.doneAt ? ' (完了)' : ''}`)
    }
    if (ctx.plan.notes.length) {
      lines.push('')
      lines.push('### 生成時の所見')
      for (const n of ctx.plan.notes) lines.push(`- ${n}`)
    }
  }

  return lines.join('\n')
}

/** 予定表のうち、今の時刻に当たるブロック */
export function currentBlock(plan: DayPlan | undefined, now: number) {
  if (!plan) return undefined
  return plan.blocks.find((b) => toMinutes(b.start) <= now && now < toMinutes(b.end))
}
