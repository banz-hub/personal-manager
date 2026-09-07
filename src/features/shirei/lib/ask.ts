/**
 * 「今日どうすればいい？」に答える (第 24 条・第 47 条)。
 *
 * 中身は LLM ではなく、これまで作った判断エンジンへの振り分け。
 * 聞かれたことに近いものを選んで、**何をするかだけでなく、なぜかまで**返す。
 *
 * 分からない聞き方をされたときに、それらしい作り話をしない。
 * 答えられる範囲を並べて、聞き直してもらう。
 */

import { AREA_LABELS, MASTERY_LABELS, STAGE_LABELS } from '../types'
import { formatDuration, fromMinutes } from './date'
import { nextActionFor } from './jobhunt'
import { BUCKET_LABELS } from './priority'
import { minutesOf, workBlocks } from './scheduler'
import type { TodayContext } from './today'

export type Topic = 'today' | 'plan' | 'deadline' | 'study' | 'jobhunt' | 'workout' | 'unknown'

interface Rule {
  topic: Topic
  pattern: RegExp
}

/** 上から順に当てるので、細かいものを先に置く */
const RULES: Rule[] = [
  { topic: 'workout', pattern: /筋トレ|トレーニング|運動|ジム|休養/ },
  { topic: 'jobhunt', pattern: /就活|ES|エントリー|面接|説明会|企業|選考|内定/i },
  { topic: 'study', pattern: /勉強|学習|試験|テスト|復習|科目|範囲/ },
  { topic: 'deadline', pattern: /締切|しめきり|期限|間に合|やばい|急ぎ/ },
  { topic: 'plan', pattern: /予定|何時|時間割|スケジュール|組んで|作って/ },
  { topic: 'today', pattern: /今日|いま|何を|なにを|どうすれ|どうしたら|優先/ },
]

export function topicOf(question: string): Topic {
  for (const r of RULES) if (r.pattern.test(question)) return r.topic
  return 'unknown'
}

export interface Answer {
  topic: Topic
  /** 見出しの一文 */
  headline: string
  /** 本文。1 行 1 項目 */
  lines: string[]
  /** 続けて見るとよい画面 */
  to?: string
}

export function ask(question: string, ctx: TodayContext): Answer {
  const topic = topicOf(question)
  switch (topic) {
    case 'plan':
      return planAnswer(ctx)
    case 'deadline':
      return deadlineAnswer(ctx)
    case 'study':
      return studyAnswer(ctx)
    case 'jobhunt':
      return jobhuntAnswer(ctx)
    case 'workout':
      return workoutAnswer(ctx)
    case 'today':
      return todayAnswer(ctx)
    default:
      return unknownAnswer()
  }
}

// ---------- 今日どうすればいい？ ----------

function todayAnswer(ctx: TodayContext): Answer {
  const lines: string[] = []
  const top = ctx.schedulable.filter((s) => s.counted).slice(0, 3)

  if (top.length === 0) {
    return {
      topic: 'today',
      headline: '今日やるべきものが登録されていません。',
      lines: ['まずタスクを 1 つ入れてください。締切と所要時間があると順位が決まります。'],
      to: '/tasks',
    }
  }

  const first = top[0]
  const headline = `まず「${first.title}」から。${first.reason}。目安は${formatDuration(first.todayMin)}です。`

  lines.push(`使える時間は ${formatDuration(ctx.availableMin)}。`)
  if (ctx.fixed.length > 0) {
    lines.push(
      `動かせない予定: ${ctx.fixed.map((f) => `${f.start}〜${f.end} ${f.title}`).join(' / ')}`,
    )
  }
  lines.push(
    `この順にやるのがおすすめです: ${top.map((s, i) => `${i + 1}. ${s.title}（${formatDuration(s.todayMin)}）`).join(' ')}`,
  )

  const overdue = ctx.buckets.overdue
  if (overdue.length > 0) {
    lines.push(
      `ただし期限切れが${overdue.length}件あります（${overdue.map((s) => s.task.title).join('、')}）。やるか、やめるかを先に決めてください。`,
    )
  }
  for (const n of ctx.adjustNotes) lines.push(n)
  if (!ctx.plan) lines.push('「今日の予定を作る」を押すと、この順で時間割に落とします。')

  return { topic: 'today', headline, lines }
}

