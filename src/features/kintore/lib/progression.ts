import type { LoggedSet, Profile, WorkoutPlan, WorkoutSession } from '../types'
import type { ExerciseMap } from '../data/exercises'
import { BUILTIN_EXERCISE_MAP } from '../data/exercises'

/** Epley 式による推定1RM。自重種目など重量が無い場合は null */
export function estimate1RM(weightKg: number | null, reps: number): number | null {
  if (weightKg == null || weightKg <= 0 || reps <= 0) return null
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10
}

export interface ExercisePerformance {
  date: string
  /** 完了したセットのみ */
  sets: LoggedSet[]
  topWeightKg: number | null
  topReps: number
  volumeKg: number
  best1RM: number | null
}

function summarize(date: string, sets: LoggedSet[]): ExercisePerformance | null {
  const done = sets.filter((s) => s.done)
  if (done.length === 0) return null
  let topWeightKg: number | null = null
  let topReps = 0
  let best1RM: number | null = null
  let volumeKg = 0
  for (const s of done) {
    volumeKg += (s.weightKg ?? 0) * s.reps
    if (s.weightKg != null && (topWeightKg == null || s.weightKg > topWeightKg)) {
      topWeightKg = s.weightKg
    }
    topReps = Math.max(topReps, s.reps)
    const e = estimate1RM(s.weightKg, s.reps)
    if (e != null && (best1RM == null || e > best1RM)) best1RM = e
  }
  return { date, sets: done, topWeightKg, topReps, volumeKg, best1RM }
}

/** 指定した日を除く、直近の実施内容 */
export function lastPerformance(
  sessions: WorkoutSession[],
  exerciseId: string,
  excludeDate?: string,
): ExercisePerformance | null {
  const candidates = sessions
    .filter((s) => s.finishedAt && s.date !== excludeDate)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  for (const s of candidates) {
    const logged = s.exercises.find((e) => e.exerciseId === exerciseId)
    if (!logged) continue
    const summary = summarize(s.date, logged.sets)
    if (summary) return summary
  }
  return null
}

/** 指定した日を除く自己ベスト (推定1RM基準) */
export function personalBest(
  sessions: WorkoutSession[],
  exerciseId: string,
  excludeDate?: string,
): ExercisePerformance | null {
  let best: ExercisePerformance | null = null
  for (const s of sessions) {
    if (!s.finishedAt || s.date === excludeDate) continue
    const logged = s.exercises.find((e) => e.exerciseId === exerciseId)
    if (!logged) continue
    const summary = summarize(s.date, logged.sets)
    if (!summary?.best1RM) continue
    if (!best?.best1RM || summary.best1RM > best.best1RM) best = summary
  }
  return best
}

/** 所有重量のうち、現在より重い次の1段階 */
function nextWeightStep(current: number, owned: number[]): number | null {
  const heavier = owned.filter((w) => w > current).sort((a, b) => a - b)
  if (heavier.length > 0) return heavier[0]
  return null
}

/**
 * 前回の実績にもとづいて次回の重量を決める（漸進性過負荷）。
 * 目標レップ数の上限を全セットで達成できていたら1段階上げ、
 * そうでなければ同じ重量で回数を伸ばす。
 */
export function applyProgression(
  plan: WorkoutPlan,
  sessions: WorkoutSession[],
  profile: Profile,
  todayDate: string,
  exerciseMap: ExerciseMap = BUILTIN_EXERCISE_MAP,
): WorkoutPlan {
  const exercises = plan.exercises.map((p) => {
    const last = lastPerformance(sessions, p.exerciseId, todayDate)
    if (!last || last.topWeightKg == null) return p

    const [, top] = p.repRange
    const clearedAll = last.sets.every((s) => s.reps >= top && s.weightKg === last.topWeightKg)
    const ex = exerciseMap[p.exerciseId]
    const owned =
      profile.equipment.find(
        (eq) => ex && ex.equipment.includes(eq.id) && (eq.weights?.length ?? 0) > 0,
      )?.weights ?? []

    if (clearedAll) {
      const next = owned.length > 0 ? nextWeightStep(last.topWeightKg, owned) : last.topWeightKg + 2.5
      if (next != null) {
        return {
          ...p,
          suggestedWeightKg: next,
          progressionNote: `前回 ${last.topWeightKg}kg × ${top}回を全セット達成。${next}kg に上げます`,
        }
      }
      return {
        ...p,
        suggestedWeightKg: last.topWeightKg,
        progressionNote: `前回の重量が手持ちで最大です。回数かセット数を増やして負荷を上げましょう`,
      }
    }

    return {
      ...p,
      suggestedWeightKg: last.topWeightKg,
      progressionNote: `前回と同じ ${last.topWeightKg}kg。まず全セットで ${top}回を目指します`,
    }
  })

  return { ...plan, exercises }
}
