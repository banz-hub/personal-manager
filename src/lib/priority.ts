/**
 * 優先順位の決定。
 *
 * 外部の AI は使わず、ここで決定論的にスコアを出す。オフラインで動き、毎回同じ答えになり、
 * テストが書ける。そのかわり **なぜ上位なのかを必ず言葉で返す** ことを条件にしている
 * (理由の言えない順位は、ユーザーが納得して実行できないため)。
 *
 * スコアは「その項目がどれくらい今日の行動を左右するか」で決めた重み付け。
 * 締切がいちばん重く、次に重要度。重要度が低くても今日締切なら、
 * 重要度が高くて 1 週間後のものより上に来る。
 */

import type { Task, TaskLog } from '../types'
import { AREA_LABELS } from '../types'
import { daysBetween, formatDuration, minutesUntilDue } from './date'
import { adjustedEstimate } from './estimate'

/**
 * 期限切れは最優先と分けてある。
 * 「もう遅れている」ものと「今日中なら間に合う」ものは、
 * 取るべき行動が違う (前者はまずやるか捨てるかを決める) ため。
 */
export type Bucket = 'overdue' | 'urgent' | 'important' | 'routine' | 'optional'

/** 画面に出す順番 */
export const BUCKET_ORDER: Bucket[] = ['overdue', 'urgent', 'important', 'routine', 'optional']

export const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: '期限切れ',
  urgent: '最優先',
  important: '重要',
  routine: '継続',
  optional: '任意',
}

export const BUCKET_MARKS: Record<Bucket, string> = {
  overdue: '⚠️',
  urgent: '🔴',
  important: '🟠',
  routine: '🟢',
  optional: '⚪️',
}

export interface ScoredTask {
  task: Task
  score: number
  bucket: Bucket
  /** なぜ上位なのか。効いた順に並ぶ */
  reasons: string[]
  /** 実行する前に知っておくべきこと */
  warnings: string[]
  /** 今日これに充てる分数 (実績で補正済み) */
  todayMin: number
  /** 補正の説明。補正がかかったときだけ */
  estimateNote?: string
  /** 締切まで残り (分)。締切なしは null。過ぎていれば負 */
  leftMin: number | null
  /** 締切まで残り日数。締切なしは null */
  leftDays: number | null
}

export interface RankInput {
  tasks: Task[]
  logs: TaskLog[]
  /** YYYY-MM-DD */
  today: string
  /** 0 時からの分 */
  now: number
  /** 今日の空き時間の合計 (分)。「今日だけでは終わらない」の判定に使う */
  availableMin: number
}

/** 締切からの点。ここがいちばん重い */
function deadlineScore(leftMin: number | null, leftDays: number | null): [number, string | null] {
  if (leftMin === null || leftDays === null) return [0, null]
  if (leftMin < 0) return [130, '期限を過ぎている']
  if (leftDays <= 0) return [115, '今日が締切']
  if (leftDays === 1) return [65, '明日が締切']
  if (leftDays <= 3) return [42, `締切まであと${leftDays}日`]
  if (leftDays <= 7) return [24, '今週が締切']
  if (leftDays <= 14) return [12, '再来週までが締切']
  // それより先は、あることだけ分かればよい
  return [Math.max(2, 10 - Math.floor(leftDays / 14)), null]
}

/** 先送りの点。放置し続けたものが自然に浮き上がるようにする */
function deferScore(task: Task): [number, string | null] {
  const count = task.deferCount ?? 0
  if (count <= 0) return [0, null]
  return [Math.min(count * 12, 36), `${count}回先送りしている`]
}

/** 継続タスクが空いてしまった日数の点 */
function stalenessScore(task: Task, today: string): [number, string | null] {
  if (!task.recurring) return [0, null]
  if (!task.lastWorkedOn) return [10, 'まだ一度も手をつけていない']
  const gap = daysBetween(task.lastWorkedOn, today)
  if (gap < 2) return [0, null]
  return [Math.min(gap * 4, 28), `${gap}日やっていない`]
}