// ---------- 予定は？ ----------

function planAnswer(ctx: TodayContext): Answer {
  if (!ctx.plan) {
    return {
      topic: 'plan',
      headline: 'まだ今日の予定表を作っていません。',
      lines: [
        `使える時間は ${formatDuration(ctx.availableMin)} です。`,
        '「今日の予定を作る」を押すと、優先順位の高いものから時間に落とします。',
      ],
    }
  }

  const blocks = workBlocks(ctx.plan)
  const done = blocks.filter((b) => b.doneAt).length
  const next = blocks.find((b) => !b.doneAt)

  return {
    topic: 'plan',
    headline: next
      ? `次は ${next.start} から「${next.title}」です。`
      : '今日の予定はすべて終わっています。',
    lines: [
      ...blocks.map(
        (b) => `${b.start}〜${b.end} ${b.title}${b.doneAt ? '（完了）' : ''}`,
      ),
      `${blocks.length}件のうち${done}件が完了。`,
      ...ctx.plan.notes,
    ],
  }
}

// ---------- 締切は？ ----------

function deadlineAnswer(ctx: TodayContext): Answer {
  const lines: string[] = []
  const { overdue, urgent, important } = ctx.buckets

  for (const [label, list] of [
    ['期限切れ', overdue],
    ['今日が締切', urgent],
    ['今週が締切', important],
  ] as const) {
    for (const s of list) {
      lines.push(
        `[${label}] ${s.task.title}（${AREA_LABELS[s.task.area]}・${formatDuration(s.todayMin)}）${s.task.dueTime ? ` ${s.task.dueTime}まで` : ''}`,
      )
    }
  }

  for (const d of ctx.selections.filter((x) => x.urgency !== 'later')) {
    lines.push(
      `[就活] ${d.label} — ${d.event.date}${d.event.time ? ` ${d.event.time}` : ''}（${d.daysLeft < 0 ? '過ぎている' : d.daysLeft === 0 ? '今日' : `あと${d.daysLeft}日`}）`,
    )
  }

  const exam = ctx.examPlans[0]
  if (exam && exam.daysLeft <= 7) {
    lines.push(`[試験] ${exam.exam.title} まであと${exam.daysLeft}日。1日${formatDuration(exam.perDayMin)}が要ります。`)
  }

  if (lines.length === 0) {
    return {
      topic: 'deadline',
      headline: '差し迫った締切はありません。',
      lines: ['今週が締切のものも無いので、先の課題を進めるのに向いた日です。'],
    }
  }

  const worst = overdue.length > 0 ? '期限切れがあります。' : urgent.length > 0 ? '今日が締切のものがあります。' : '今週の締切があります。'
  return { topic: 'deadline', headline: worst, lines }
}

// ---------- 勉強は？ ----------

function studyAnswer(ctx: TodayContext): Answer {
  if (ctx.study.length === 0) {
    return {
      topic: 'study',
      headline: '学習項目が登録されていません。',
      lines: ['学習の画面で、科目 → 単元 → 項目 と足していくと、順位がつきます。'],
      to: '/study',
    }
  }

  const top = ctx.study[0]
  const lines: string[] = []

  for (const p of ctx.examPlans.slice(0, 2)) {
    lines.push(`${p.exam.title}（あと${p.daysLeft}日）: ${p.findings[0] ?? ''}`)
  }

  lines.push(
    `今日の候補: ${ctx.study
      .slice(0, 4)
      .map((s) => `${s.node.title}（${MASTERY_LABELS[s.mastery]}・${formatDuration(s.todayMin)}）`)
      .join(' / ')}`,
  )

  return {
    topic: 'study',
    headline: `${top.path ? `${top.path} の ` : ''}「${top.node.title}」から。${top.reasons[0] ?? ''}。`,
    lines,
    to: '/study',
  }
}

