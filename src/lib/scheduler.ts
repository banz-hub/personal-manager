/**
 * 今日の時間割を組み立てる。
 *
 * 大事なのは「並べること」ではなく「詰め込まないこと」。
 * 空き時間をすべて埋めた予定は必ず崩れるので、
 *   - 空き時間の一定割合 (既定 80%) までしか作業を入れない
 *   - 続けて作業した時間が一定を超えたら休憩を挟む
 *   - 各コマの余りはバッファとして残す
 * を守る。守れなかったことは notes に理由として残す。
 */

import type { DayPlan, PlanBlock, Settings } from '../types'
import { formatDuration, fromMinutes, toMinutes } from './date'
import { newId } from './id'
import type { ScoredTask } from './priority'

/** 予定の入っていない時間帯 */
export interface FreeSlot {
  startMin: number
  endMin: number
  /** 「大学のあと」など、どこの隙間か分かる名前 */
  label?: string
}

export interface GenerateInput {
  slots: FreeSlot[]
  ranked: ScoredTask[]
  settings: Settings
  /** YYYY-MM-DD */
  today: string
  /** 0 時からの分。これより前の時間には置かない */
  now: number
}

export function minutesOf(slot: FreeSlot): number {
  return Math.max(0, slot.endMin - slot.startMin)
}

/**
 * 過ぎた時間を落とし、短すぎる隙間を捨てる。
 * 「もう 19 時なのに 18 時開始の予定を出す」のを防ぐための前処理。
 */
export function usableSlots(slots: FreeSlot[], now: number, minSlotMin: number): FreeSlot[] {
  return slots
    .map((s) => ({ ...s, startMin: Math.max(s.startMin, now) }))
    .filter((s) => minutesOf(s) >= minSlotMin)
    .sort((a, b) => a.startMin - b.startMin)
}

/** そのタスクを cursor から始めて、締切に間に合うか */
function fitsDeadline(scored: ScoredTask, cursor: number, minutes: number, today: string): boolean {
  const { dueDate, dueTime } = scored.task
  if (!dueDate || dueDate !== today || !dueTime) return true
  return cursor + minutes <= toMinutes(dueTime)
}

function block(patch: Omit<PlanBlock, 'id' | 'start' | 'end'> & { from: number; to: number }): PlanBlock {
  const { from, to, ...rest } = patch
  return { id: newId('blk'), start: fromMinutes(from), end: fromMinutes(to), ...rest }
}

export function generatePlan(input: GenerateInput): DayPlan {
  const { ranked, settings, today, now } = input
  const slots = usableSlots(input.slots, now, settings.minSlotMin)

  const freeMin = slots.reduce((sum, s) => sum + minutesOf(s), 0)
  // ここが「詰め込みすぎない」の本体。残りはバッファとして必ず空ける
  const budget = Math.floor(freeMin * settings.fillRatio)

  const blocks: PlanBlock[] = []
  const notes: string[] = []
  const placed = new Set<string>()
  let used = 0

  for (const slot of slots) {
    let cursor = slot.startMin
    let sinceBreak = 0

    for (;;) {
      const remainingInSlot = slot.endMin - cursor
      if (remainingInSlot < 5 || used >= budget) break

      const next = ranked.find((s) => {
        if (placed.has(s.task.id)) return false
        if (s.todayMin > remainingInSlot) return false
        if (used + s.todayMin > budget) return false
        return fitsDeadline(s, cursor, s.todayMin, today)
      })
      if (!next) break

      // 続けて作業しすぎたら休憩を挟む。休憩を入れると入らなくなるならそのまま続ける
      if (
        sinceBreak >= settings.workBeforeBreakMin &&
        cursor + settings.breakMin + next.todayMin <= slot.endMin
      ) {
        blocks.push(
          block({
            from: cursor,
            to: cursor + settings.breakMin,
            kind: 'break',
            title: '休憩',
            reason: `${formatDuration(sinceBreak)}続けたので一度離れる`,
          }),
        )
        cursor += settings.breakMin
        sinceBreak = 0
      }

      blocks.push(
        block({
          from: cursor,
          to: cursor + next.todayMin,
          kind: 'task',
          taskId: next.task.id,
          title: next.task.title,
          reason: next.reasons[0] ?? '今日できる範囲で優先度が高い',
        }),
      )
      cursor += next.todayMin
      used += next.todayMin
      sinceBreak += next.todayMin
      placed.add(next.task.id)
    }

    const left = slot.endMin - cursor
    if (left >= 5) {
      blocks.push(
        block({
          from: cursor,
          to: slot.endMin,
          kind: 'buffer',
          title: '予備',
          reason: '予定どおりに進まなかったぶんを吸収する時間',
        }),
      )
    }
  }

  blocks.sort((a, b) => toMinutes(a.start) - toMinutes(b.start))

  // --- 所見をつくる ---
  const demand = ranked
    .filter((s) => s.bucket !== 'optional')
    .reduce((sum, s) => sum + s.todayMin, 0)

  if (freeMin === 0) {
    notes.push('今日は空き時間がありません。予定を見直すか、明日に回してください。')
  } else if (demand > budget) {
    notes.push(
      `やりたいことの合計は${formatDuration(demand)}ですが、今日の空き時間は${formatDuration(freeMin)}です。` +
        `崩れない範囲として${formatDuration(budget)}まで入れ、優先度の高いものから割り当てました。`,
    )
  }

  const unplaced = ranked.filter(
    (s) => !placed.has(s.task.id) && (s.bucket === 'overdue' || s.bucket === 'urgent'),
  )
  for (const s of unplaced) {
    notes.push(
      `「${s.task.title}」は今日の空き時間に入りませんでした。${
        s.leftDays !== null && s.leftDays <= 0
          ? '締切が近いので、他の予定を動かすか範囲を削る判断が要ります。'
          : '明日に回すことになります。'
      }`,
    )
  }

  const overdueCount = ranked.filter((s) => s.bucket === 'overdue').length
  if (overdueCount > 0) {
    notes.push(`期限切れが${overdueCount}件あります。やるか、やめるかを先に決めてください。`)
  }

  return {
    id: today,
    date: today,
    blocks,
    generatedAt: new Date().toISOString(),
    freeMin,
    fillRatio: freeMin > 0 ? used / freeMin : 0,
    notes,
  }
}

/**
 * すでに埋まっている時間を空き時間から差し引く。
 * 予定を作り直すとき、完了済みのブロックの時間に別のタスクを重ねないために使う。
 */
export function subtractBusy(slots: FreeSlot[], busy: Array<{ from: number; to: number }>): FreeSlot[] {
  let out = [...slots]
  for (const b of busy) {
    const next: FreeSlot[] = []
    for (const s of out) {
      if (b.to <= s.startMin || b.from >= s.endMin) {
        next.push(s)
        continue
      }
      // 前後に残る部分だけを拾う
      if (b.from > s.startMin) next.push({ ...s, endMin: b.from })
      if (b.to < s.endMin) next.push({ ...s, startMin: b.to })
    }
    out = next
  }
  return out.filter((s) => minutesOf(s) > 0).sort((a, b) => a.startMin - b.startMin)
}

/** 予定表のうち、実際に作業に充てた分数 */
export function workMinutes(plan: DayPlan): number {
  return plan.blocks
    .filter((b) => b.kind === 'task')
    .reduce((sum, b) => sum + (toMinutes(b.end) - toMinutes(b.start)), 0)
}

/** 予定表に入っているタスクの id */
export function plannedTaskIds(plan: DayPlan): string[] {
  return plan.blocks.filter((b) => b.kind === 'task' && b.taskId).map((b) => b.taskId as string)
}
