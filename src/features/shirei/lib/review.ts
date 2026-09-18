/**
 * 完了記録・未完了の繰越・日次レビュー。
 *
 * レビューの目的は反省させることではなく、次の計画の精度を上げること。
 * だから所見は「できなかった」ではなく「次はこうする」で書く。
 */

import type {
  DailyReview,
  DayPlan,
  Mastery,
  StudyNode,
  StudySession,
  Task,
  TaskLog,
} from '../types'
import { AREA_LABELS, MASTERY_LABELS } from '../types'
import { formatDuration, toMinutes } from './date'
import { newId } from './id'
import { plannedNodeIds, plannedTaskIds, workBlocks } from './scheduler'
import { areaOf } from './study'

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

export interface StudyCompletionResult {
  node: StudyNode
  session: StudySession
}

/**
 * 学習を 1 回終えたときの記録。
 *
 * 理解度は本人が選んだときだけ更新する。時間を使ったからといって
 * 勝手に「理解した」ことにはしない。
 */
export function completeStudy(
  node: StudyNode,
  actualMin: number,
  date: string,
  mastery?: Mastery,
  score?: { correct: number; attempted: number },
): StudyCompletionResult {
  return {
    node: mastery ? { ...node, mastery } : node,
    session: {
      id: newId('ses'),
      nodeId: node.id,
      date,
      minutes: actualMin,
      mastery,
      correct: score?.correct,
      attempted: score?.attempted,
      createdAt: new Date().toISOString(),
    },
  }
}

// ---------- 日次レビュー ----------

export interface ReviewInput {
  date: string
  /** 前の版で自動で組んでいた予定表。残っている日だけ */
  plan?: DayPlan
  /** その日の「やること」に入れたタスクの id。いまはこちらが本線 */
  listed?: string[]
  tasks: Task[]
  /** その日のログ */
  logs: TaskLog[]
  nodes: StudyNode[]
  /** その日の学習記録 */
  sessions: StudySession[]
  /**
   * その日の筋トレ。正本は筋トレログなので、読んだ値を写すだけ。
   * 連携が使えない日は渡さない。
   */
  workout?: { minutes: number; done: boolean }
}

/** 見積もりと実績のズレが「大きい」とみなす比 */
const OVERRUN = 1.2
const UNDERRUN = 0.6

export function buildReview(input: ReviewInput): DailyReview {
  const { date, plan, listed, tasks, logs, nodes, sessions, workout } = input
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const plannedIds = [...new Set([...(listed ?? []), ...(plan ? plannedTaskIds(plan) : [])])]
  const plannedNodes = plan ? plannedNodeIds(plan) : []

  // 学習のタスクは終わらないので、その日のぶん済みの印で見る
  const isDone = (id: string) => {
    const t = byId.get(id)
    return t != null && (t.status === 'done' || (t.study === true && t.checkedOn === date))
  }
  const doneTaskIds = plannedIds.filter(isDone)
  const workedIds = new Set(logs.map((l) => l.taskId))
  const undoneTaskIds = plannedIds.filter((id) => {
    const t = byId.get(id)
    return t != null && !isDone(id) && t.status !== 'dropped'
  })
  const deferredTaskIds = undoneTaskIds.filter((id) => !workedIds.has(id))

  // 学習は「終わり」が無いので、記録がついたかどうかで見る
  const studiedIds = new Set(sessions.map((s) => s.nodeId))
  const doneNodeIds = plannedNodes.filter((id) => studiedIds.has(id))
  const undoneNodeIds = plannedNodes.filter((id) => !studiedIds.has(id))

  const plannedMin = plan
    ? workBlocks(plan).reduce((sum, b) => sum + (toMinutes(b.end) - toMinutes(b.start)), 0)
    : 0
  const taskMin = logs.reduce((sum, l) => sum + l.actualMin, 0)
  // 学習の時間 = 前の版の学習記録 + 学習のタスクをタイマーで測った時間
  const studyMin =
    sessions.reduce((sum, s) => sum + s.minutes, 0) +
    logs.filter((l) => byId.get(l.taskId)?.study).reduce((sum, l) => sum + l.actualMin, 0)

  return {
    id: date,
    date,
    doneTaskIds,
    undoneTaskIds,
    deferredTaskIds,
    doneNodeIds,
    undoneNodeIds,
    plannedMin,
    // 筋トレの時間も「今日動かした時間」に含める
    actualMin: taskMin + studyMin + (workout?.done ? workout.minutes : 0),
    studyMin,
    workoutMin: workout?.done ? workout.minutes : 0,
    workoutDone: workout?.done ?? false,
    findings: analyze({
      plannedIds,
      plannedNodes,
      doneTaskIds,
      undoneTaskIds,
      deferredTaskIds,
      doneNodeIds,
      undoneNodeIds,
      plannedMin,
      actualMin: taskMin + studyMin + (workout?.done ? workout.minutes : 0),
      studyMin,
      workout,
      logs,
      sessions,
      byId,
      nodeById,
      nodes,
    }),
    createdAt: new Date().toISOString(),
  }
}

