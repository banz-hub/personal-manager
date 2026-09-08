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
 * 手で足すコマ。
 *
 * `Schedulable` と分けてあるのは、よてい帳の「やること・趣味」も
 * ここから足せるようにするため。あちらはエージェントのタスクでも学習項目でもないので、
 * 結びつけ先 (taskId / nodeId) を持たない。
 * `Schedulable` の refId をそのまま taskId に入れると、
 * 存在しないタスクを指すコマができてしまう。
 */
export interface InsertItem {
  kind: PlanBlock['kind']
  title: string
  minutes: number
  /** エージェントのタスクなら入れる */
  taskId?: string
  /** エージェントの学習項目なら入れる */
  nodeId?: string
  /** なぜこのコマがあるのか。押した本人にも、あとから見て分かるように */
  reason?: string
}

/**
 * `from`〜`to` の中で空いているいちばん早いところに、コマを足す。
 * 入る場所が無ければ null を返す (無理やり詰めない)。
 */
export function insertBlockAt(
  plan: DayPlan,
  item: InsertItem,
  from: number,
  to: number,
): DayPlan | null {
  const list = sorted(plan.blocks)

  // 既にあるコマの隙間を、早い順に見ていく
  let cursor = from
  for (const b of list) {
    if (toMinutes(b.end) <= from) continue
    const gap = toMinutes(b.start) - cursor
    if (gap >= item.minutes) break
    cursor = Math.max(cursor, toMinutes(b.end))
  }
  if (cursor + item.minutes > to) return null

  const block: PlanBlock = {
    id: newId('blk'),
    start: fromMinutes(cursor),
    end: fromMinutes(cursor + item.minutes),
    kind: item.kind,
    taskId: item.taskId,
    nodeId: item.nodeId,
    title: item.title,
    reason: item.reason ?? '手で足したコマ',
  }

  const next = [...plan.blocks, block]
  if (hasOverlap(next)) return null

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
  return insertBlockAt(
    plan,
    {
      kind: item.kind,
      title: item.title,
      minutes: item.todayMin,
      taskId: item.kind === 'task' ? item.refId : undefined,
      nodeId: item.kind === 'study' ? item.refId : undefined,
    },
    toMinutes(dayStart),
    toMinutes(dayEnd),
  )
}

/** まだ予定に入っていないもの。足す候補として出す */
export function unplaced(plan: DayPlan, items: Schedulable[]): Schedulable[] {
  const placed = new Set(
    plan.blocks.flatMap((b) => [b.taskId, b.nodeId].filter(Boolean) as string[]),
  )
  return items.filter((i) => !placed.has(i.refId))
}

/**
 * 開始時刻を直接決める。
 *
 * ドラッグではなく時刻を選ばせるのは、iPhone で確実に動かせるようにするため。
 * HTML5 のドラッグはタッチで動かず、自前で実装すると取りこぼしが出る。
 * 時刻の入力なら片手でも正確に決められる。
 */
export function setBlockStart(plan: DayPlan, blockId: string, start: string): DayPlan {
  const target = plan.blocks.find((b) => b.id === blockId)
  if (!target || target.doneAt) return plan

  const from = toMinutes(start)
  const end = from + span(target)
  if (Number.isNaN(from) || from < 0 || end > 24 * 60) return plan

  const moved: PlanBlock = { ...target, start: fromMinutes(from), end: fromMinutes(end) }
  const next = plan.blocks.map((b) => (b.id === blockId ? moved : b))
  if (hasOverlap(next)) return plan

  return { ...plan, blocks: sorted(next) }
}

/**
 * その時刻から置けるか。置けない理由も返す。
 * 入力しながら「なぜ動かないのか」が分かるようにするため。
 */
export function whyCannotStart(
  plan: DayPlan,
  blockId: string,
  start: string,
): string | null {
  const target = plan.blocks.find((b) => b.id === blockId)
  if (!target) return null
  if (target.doneAt) return '完了したコマは動かせません'

  const from = toMinutes(start)
  if (Number.isNaN(from)) return null
  if (from + span(target) > 24 * 60) return '日をまたぐので置けません'

  const moved = { ...target, start: fromMinutes(from), end: fromMinutes(from + span(target)) }
  const clash = plan.blocks.find(
    (b) =>
      b.id !== blockId &&
      toMinutes(moved.start) < toMinutes(b.end) &&
      toMinutes(b.start) < toMinutes(moved.end),
  )
  return clash ? `「${clash.title}」と重なります` : null
}

/** 入らなかったときの言い分け。理由を言わずに何も起きないのがいちばん困る */
export function cannotFit(title: string): string {
  return `「${title}」を入れる空きがありません。ほかのコマを短くするか、消してから足してください。`
}
