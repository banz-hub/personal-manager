/**
 * 完了記録・未完了の繰越・日次レビュー。
 *
 * レビューの目的は反省させることではなく、次の計画の精度を上げること。
 * だから所見は「できなかった」ではなく「次はこうする」で書く。
 */

import type { DailyReview, DayPlan, Task, TaskLog } from '../types'
import { AREA_LABELS } from '../types'
import { formatDuration, toMinutes } from './date'
import { newId } from './id'
import { plannedTaskIds } from './scheduler'

// ---------- 完了の記録 ----------

export interface CompletionResult {
  task: Task
  log: TaskLog
}

/**
 * ブロックを 1 つ終えたときの記録。
 *
 * chunkMin のある長期タスクは、1 回やっても終わりではないので
 * 残りの見積もりから引くだけにして、0 になったときに完了にする。
 */
export function completeWork(
  task: Task,
  actualMin: number,
  plannedMin: number,
  date: string,
  finish: boolean,
): CompletionResult {
  const remaining = Math.max(0, task.estimateMin - actualMin)
  const chunked = task.chunkMin != null && task.chunkMin < task.estimateMin
  const done = finish || (!chunked && remaining === 0) || (!task.recurring && remaining === 0)

  return {
    task: {
      ...task,
      status: done ? 'done' : 'doing',
      estimateMin: task.recurring ? task.estimateMin : remaining,
      startedAt: task.startedAt ?? new Date().toISOString(),
      doneAt: done ? new Date().toISOString() : task.doneAt,
      lastWorkedOn: date,
    },
    log: {
      id: newId('log'),
      taskId: task.id,
      date,
      area: task.area,
      plannedMin,
      actualMin,
      createdAt: new Date().toISOString(),
    },
  }
}

// ---------- 繰越 ----------

export interface CarryOverResult {
  tasks: Task[]
  /** 繰り越したタスクの id */
  carried: string[]
}

/**
 * その日の予定に入っていたのに終わらなかったタスクを翌日へ送る。
 * 締切を勝手に動かすことはしない。先送り回数だけ増やして、
 * 次の日の優先順位が自然に上がるようにする。
 */
export function carryOver(tasks: Task[], plan: DayPlan | undefined, date: string): CarryOverResult {
  if (!plan) return { tasks, carried: [] }
  const planned = new Set(plannedTaskIds(plan))
  const carried: string[] = []

  const next = tasks.map((t) => {
    if (!planned.has(t.id)) return t
    if (t.status === 'done' || t.status === 'dropped') return t
    // 同じ日に二重に数えない
    if (t.deferredOn === date) return t
    carried.push(t.id)
    return { ...t, deferCount: (t.deferCount ?? 0) + 1, deferredOn: date }
  })

  return { tasks: next, carried }
}

// ---------- 日次レビュー ----------

export interface ReviewInput {
  date: string
  plan?: DayPlan
  tasks: Task[]
  /** その日のログ */
  logs: TaskLog[]
}

/** 見積もりと実績のズレが「大きい」とみなす比 */
const OVERRUN = 1.2
const UNDERRUN = 0.6

export function buildReview(input: ReviewInput): DailyReview {
  const { date, plan, tasks, logs } = input
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const plannedIds = plan ? plannedTaskIds(plan) : []

  const doneTaskIds = plannedIds.filter((id) => byId.get(id)?.status === 'done')
  const workedIds = new Set(logs.map((l) => l.taskId))
  const undoneTaskIds = plannedIds.filter((id) => {
    const t = byId.get(id)
    return t != null && t.status !== 'done' && t.status !== 'dropped'
  })
  const deferredTaskIds = undoneTaskIds.filter((id) => !workedIds.has(id))

  const plannedMin = plan
    ? plan.blocks
        .filter((b) => b.kind === 'task')
        .reduce((sum, b) => sum + (toMinutes(b.end) - toMinutes(b.start)), 0)
    : 0
  const actualMin = logs.reduce((sum, l) => sum + l.actualMin, 0)

  return {
    id: date,
    date,
    doneTaskIds,
    undoneTaskIds,
    deferredTaskIds,
    plannedMin,
    actualMin,
    findings: analyze({ plannedIds, doneTaskIds, undoneTaskIds, deferredTaskIds, plannedMin, actualMin, logs, byId }),
    createdAt: new Date().toISOString(),
  }
}