export function scoreTask(task: Task, input: RankInput): ScoredTask {
  const { today, now, logs, availableMin } = input
  const leftMin = minutesUntilDue(today, now, task.dueDate, task.dueTime)
  const leftDays = task.dueDate ? daysBetween(today, task.dueDate) : null

  const reasons: string[] = []
  const warnings: string[] = []
  let score = 0

  const [dScore, dReason] = deadlineScore(leftMin, leftDays)
  score += dScore
  if (dReason) reasons.push(dReason)

  // 重要度。締切に次いで重い
  score += task.importance * 22
  if (task.importance === 3) reasons.push('重要度が高い')
  if (task.importance === 1 && dScore < 60) reasons.push('重要度は低い')

  // 着手しているものは、途中で止めるより続けたほうが早く終わる
  if (task.status === 'doing') {
    score += 8
    reasons.push('着手済みなので続けたい')
  } else if (task.status === 'todo' && leftDays !== null && leftDays <= 3) {
    score += 14
    reasons.push('まだ手をつけていない')
  }

  const [fScore, fReason] = deferScore(task)
  score += fScore
  if (fReason) reasons.push(fReason)

  const [sScore, sReason] = stalenessScore(task, today)
  score += sScore
  if (sReason) reasons.push(sReason)

  // 就活の締切は先方の都合なので、こちらの都合でずらせない
  if (task.area === 'jobhunt' && task.dueDate) {
    score += 10
    reasons.push('就活の締切はこちらの都合でずらせない')
  }

  const est = adjustedEstimate(task, logs)
  const todayMin = est.minutes

  // 今日中に終わらないものは、先に分かっていないと計画が破綻する
  if (leftDays !== null && leftDays <= 0 && task.estimateMin > availableMin && availableMin > 0) {
    warnings.push(
      `今日の空き時間${formatDuration(availableMin)}では${formatDuration(task.estimateMin)}を終えられない。範囲を削るか締切を見直す`,
    )
  }
  if (leftMin !== null && leftMin < 0) {
    warnings.push('締切を過ぎている。やるか、やめるかを決める')
  }

  return {
    task,
    score,
    bucket: bucketOf(score, task, leftMin, leftDays),
    reasons,
    warnings,
    todayMin,
    estimateNote: est.note,
    leftMin,
    leftDays,
  }
}

/**
 * 表示のグループ分け。
 * スコアの閾値だけで決めると説明しづらいので、まず「期限切れ」「今日締切」という
 * 誰が見ても分かる事実で決め、そこに当たらないものだけスコアで振り分ける。
 */
function bucketOf(
  score: number,
  task: Task,
  leftMin: number | null,
  leftDays: number | null,
): Bucket {
  if (leftMin !== null && leftMin < 0) return 'overdue'
  if (leftDays !== null && leftDays <= 0) return 'urgent'
  if (score >= 150) return 'urgent'
  // 毎日すこしずつ進めるものは、締切が遠くても「継続」として別に見せる
  if (task.recurring) return 'routine'
  if (leftDays !== null && leftDays <= 7) return 'important'
  // 締切が遠くても、重要度が高いものを「任意」に落とさない
  if (task.importance === 3) return 'important'
  if (score >= 95) return 'important'
  return 'optional'
}

/** 今日の候補になるタスク。完了とやめたものは外す */
export function isCandidate(task: Task): boolean {
  return task.status === 'todo' || task.status === 'doing'
}

/**
 * 今日のタスクを優先順位順に並べる。
 * 同点のときは締切が近い順 → 短い順 → id 順。id まで見るのは、
 * 並びが実行のたびに変わらないようにするため (テストが書けなくなる)。
 */
export function rankTasks(input: RankInput): ScoredTask[] {
  return input.tasks
    .filter(isCandidate)
    .map((task) => scoreTask(task, input))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const al = a.leftMin ?? Number.MAX_SAFE_INTEGER
      const bl = b.leftMin ?? Number.MAX_SAFE_INTEGER
      if (al !== bl) return al - bl
      if (a.todayMin !== b.todayMin) return a.todayMin - b.todayMin
      return a.task.id.localeCompare(b.task.id)
    })
}

export function groupByBucket(scored: ScoredTask[]): Record<Bucket, ScoredTask[]> {
  const out: Record<Bucket, ScoredTask[]> = {
    overdue: [],
    urgent: [],
    important: [],
    routine: [],
    optional: [],
  }
  for (const s of scored) out[s.bucket].push(s)
  return out
}

/**
 * 「今日はこれが最優先です。なぜなら〜」の一文を作る。
 * 何をするかだけでなく、なぜそれをするのかまで言えるようにするための出力。
 */
export function explainTop(scored: ScoredTask[]): string {
  const top = scored[0]
  if (!top) return '登録されているタスクがありません。まず今日やることを入れてください。'
  const why = top.reasons.slice(0, 2).join('、')
  const area = AREA_LABELS[top.task.area]
  return (
    `今日は「${top.task.title}」(${area}) が最優先です。` +
    // 理由の文末がどうであっても崩れないよう、「〜ためです」でつながない
    (why ? `理由は${why}。` : '') +
    `目安は${formatDuration(top.todayMin)}。`
  )
}

/** 「今日の最重要 3 項目」。継続と任意は入れない */
export function topThree(scored: ScoredTask[]): ScoredTask[] {
  return scored
    .filter((s) => s.bucket === 'overdue' || s.bucket === 'urgent' || s.bucket === 'important')
    .slice(0, 3)
}
