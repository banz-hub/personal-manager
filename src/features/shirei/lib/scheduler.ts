/**
 * 予定表（DayPlan）を読むための小さな道具。
 *
 * 以前はここで空き時間から予定表を自動で組んでいた（詰め込みの上限・休憩の差し込み）。
 * 「時間の割り当てはしない」と決めて 1 ページ目を「今日やること」のリストに変えたので、
 * 組み立ての部分は外した。残っているのは、**前に作った予定表を
 * ふりかえり・集計で読む**ための関数だけ。
 */

import type { SpotKind } from '../../yotei/types'
import type { DayPlan, PlanBlock } from '../types'
import { toMinutes } from './date'

/** 予定の入っていない時間帯。よてい帳の橋が返す形 */
export interface FreeSlot {
  startMin: number
  endMin: number
  /** 「大学のあと」など、どこの隙間か分かる名前 */
  label?: string
  /** その時間に居そうな場所 */
  spot?: SpotKind
  /** 「自宅」「大学」など、上を人が読む形にしたもの */
  placeLabel?: string
}

/** 予定表のうち、実際に作業に充てた分数 (タスクと学習の合計) */
export function workMinutes(plan: DayPlan): number {
  return workBlocks(plan).reduce((sum, b) => sum + (toMinutes(b.end) - toMinutes(b.start)), 0)
}

/** 予定表に入っているタスクの id */
export function plannedTaskIds(plan: DayPlan): string[] {
  return plan.blocks.filter((b) => b.kind === 'task' && b.taskId).map((b) => b.taskId as string)
}

/** 予定表に入っている学習項目の id */
export function plannedNodeIds(plan: DayPlan): string[] {
  return plan.blocks.filter((b) => b.kind === 'study' && b.nodeId).map((b) => b.nodeId as string)
}

/** 予定表に入っている作業のコマ (休憩と予備を除く) */
export function workBlocks(plan: DayPlan): PlanBlock[] {
  return plan.blocks.filter(
    (b) => b.kind === 'task' || b.kind === 'study' || b.kind === 'workout',
  )
}