interface AnalyzeInput {
  plannedIds: string[]
  doneTaskIds: string[]
  undoneTaskIds: string[]
  deferredTaskIds: string[]
  plannedMin: number
  actualMin: number
  logs: TaskLog[]
  byId: Map<string, Task>
}

/**
 * 「なぜ予定どおり進まなかったのか」を、記録から言える範囲で挙げる。
 * 憶測は書かない。データから言えないことは書かない。
 */
function analyze(a: AnalyzeInput): string[] {
  const out: string[] = []

  if (a.plannedIds.length === 0) {
    out.push('今日は予定を作っていません。朝に「今日の予定を作る」を押すと、空き時間から組み立てます。')
    return out
  }

  const rate = a.doneTaskIds.length / a.plannedIds.length

  if (rate === 1) {
    out.push(`予定した${a.plannedIds.length}件をすべて終えました。明日も同じ配分で組めます。`)
  } else {
    out.push(
      `予定${a.plannedIds.length}件のうち${a.doneTaskIds.length}件が完了、${a.undoneTaskIds.length}件が未完了です。`,
    )
  }

  // 見積もりのズレ。次の見積もりに効く材料なので、具体的な数字で書く
  const overruns = a.logs.filter((l) => l.plannedMin > 0 && l.actualMin / l.plannedMin >= OVERRUN)
  if (overruns.length > 0) {
    const worst = overruns.sort((x, y) => y.actualMin / y.plannedMin - x.actualMin / x.plannedMin)[0]
    const t = a.byId.get(worst.taskId)
    out.push(
      `「${t?.title ?? '不明なタスク'}」は${formatDuration(worst.plannedMin)}の予定に対して${formatDuration(worst.actualMin)}かかりました。` +
        'この記録は次回の見積もりに自動で反映されます。',
    )
  }

  const underruns = a.logs.filter((l) => l.plannedMin > 0 && l.actualMin / l.plannedMin <= UNDERRUN)
  if (underruns.length > 0 && overruns.length === 0) {
    out.push('見積もりより早く終わったものがあります。次回はもう少し詰めて組めます。')
  }

  if (a.deferredTaskIds.length > 0) {
    const titles = a.deferredTaskIds
      .map((id) => a.byId.get(id)?.title)
      .filter(Boolean)
      .slice(0, 3)
      .join('、')
    out.push(`手をつけられなかったのは${titles}です。明日の優先順位を上げて先に置きます。`)
  }

  // 実績が予定の半分以下 = 時間そのものが取れていない。詰め込みが原因のことが多い
  if (a.plannedMin > 0 && a.actualMin < a.plannedMin * 0.5) {
    out.push(
      `作業できたのは${formatDuration(a.actualMin)}で、予定の${formatDuration(a.plannedMin)}の半分以下でした。` +
        '予定の量が多すぎたか、開始が遅かった可能性があります。明日は上位3件に絞ることを勧めます。',
    )
  }

  // 分野の偏りは、本人が気づきにくいので出す
  const byArea = new Map<string, number>()
  for (const l of a.logs) byArea.set(l.area, (byArea.get(l.area) ?? 0) + l.actualMin)
  if (byArea.size > 0) {
    const line = [...byArea.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(([area, min]) => `${AREA_LABELS[area as keyof typeof AREA_LABELS] ?? area} ${formatDuration(min)}`)
      .join(' / ')
    out.push(`内訳: ${line}`)
  }

  return out
}