interface AnalyzeInput {
  plannedIds: string[]
  plannedNodes: string[]
  doneTaskIds: string[]
  undoneTaskIds: string[]
  deferredTaskIds: string[]
  doneNodeIds: string[]
  undoneNodeIds: string[]
  plannedMin: number
  actualMin: number
  studyMin: number
  workout?: { minutes: number; done: boolean }
  logs: TaskLog[]
  sessions: StudySession[]
  byId: Map<string, Task>
  nodeById: Map<string, StudyNode>
  nodes: StudyNode[]
}

/**
 * 「なぜ予定どおり進まなかったのか」を、記録から言える範囲で挙げる。
 * 憶測は書かない。データから言えないことは書かない。
 */
function analyze(a: AnalyzeInput): string[] {
  const out: string[] = []
  const totalPlanned = a.plannedIds.length + a.plannedNodes.length
  const totalDone = a.doneTaskIds.length + a.doneNodeIds.length

  if (totalPlanned === 0) {
    out.push('この日の「やること」は空でした。1 ページ目でリストに入れると、ここで振り返れます。')
    return out
  }

  if (totalDone === totalPlanned) {
    out.push(`入れた${totalPlanned}件をすべて終えました。`)
  } else {
    out.push(
      `予定${totalPlanned}件のうち${totalDone}件が完了、${totalPlanned - totalDone}件が未完了です。`,
    )
  }

  // 見積もりのズレ。次の見積もりに効く材料なので、具体的な数字で書く
  const overruns = a.logs.filter((l) => l.plannedMin > 0 && l.actualMin / l.plannedMin >= OVERRUN)
  if (overruns.length > 0) {
    const worst = overruns.sort((x, y) => y.actualMin / y.plannedMin - x.actualMin / x.plannedMin)[0]
    const t = a.byId.get(worst.taskId)
    out.push(
      `「${t?.title ?? '不明なタスク'}」は${formatDuration(worst.plannedMin)}の予定に対して${formatDuration(worst.actualMin)}かかりました。` +
        '次に同じようなものを入れるときの目安にしてください。',
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
    out.push(`手をつけられなかったのは${titles}です。「未完了を翌日へ送る」で次の日のリストに移せます。`)
  }

  if (a.undoneNodeIds.length > 0) {
    const titles = a.undoneNodeIds
      .map((id) => a.nodeById.get(id)?.title)
      .filter(Boolean)
      .slice(0, 3)
      .join('、')
    out.push(`学習で手をつけられなかったのは${titles}です。`)
  }

  // 実績が予定の半分以下 = 時間そのものが取れていない。詰め込みが原因のことが多い
  if (a.plannedMin > 0 && a.actualMin < a.plannedMin * 0.5) {
    out.push(
      `作業できたのは${formatDuration(a.actualMin)}で、予定の${formatDuration(a.plannedMin)}の半分以下でした。` +
        '予定の量が多すぎたか、開始が遅かった可能性があります。明日は上位3件に絞ることを勧めます。',
    )
  }

  // 理解度が上がった項目は、続ける動機になるので出す
  const improved = a.sessions.filter((s) => s.mastery === 'mastered' || s.mastery === 'understood')
  if (improved.length > 0) {
    const line = improved
      .slice(0, 3)
      .map((s) => `${a.nodeById.get(s.nodeId)?.title ?? '項目'}→${MASTERY_LABELS[s.mastery!]}`)
      .join('、')
    out.push(`理解度が進んだのは ${line} です。`)
  }

  // 正答率が低かったものは、次に復習で戻ってくる
  const weak = a.sessions.filter(
    (s) => s.attempted != null && s.attempted >= 5 && (s.correct ?? 0) / s.attempted < 0.6,
  )
  for (const s of weak.slice(0, 2)) {
    const pct = Math.round(((s.correct ?? 0) / (s.attempted as number)) * 100)
    out.push(
      `「${a.nodeById.get(s.nodeId)?.title ?? '項目'}」の正答率は${pct}%でした。要復習にしておくと、近いうちにまた出ます。`,
    )
  }

  if (a.workout) {
    out.push(
      a.workout.done
        ? `筋トレは${formatDuration(a.workout.minutes)}実施しました。`
        : '今日は筋トレの記録がありません。',
    )
  }

  // 分野の偏りは、本人が気づきにくいので出す
  const byArea = new Map<string, number>()
  for (const l of a.logs) byArea.set(l.area, (byArea.get(l.area) ?? 0) + l.actualMin)
  for (const s of a.sessions) {
    const area = areaOf(a.nodes, s.nodeId)
    byArea.set(area, (byArea.get(area) ?? 0) + s.minutes)
  }
  if (byArea.size > 0) {
    const line = [...byArea.entries()]
      .sort((x, y) => y[1] - x[1])
      .map(
        ([area, min]) =>
          `${AREA_LABELS[area as keyof typeof AREA_LABELS] ?? area} ${formatDuration(min)}`,
      )
      .join(' / ')
    out.push(`内訳: ${line}`)
  }

  return out
}