// ---------- 就活は？ ----------

function jobhuntAnswer(ctx: TodayContext): Answer {
  if (ctx.selections.length === 0) {
    return {
      topic: 'jobhunt',
      headline: '就活の予定が登録されていません。',
      lines: ['就活の画面で企業を足し、ES締切や面接の日を入れると、締切を見張ります。'],
      to: '/job',
    }
  }

  const next = ctx.selections[0]
  const lines = ctx.selections.slice(0, 6).map(
    (d) =>
      `${d.label} — ${d.event.date}${d.event.time ? ` ${d.event.time}` : ''}（${d.daysLeft < 0 ? '過ぎている' : d.daysLeft === 0 ? '今日' : `あと${d.daysLeft}日`}）` +
      (d.company ? ` / ${STAGE_LABELS[d.company.stage]}` : ''),
  )

  const action = next.company ? nextActionFor(next.company) : null
  if (action) lines.push(`次にやること: ${action}`)

  return {
    topic: 'jobhunt',
    headline: `いちばん近いのは ${next.label}（${next.daysLeft < 0 ? '期限切れ' : `あと${next.daysLeft}日`}）です。`,
    lines,
    to: '/job',
  }
}

// ---------- 筋トレは？ ----------

function workoutAnswer(ctx: TodayContext): Answer {
  const w = ctx.workout
  if (!w?.available) {
    return {
      topic: 'workout',
      headline: '筋トレログを読めていません。',
      lines: ['同じオリジン（banz-hub.github.io）で開いているか確認してください。'],
    }
  }

  return {
    topic: 'workout',
    headline: w.doneToday
      ? `今日はもう終えています（${formatDuration(w.todayMinutes ?? 0)}）。`
      : w.plannedToday
        ? `今日はやる日です。見込みは${formatDuration(w.estimateMin)}。`
        : '今日は休んでよい日です。',
    lines: [
      w.planReason,
      `直近7日で${w.last7Count}回 / 週${w.daysPerWeek}回の目標・連続${w.streakDays}日` +
        (w.lastWorkoutOn ? `・最終 ${w.lastWorkoutOn}` : ''),
      'メニューは筋トレログの担当です。エージェントは時間を空けるところまでです。',
    ],
  }
}

// ---------- 分からないとき ----------

function unknownAnswer(): Answer {
  return {
    topic: 'unknown',
    headline: 'うまく聞き取れませんでした。',
    lines: [
      '答えられるのはこのあたりです:',
      '「今日どうすればいい？」… 今日の行動の順番と理由',
      '「今日の予定は？」… 組んである時間割',
      '「締切は？」… 期限切れ・今日・今週の締切',
      '「勉強は？」… 試験からの逆算と、今日やる学習項目',
      '「就活は？」… 近い選考の予定と次にやること',
      '「筋トレは？」… 今日やる日かどうか',
    ],
  }
}

/** 例として出す聞き方 */
export const EXAMPLES = [
  '今日どうすればいい？',
  '締切やばい？',
  '勉強は何から？',
  '就活の予定は？',
  '今日の予定は？',
]

/** 空き時間の言い換え。答えの中で使う */
export function slotSummary(ctx: TodayContext): string {
  if (ctx.slots.length === 0) return 'これから使える空き時間はありません。'
  return ctx.slots
    .map((s) => `${fromMinutes(s.startMin)}〜${fromMinutes(s.endMin)}（${formatDuration(minutesOf(s))}）`)
    .join(' / ')
}

export function bucketLabel(b: keyof typeof BUCKET_LABELS): string {
  return BUCKET_LABELS[b]
}
