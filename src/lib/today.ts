/**
 * 今日の状況をひとまとめにする。
 * 画面はこの結果を並べるだけにして、判断はすべてここと priority / scheduler に置く。
 */

import type { DayPlan, Task, TaskLog } from '../types'
import { AREA_LABELS } from '../types'
import type { FixedItem } from './bridge/yoteicho'
import { formatDate, formatDuration, fromMinutes, toMinutes } from './date'
import type { Bucket, ScoredTask } from './priority'
import { BUCKET_LABELS, groupByBucket, rankTasks } from './priority'
import type { FreeSlot } from './scheduler'
import { minutesOf, usableSlots } from './scheduler'

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
  plan?: DayPlan
}

export interface BuildInput {
  date: string
  now: number
  tasks: Task[]
  logs: TaskLog[]
  fixed: FixedItem[]
  slots: FreeSlot[]
  minSlotMin: number
  plan?: DayPlan
}

export function buildToday(input: BuildInput): TodayContext {
  const slots = usableSlots(input.slots, input.now, input.minSlotMin)
  const availableMin = slots.reduce((sum, s) => sum + minutesOf(s), 0)
  const ranked = rankTasks({
    tasks: input.tasks,
    logs: input.logs,
    today: input.date,
    now: input.now,
    availableMin,
  })
  return {
    date: input.date,
    now: input.now,
    fixed: input.fixed,
    slots,
    availableMin,
    ranked,
    buckets: groupByBucket(ranked),
    plan: input.plan,
  }
}

/**
 * Claude に貼るための今日の状況。
 *
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
