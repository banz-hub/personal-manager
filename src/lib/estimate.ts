/**
 * 見積もり時間の補正。
 *
 * 「数学課題 予想 60 分 → 実績 90 分」が何度も続くなら、次回の推定を実績側へ寄せる。
 * 外部サービスも学習モデルも使わず、過去ログの比の中央値を取るだけ。
 * 中央値にしているのは、1 回だけ極端に長かった日 (割り込みが入った日など) に
 * 引きずられないようにするため。
 */

import type { Task, TaskArea, TaskLog } from '../types'

export interface Correction {
  /** 見積もりに掛ける係数。1 なら補正なし */
  factor: number
  /** 根拠にしたログの件数 */
  sampleCount: number
  /** どのログを使ったか */
  basis: 'task' | 'area' | 'none'
}

/** 補正を効かせるのに最低限ほしいログの件数 */
const MIN_SAMPLES = 2
/** この件数に達すると補正を全部効かせる。それ未満は控えめにする */
const FULL_TRUST = 3
/** 行きすぎた補正を防ぐ上下限 */
const MIN_FACTOR = 0.7
const MAX_FACTOR = 2.0

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function ratios(logs: TaskLog[]): number[] {
  return logs
    .filter((l) => l.plannedMin > 0 && l.actualMin > 0)
    .map((l) => l.actualMin / l.plannedMin)
}

/**
 * そのタスク自身のログを優先し、足りなければ同じ分野のログで代用する。
 * 新しいものから順に使う (やり方が上達すると比が変わるため)。
 */
export function correctionFor(taskId: string, area: TaskArea, logs: TaskLog[]): Correction {
  const newest = [...logs].sort((a, b) => b.date.localeCompare(a.date))

  const own = ratios(newest.filter((l) => l.taskId === taskId).slice(0, 5))
  if (own.length >= MIN_SAMPLES) return build(own, 'task')

  const sameArea = ratios(newest.filter((l) => l.area === area).slice(0, 8))
  if (sameArea.length >= MIN_SAMPLES) return build(sameArea, 'area')

  return { factor: 1, sampleCount: own.length + sameArea.length, basis: 'none' }
}

function build(values: number[], basis: 'task' | 'area'): Correction {
  const raw = median(values)
  // 件数が少ないうちは補正を控えめにする (2 件で断定しない)
  const trust = Math.min(1, values.length / FULL_TRUST)
  const blended = 1 + (raw - 1) * trust
  const factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, blended))
  return { factor, sampleCount: values.length, basis }
}

export interface AdjustedEstimate {
  /** 補正後の分数 (5 分単位に丸める) */
  minutes: number
  /** 補正前の分数 */
  rawMinutes: number
  correction: Correction
  /** 補正がかかったときだけ入る説明 */
  note?: string
}

/** 5 分単位に丸める。1 分刻みの予定は現実には守れない */
function round5(min: number): number {
  return Math.max(5, Math.round(min / 5) * 5)
}

/**
 * このタスクに今日割り当てる分数を、実績から補正して返す。
 * chunkMin があればそこで頭打ちにする (長期タスクを 1 日で終わらせようとしない)。
 */
export function adjustedEstimate(task: Task, logs: TaskLog[]): AdjustedEstimate {
  const raw = Math.min(task.estimateMin, task.chunkMin ?? task.estimateMin)
  const correction = correctionFor(task.id, task.area, logs)
  const minutes = round5(raw * correction.factor)

  let note: string | undefined
  const diff = minutes - round5(raw)
  if (diff !== 0 && correction.basis !== 'none') {
    const where = correction.basis === 'task' ? 'このタスク' : '同じ分野'
    const times = correction.factor.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    note =
      diff > 0
        ? `${where}の実績が見積もりの${times}倍だったので、${raw}分→${minutes}分に伸ばした`
        : `${where}の実績が見積もりより短かったので、${raw}分→${minutes}分に縮めた`
  }

  return { minutes, rawMinutes: raw, correction, note }
}
