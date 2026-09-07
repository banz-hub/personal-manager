/**
 * 生成した予定表を手で直す。
 *
 * 自動で組んだものが、いつも正しいわけではない。
 * 「この時間は集中できない」「ここは移動がある」といった事情は本人しか知らない。
 * ただし直した結果が壊れていては困るので、**重なりと時刻の逆転はここで防ぐ。**
 *
 * 作り直し (generatePlan) と違って、こちらは並びを保ったまま最小限だけ動かす。
 */

import type { DayPlan, PlanBlock } from '../types'
import type { Schedulable } from './scheduler'
import { fromMinutes, toMinutes } from './date'
import { newId } from './id'

/** 1 回の操作で動かす幅 (分) */
export const NUDGE_MIN = 15

function span(b: PlanBlock): number {
  return toMinutes(b.end) - toMinutes(b.start)
}

function sorted(blocks: PlanBlock[]): PlanBlock[] {
  return [...blocks].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
}

/** 重なっているコマが 1 つでもあるか */
export function hasOverlap(blocks: PlanBlock[]): boolean {
  const list = sorted(blocks)
  for (let i = 1; i < list.length; i++) {
    if (toMinutes(list[i].start) < toMinutes(list[i - 1].end)) return true
  }
  return false
}

/** コマを消す。完了済みは実績なので消さない */
export function removeBlock(plan: DayPlan, blockId: string): DayPlan {
  const target = plan.blocks.find((b) => b.id === blockId)
  if (!target || target.doneAt) return plan
  return { ...plan, blocks: plan.blocks.filter((b) => b.id !== blockId) }
}

/**
 * コマを前後にずらす。
 * ずらした結果ほかと重なる、または 0 時より前・24 時より後に出るなら、何もしない。
 */
export function nudgeBlock(plan: DayPlan, blockId: string, deltaMin: number): DayPlan {
  const target = plan.blocks.find((b) => b.id === blockId)
  if (!target || target.doneAt) return plan

  const start = toMinutes(target.start) + deltaMin
  const end = start + span(target)
  if (start < 0 || end > 24 * 60) return plan

  const moved: PlanBlock = { ...target, start: fromMinutes(start), end: fromMinutes(end) }
  const next = plan.blocks.map((b) => (b.id === blockId ? moved : b))
  if (hasOverlap(next)) return plan

  return { ...plan, blocks: sorted(next) }
}

/** コマの長さを変える。短くしすぎない・重ならないの 2 つだけ守る */
export function resizeBlock(plan: DayPlan, blockId: string, deltaMin: number): DayPlan {
  const target = plan.blocks.find((b) => b.id === blockId)
  if (!target || target.doneAt) return plan

  const length = span(target) + deltaMin
  if (length < 5) return plan

  const end = toMinutes(target.start) + length
  if (end > 24 * 60) return plan

  const resized: PlanBlock = { ...target, end: fromMinutes(end) }
  const next = plan.blocks.map((b) => (b.id === blockId ? resized : b))
  if (hasOverlap(next)) return plan

  return { ...plan, blocks: sorted(next) }
}

/**
 * 空いているところを探して、コマを足す。
 * 入る場所が無ければ null を返す (無理やり詰めない)。
 */
export function insertBlock(
  plan: DayPlan,
  item: Schedulable,
  dayStart: string,
  dayEnd: string,
): DayPlan | null {
  const from = toMinutes(dayStart)
  const to = toMinutes(dayEnd)
  const list = sorted(plan.blocks)

  // 既にあるコマの隙間を、早い順に見ていく
  let cursor = from
  for (const b of list) {
    const gap = toMinutes(b.start) - cursor
    if (gap >= item.todayMin) break
    cursor = Math.max(cursor, toMinutes(b.end))
  }
  if (cursor + item.todayMin > to) return null

  const block: PlanBlock = {
    id: newId('blk'),
    start: fromMinutes(cursor),
    end: fromMinutes(cursor + item.todayMin),
    kind: item.kind,
    taskId: item.kind === 'task' ? item.refId : undefined,
    nodeId: item.kind === 'study' ? item.refId : undefined,
    title: item.title,
    reason: '手で足したコマ',
  }

  const next = [...plan.blocks, block]
  if (hasOverlap(next)) return null

  return { ...plan, blocks: sorted(next) }
}

/** まだ予定に入っていないもの。足す候補として出す */
export function unplaced(plan: DayPlan, items: Schedulable[]): Schedulable[] {
  const placed = new Set(
    plan.blocks.flatMap((b) => [b.taskId, b.nodeId].filter(Boolean) as string[]),
  )
  return items.filter((i) => !placed.has(i.refId))
}
