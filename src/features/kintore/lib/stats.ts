import type { ExerciseMap } from '../data/exercises'
import { BUILTIN_EXERCISE_MAP } from '../data/exercises'
import { MUSCLES } from '../data/muscles'
import type { BodyWeightEntry, Goal, MuscleId, Profile, WorkoutSession } from '../types'
import { sessionDoneSets, sessionVolume, startOfWeek } from './achievements'
import { addWeeks, round1, toDateKey } from './calc'

// ---------- 期間別の集計 ----------

export interface PeriodStats {
  /** '2026-09' または '2026' */
  key: string
  label: string
  sessions: number
  sets: number
  volumeKg: number
  cardioMinutes: number
  minutes: number
}

function emptyPeriod(key: string, label: string): PeriodStats {
  return { key, label, sessions: 0, sets: 0, volumeKg: 0, cardioMinutes: 0, minutes: 0 }
}

function sessionMinutes(s: WorkoutSession): number {
  if (!s.finishedAt) return 0
  const ms = new Date(s.finishedAt).getTime() - new Date(s.startedAt).getTime()
  return Math.max(0, Math.round(ms / 60000))
}

function accumulate(target: PeriodStats, s: WorkoutSession): void {
  target.sessions += 1
  target.sets += sessionDoneSets(s)
  target.volumeKg += sessionVolume(s)
  target.cardioMinutes += s.cardioMinutes
  target.minutes += sessionMinutes(s)
}

/** 直近 months ヶ月ぶん。記録が無い月も 0 として並べる */
export function monthlyStats(
  sessions: WorkoutSession[],
  months = 12,
  today = new Date(),
): PeriodStats[] {
  const buckets = new Map<string, PeriodStats>()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    buckets.set(key, emptyPeriod(key, `${d.getMonth() + 1}月`))
  }
  for (const s of sessions) {
    if (!s.finishedAt) continue
    const bucket = buckets.get(s.date.slice(0, 7))
    if (bucket) accumulate(bucket, s)
  }
  return [...buckets.values()]
}

/** 記録のある年をすべて。新しい年が末尾 */
export function yearlyStats(sessions: WorkoutSession[]): PeriodStats[] {
  const buckets = new Map<string, PeriodStats>()
  for (const s of sessions) {
    if (!s.finishedAt) continue
    const key = s.date.slice(0, 4)
    if (!buckets.has(key)) buckets.set(key, emptyPeriod(key, `${key}年`))
    accumulate(buckets.get(key)!, s)
  }
  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))
}

// ---------- 体重 ----------

export interface WeightPoint {
  date: string
  weightKg: number
}

/**
 * 体重ログと、記録に付随する体重をまとめた時系列。
 * 同じ日付があれば体重ログを優先する。
 */
export function weightSeries(
  weights: BodyWeightEntry[],
  sessions: WorkoutSession[],
): WeightPoint[] {
  const map = new Map<string, number>()
  for (const s of sessions) {
    if (s.bodyWeightKg != null) map.set(s.date, s.bodyWeightKg)
  }
  for (const w of weights) map.set(w.date, w.weightKg)
  return [...map.entries()]
    .map(([date, weightKg]) => ({ date, weightKg }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** 1週あたりの体重変化(kg)。最小二乗法。データが足りなければ null */
export function weeklyWeightTrend(points: WeightPoint[], windowDays = 28): number | null {
  if (points.length < 3) return null
  const last = new Date(points[points.length - 1].date)
  const from = new Date(last)
  from.setDate(from.getDate() - windowDays)
  const window = points.filter((p) => new Date(p.date) >= from)
  if (window.length < 3) return null

  const base = new Date(window[0].date).getTime()
  const xs = window.map((p) => (new Date(p.date).getTime() - base) / (1000 * 60 * 60 * 24))
  const ys = window.map((p) => p.weightKg)
  const spanDays = xs[xs.length - 1] - xs[0]
  if (spanDays < 7) return null

  const n = xs.length
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY)
    den += (xs[i] - meanX) ** 2
  }
  if (den === 0) return null
  return round2((num / den) * 7)
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

// ---------- 部位別バランス ----------

export interface MuscleLoad {
  muscle: MuscleId
  sets: number
}

/**
 * 部位ごとの実施セット数。主動筋に1セット、協働筋に0.5セットを配分する。
 * since を渡すとその日以降だけを対象にする。
 */
export function muscleBalance(
  sessions: WorkoutSession[],
  since?: string,
  exerciseMap: ExerciseMap = BUILTIN_EXERCISE_MAP,
): MuscleLoad[] {
  const totals = new Map<MuscleId, number>()
  for (const m of MUSCLES) totals.set(m.id, 0)

  for (const s of sessions) {
    if (!s.finishedAt) continue
    if (since && s.date < since) continue
    for (const logged of s.exercises) {
      const ex = exerciseMap[logged.exerciseId]
      if (!ex) continue
      const done = logged.sets.filter((x) => x.done).length
      if (done === 0) continue
      for (const m of ex.primary) totals.set(m, (totals.get(m) ?? 0) + done)
      for (const m of ex.secondary) totals.set(m, (totals.get(m) ?? 0) + done * 0.5)
    }
  }

  return [...totals.entries()]
    .map(([muscle, sets]) => ({ muscle, sets: Math.round(sets * 10) / 10 }))
    .sort((a, b) => b.sets - a.sets)
}

// ---------- 統計にもとづく目標の見直し ----------

export type Verdict =
  | 'on_track'
  | 'too_fast'
  | 'too_slow'
  | 'wrong_direction'
  | 'insufficient_data'

export interface Suggestion {
  id: string
  title: string
  detail: string
  /** ワンタップで適用できる変更 */
  apply?:
    | { kind: 'targetDate'; value: string; label: string }
    | { kind: 'daysPerWeek'; value: number; label: string }
}

export interface GoalReview {
  /** 実測の週あたり体重変化 */
  actualWeeklyKg: number | null
  /** 目標に必要な週あたり体重変化 */
  neededWeeklyKg: number | null
  weightVerdict: Verdict
  /** 実測の週あたりトレーニング回数 (直近4週の平均) */
  actualFrequency: number
  targetFrequency: number
  /** 実測ペースでの到達予定日 */
  projectedDate: string | null
  suggestions: Suggestion[]
}

const WEEKS_OBSERVED = 4

export function reviewGoal(
  profile: Profile | null,
  goal: Goal | null,
  sessions: WorkoutSession[],
  weights: BodyWeightEntry[],
  today = new Date(),
  exerciseMap: ExerciseMap = BUILTIN_EXERCISE_MAP,
): GoalReview {
  const points = weightSeries(weights, sessions)
  const actualWeeklyKg = weeklyWeightTrend(points)
  const actualFrequency = averageWeeklyFrequency(sessions, WEEKS_OBSERVED, today)
  const targetFrequency = profile?.daysPerWeek ?? 3
  const suggestions: Suggestion[] = []

  const currentWeight = points[points.length - 1]?.weightKg ?? profile?.weightKg ?? null
  const targetWeight = goal?.targetWeightKg ?? null
  const remaining = targetWeight != null && currentWeight != null ? targetWeight - currentWeight : null

  // 目標日までに必要なペース
  let neededWeeklyKg: number | null = null
  if (remaining != null && goal?.targetDate) {
    const weeks = weeksUntil(today, new Date(goal.targetDate))
    if (weeks > 0) neededWeeklyKg = round2(remaining / weeks)
  }

  const weightVerdict = judgeWeight(actualWeeklyKg, remaining, neededWeeklyKg)

  // 実測ペースでの到達予定日
  let projectedDate: string | null = null
  if (actualWeeklyKg != null && remaining != null && Math.abs(remaining) >= 0.5) {
    const sameDirection = Math.sign(actualWeeklyKg) === Math.sign(remaining)
    if (sameDirection && Math.abs(actualWeeklyKg) > 0.02) {
      projectedDate = addWeeks(today, Math.ceil(remaining / actualWeeklyKg))
    }
  }

  // --- 体重ペースについての提案 ---
  if (weightVerdict === 'insufficient_data') {
    const lastLog = points[points.length - 1]?.date
    const stale = !lastLog || daysBetween(new Date(lastLog), today) > 10
    if (stale && targetWeight != null) {
      suggestions.push({
        id: 'log_weight',
        title: '体重の記録を増やすと目標を調整できます',
        detail:
          '週2回ほど体重を残すと、実際のペースから到達予定日を計算し、無理のない目標に調整できます。ホーム画面から1タップで記録できます。',
      })
    }
  } else if (weightVerdict === 'wrong_direction') {
    suggestions.push({
      id: 'wrong_direction',
      title: `体重が目標と逆方向に動いています (${signed(actualWeeklyKg!)}kg/週)`,
      detail:
        goal?.type === 'fatloss'
          ? '摂取カロリーが消費を上回っている可能性が高いです。まず食事の記録を1週間つけて、目安カロリーとのズレを確認してみてください。'
          : '狙いと逆に体重が減っています。トレーニング量に対して食事が足りていないか確認してください。',
    })
  } else if (weightVerdict === 'too_slow' && projectedDate && goal?.targetDate) {
    suggestions.push({
      id: 'push_date',
      title: '目標日を後ろ倒しするのが現実的です',
      detail: `実測ペースは ${signed(actualWeeklyKg!)}kg/週 で、目標日までに必要な ${signed(
        neededWeeklyKg!,
      )}kg/週 に届いていません。このペースなら ${projectedDate} 前後の到達が見込まれます。急いで達成しようとするより、期限を現実に合わせるほうが続きます。`,
      apply: { kind: 'targetDate', value: projectedDate, label: `目標日を ${projectedDate} にする` },
    })
  } else if (weightVerdict === 'too_fast') {
    suggestions.push({
      id: 'slow_down',
      title: `減量ペースが速すぎます (${signed(actualWeeklyKg!)}kg/週)`,
      detail:
        '体重の0.5%/週を大きく超えるペースでは筋肉も一緒に落ちます。摂取カロリーを1日200kcalほど戻すか、目標日に余裕を持たせてください。',
      apply: projectedDate
        ? { kind: 'targetDate', value: projectedDate, label: `目標日を ${projectedDate} にする` }
        : undefined,
    })
  } else if (weightVerdict === 'on_track') {
    suggestions.push({
      id: 'on_track',
      title: '体重は目標どおりのペースです',
      detail: `実測 ${signed(actualWeeklyKg!)}kg/週。${
        projectedDate ? `このまま続ければ ${projectedDate} 前後で目標に届きます。` : 'この調子で続けてください。'
      }`,
    })
  }

  // --- トレーニング頻度についての提案 ---
  if (sessions.some((s) => s.finishedAt)) {
    const rounded = Math.round(actualFrequency * 10) / 10
    if (actualFrequency < targetFrequency - 0.6) {
      const realistic = Math.max(1, Math.round(actualFrequency))
      suggestions.push({
        id: 'lower_frequency',
        title: `週の目標 ${targetFrequency}回に対して実績は ${rounded}回です`,
        detail:
          '達成できない目標は続きません。まず実績に合わせて週の目標日数を下げ、そこを確実に守れるようになってから増やすほうが伸びます。1回あたりの時間を延ばして総量を保つ方法もあります。',
        apply:
          realistic !== targetFrequency
            ? { kind: 'daysPerWeek', value: realistic, label: `週の目標を ${realistic}回にする` }
            : undefined,
      })
    } else if (actualFrequency > targetFrequency + 0.8) {
      const next = Math.min(7, Math.round(actualFrequency))
      suggestions.push({
        id: 'raise_frequency',
        title: `週 ${targetFrequency}回の目標を上回って ${rounded}回できています`,
        detail:
          '目標を実績に合わせて引き上げると、週の進捗バーが実態を映すようになります。ただし同じ部位は48時間あけるようにしてください。',
        apply: { kind: 'daysPerWeek', value: next, label: `週の目標を ${next}回にする` },
      })
    }
  }

  // --- 部位の偏りについての提案 ---
  const since = toDateKey(addDaysDate(today, -56))
  const balance = muscleBalance(sessions, since, exerciseMap)
  const trained = balance.filter((b) => b.sets > 0)
  const neglectedLarge = balance.filter(
    (b) => MUSCLES.find((m) => m.id === b.muscle)?.large && b.sets === 0,
  )
  if (trained.length >= 3 && neglectedLarge.length > 0) {
    const names = neglectedLarge.map((b) => MUSCLES.find((m) => m.id === b.muscle)!.name)
    suggestions.push({
      id: 'balance',
      title: `直近8週間で ${names.join('・')} を鍛えていません`,
      detail:
        '大きな筋肉を外すと、代謝も見た目のバランスも伸びにくくなります。目標の部位に加えてみてください。',
    })
  }

  return {
    actualWeeklyKg,
    neededWeeklyKg,
    weightVerdict,
    actualFrequency,
    targetFrequency,
    projectedDate,
    suggestions,
  }
}

function judgeWeight(
  actual: number | null,
  remaining: number | null,
  needed: number | null,
): Verdict {
  if (actual === null) return 'insufficient_data'
  if (remaining === null || Math.abs(remaining) < 0.5) return 'on_track'
  const wantSign = Math.sign(remaining)
  if (Math.abs(actual) < 0.05) return 'too_slow'
  if (Math.sign(actual) !== wantSign) return 'wrong_direction'
  // 減量で週1%を超えるなら速すぎ (体重60kgなら0.6kg/週)
  if (wantSign < 0 && actual < -0.9) return 'too_fast'
  if (needed !== null && Math.abs(actual) < Math.abs(needed) * 0.7) return 'too_slow'
  return 'on_track'
}

function signed(v: number): string {
  return `${v > 0 ? '+' : ''}${round2(v)}`
}

/** 直近 weeks 週の平均トレーニング回数 (週あたり) */
export function averageWeeklyFrequency(
  sessions: WorkoutSession[],
  weeks: number,
  today = new Date(),
): number {
  const days = new Set(sessions.filter((s) => s.finishedAt).map((s) => s.date))
  if (days.size === 0) return 0
  const start = addDaysDate(startOfWeek(today), -7 * (weeks - 1))
  let count = 0
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDaysDate(start, i)
    if (d > today) break
    if (days.has(toDateKey(d))) count++
  }
  // 経過した週数で割る (今週の途中でも過小評価しないよう日数ベース)
  const elapsedDays = Math.max(1, daysBetween(start, today) + 1)
  return round2((count / elapsedDays) * 7)
}

function addDaysDate(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

function weeksUntil(from: Date, to: Date): number {
  return Math.max(0, Math.round(daysBetween(from, to) / 7))
}

export { round1 }
