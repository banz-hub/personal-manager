import { EXERCISES } from '../data/exercises'
import { MUSCLE_MAP } from '../data/muscles'
import type {
  CardioPlan,
  EquipmentId,
  Exercise,
  ExperienceLevel,
  GoalType,
  MuscleId,
  PlannedExercise,
  Profile,
  WorkoutPlan,
} from '../types'
import { clamp, maxHeartRate } from './calc'

const LEVEL_RANK: Record<ExperienceLevel, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
}

interface GoalParams {
  sets: number
  repRange: [number, number]
  restSec: number
  /** 推奨重量の補正係数 */
  loadMult: number
  /** 有酸素を標準で組み込むか */
  cardio: boolean
}

const GOAL_PARAMS: Record<GoalType, GoalParams> = {
  strength: { sets: 5, repRange: [3, 5], restSec: 180, loadMult: 1.15, cardio: false },
  hypertrophy: { sets: 4, repRange: [8, 12], restSec: 90, loadMult: 1.0, cardio: false },
  fatloss: { sets: 3, repRange: [12, 15], restSec: 60, loadMult: 0.85, cardio: true },
  endurance: { sets: 3, repRange: [15, 20], restSec: 45, loadMult: 0.75, cardio: true },
}

export const GOAL_LABEL: Record<GoalType, string> = {
  hypertrophy: '筋肥大 (体を大きくする)',
  strength: '筋力アップ (重量を伸ばす)',
  fatloss: '減量・体を絞る',
  endurance: '持久力・引き締め',
}

export const GOAL_DESCRIPTION: Record<GoalType, string> = {
  hypertrophy: '中重量 × 8〜12回。筋肉量を増やすのに最も効率的なレンジ。',
  strength: '高重量 × 3〜5回。神経系を鍛え最大挙上重量を伸ばす。休憩は長め。',
  fatloss: '軽〜中重量 × 12〜15回 + 有酸素。筋肉を残しながら脂肪を落とす。',
  endurance: '軽重量 × 15〜20回 + 有酸素。筋持久力と引き締めを狙う。',
}

const LEVEL_LOAD_MULT: Record<ExperienceLevel, number> = {
  beginner: 0.7,
  intermediate: 1.0,
  advanced: 1.2,
}

export const LEVEL_LABEL: Record<ExperienceLevel, string> = {
  beginner: '初心者 (〜半年)',
  intermediate: '中級者 (半年〜2年)',
  advanced: '上級者 (2年〜)',
}

/** 1レップあたりの所要秒数 (挙上+下降) */
const SEC_PER_REP = 3.5
/** 種目間のセットアップ時間(分) */
const SETUP_MIN = 1

export interface PlanOptions {
  /** 同じ入力でも日によってメニューを変えるための乱数シード */
  seed?: number
  /** メニューから除外する種目ID */
  excludeIds?: string[]
  /** 候補にする種目。ユーザー定義を含める場合に渡す。既定は組み込みのみ */
  exercises?: Exercise[]
}

export function generateWorkoutPlan(
  profile: Profile,
  goalType: GoalType,
  targetMuscles: MuscleId[],
  options: PlanOptions = {},
): WorkoutPlan {
  const seed = options.seed ?? Date.now()
  const rand = mulberry32(seed)
  const params = GOAL_PARAMS[goalType]
  const available = availableEquipment(profile)
  const exclude = new Set(options.excludeIds ?? [])
  const hidden = new Set(profile.hiddenExerciseIds ?? [])
  const pool = (options.exercises ?? EXERCISES).filter((e) => !hidden.has(e.id))

  let candidates = pool.filter(
    (e) =>
      !exclude.has(e.id) &&
      e.equipment.every((eq) => available.has(eq)) &&
      LEVEL_RANK[e.minLevel] <= LEVEL_RANK[profile.experience],
  )
  // レベル制限で候補が枯渇した場合は1段階だけ緩和する
  if (candidates.length < 6) {
    candidates = pool.filter(
      (e) => !exclude.has(e.id) && e.equipment.every((eq) => available.has(eq)),
    )
  }

  // 同じシードなら同じ揺らぎになるよう、種目ごとに固定のジッターを先に決めておく
  const jitter = new Map(candidates.map((e) => [e.id, rand() * 0.7]))

  // 時間配分: ウォームアップ → 有酸素 → 残りを筋トレに充てる
  const total = Math.max(15, profile.dailyMinutes)
  const warmupMinutes = Math.round(clamp(total * 0.1, 5, 10))
  const wantsCardio = params.cardio
  const cardioMinutes = wantsCardio ? Math.round(clamp(total * 0.25, 10, 25)) : 0
  const strengthBudget = Math.max(8, total - warmupMinutes - cardioMinutes)

  const picked: PlannedExercise[] = []
  const patternCount = new Map<string, number>()
  /** すでに選ばれた種目がその部位を何回カバーしたか。多いほどスコアが下がる */
  const coverage = new Map<MuscleId, number>()
  /** まだ「主動筋として」鍛えられていない部位を埋めるために使う */
  const primaryCovered = new Set<MuscleId>()
  const remaining = [...candidates]
  let used = 0

  // 未カバーの部位を優先しながら1種目ずつ選ぶ (貪欲法)
  while (picked.length < 8 && remaining.length > 0) {
    let bestIdx = -1
    let bestScore = 1

    for (let i = 0; i < remaining.length; i++) {
      const e = remaining[i]
      if ((patternCount.get(e.pattern) ?? 0) >= 2) continue
      const score =
        scoreExercise(e, targetMuscles, coverage, primaryCovered, available) +
        (jitter.get(e.id) ?? 0)
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    if (bestIdx < 0) break

    const exercise = remaining.splice(bestIdx, 1)[0]
    const planned = planExercise(exercise, profile, goalType)

    // 予算を超える場合、まだ種目が少なければセット数を削ってでも入れる
    if (used + planned.estimatedMinutes > strengthBudget) {
      if (picked.length >= 3) continue
      const trimmed = trimToBudget(planned, strengthBudget - used)
      if (!trimmed) continue
      picked.push(trimmed)
      used += trimmed.estimatedMinutes
    } else {
      picked.push(planned)
      used += planned.estimatedMinutes
    }
    patternCount.set(exercise.pattern, (patternCount.get(exercise.pattern) ?? 0) + 1)
    for (const m of exercise.primary) {
      coverage.set(m, (coverage.get(m) ?? 0) + 1)
      primaryCovered.add(m)
    }
    for (const m of exercise.secondary) coverage.set(m, (coverage.get(m) ?? 0) + 0.5)
  }

  const cardio = wantsCardio ? buildCardio(profile, goalType, cardioMinutes, available) : null

  return {
    id: `plan_${seed}`,
    createdAt: new Date().toISOString(),
    goalType,
    targetMuscles,
    warmupMinutes,
    exercises: picked,
    cardio,
    totalMinutes: Math.round(warmupMinutes + used + (cardio?.minutes ?? 0)),
  }
}

/**
 * 目標部位との一致度でスコアリングする。
 * 主動筋=3点、協働筋=1点を基本とし、すでに他の種目でカバー済みの部位は
 * 得点を割り引くことで、選んだ部位が満遍なく含まれるようにする。
 */
function scoreExercise(
  e: Exercise,
  targets: MuscleId[],
  coverage: Map<MuscleId, number>,
  primaryCovered: Set<MuscleId>,
  available: Set<EquipmentId>,
): number {
  let score = 0
  let fillsGap = false
  for (const m of targets) {
    const covered = coverage.get(m) ?? 0
    if (e.primary.includes(m)) {
      score += 3 / (1 + covered)
      // 選んだのにまだ主役として鍛えられていない部位を埋める種目を優先する
      if (!primaryCovered.has(m)) fillsGap = true
    } else if (e.secondary.includes(m)) {
      score += 1 / (1 + covered * 2)
    }
  }
  if (score === 0) return 0
  if (fillsGap) score += 2

  if (e.compound) score += 1.5
  // 大筋群を狙う場合はコンパウンドの価値がさらに高い
  if (e.compound && targets.some((m) => MUSCLE_MAP[m]?.large)) score += 0.5
  // せっかく持っている機材は使う。自重だけのメニューに偏らせない
  if (e.equipment.some((eq) => eq !== 'bodyweight' && available.has(eq))) score += 1.2
  // 軽減バージョンは他に選択肢がある限り選ばない
  if (e.regression) score -= 2.5

  return score
}

function planExercise(e: Exercise, profile: Profile, goalType: GoalType): PlannedExercise {
  const params = GOAL_PARAMS[goalType]
  let sets = params.sets
  if (profile.experience === 'beginner') sets = Math.max(3, sets - 1)
  if (!e.compound) sets = Math.max(2, sets - 1)

  const suggestedWeightKg = suggestWeight(e, profile, goalType)
  const estimatedMinutes = estimateMinutes(e, sets, params.repRange, params.restSec)

  return {
    exerciseId: e.id,
    sets,
    repRange: params.repRange,
    restSec: params.restSec,
    suggestedWeightKg,
    estimatedMinutes,
  }
}

function estimateMinutes(
  e: Exercise,
  sets: number,
  repRange: [number, number],
  restSec: number,
): number {
  const avgReps = (repRange[0] + repRange[1]) / 2
  const workSec = avgReps * SEC_PER_REP * (e.unilateral ? 2 : 1)
  const perSet = workSec + restSec
  return Math.round(((sets * perSet) / 60 + SETUP_MIN) * 10) / 10
}

/** 残り時間に収まるようセット数を削る。3セット未満になる場合は諦める */
function trimToBudget(p: PlannedExercise, budget: number): PlannedExercise | null {
  const perSet = (p.estimatedMinutes - SETUP_MIN) / p.sets
  const maxSets = Math.floor((budget - SETUP_MIN) / perSet)
  if (maxSets < 2) return null
  const sets = Math.min(p.sets, maxSets)
  return {
    ...p,
    sets,
    estimatedMinutes: Math.round((sets * perSet + SETUP_MIN) * 10) / 10,
  }
}

/**
 * 推奨重量を算出し、所有している重量に丸める。
 * 自重種目や重量係数を持たない種目は null を返す。
 */
export function suggestWeight(e: Exercise, profile: Profile, goalType: GoalType): number | null {
  // ユーザー追加種目は絶対値で指定された初回重量を優先する
  if (e.defaultWeightKg != null) return snapToOwned(e, profile, e.defaultWeightKg)
  if (!e.loadFactor) return null
  const raw =
    profile.weightKg *
    e.loadFactor *
    LEVEL_LOAD_MULT[profile.experience] *
    GOAL_PARAMS[goalType].loadMult

  return snapToOwned(e, profile, raw)
}

/** 目安の重量を、実際に持っている重量に丸める */
function snapToOwned(e: Exercise, profile: Profile, raw: number): number {
  const weightedId = (['dumbbell', 'kettlebell', 'barbell'] as EquipmentId[]).find((id) =>
    e.equipment.includes(id),
  )
  if (!weightedId) return roundPlate(raw)

  const owned = profile.equipment.find((eq) => eq.id === weightedId)?.weights ?? []
  if (owned.length === 0) return roundPlate(raw)

  // 所有重量のうち推奨値以下で最大のもの。すべて重すぎる場合は最軽量を返す
  const sorted = [...owned].sort((a, b) => a - b)
  const fit = sorted.filter((w) => w <= raw).pop()
  return fit ?? sorted[0]
}

function roundPlate(v: number): number {
  return Math.max(1, Math.round(v / 2.5) * 2.5)
}

function buildCardio(
  profile: Profile,
  goalType: GoalType,
  minutes: number,
  available: Set<EquipmentId>,
): CardioPlan {
  const hrMax = maxHeartRate(profile.age)
  const [lo, hi] = goalType === 'fatloss' ? [0.6, 0.7] : [0.7, 0.8]
  const name = available.has('cardio_machine')
    ? 'トレッドミル or エアロバイク'
    : available.has('jump_rope')
      ? '縄跳び (30秒 × 休憩30秒を繰り返す)'
      : '早歩き / ジョギング'
  const note =
    goalType === 'fatloss'
      ? '筋トレの後に行うと脂肪が動員されやすい。会話ができる程度の強度を保つ。'
      : '一定ペースを維持する。心拍が上限を超えたらペースを落とす。'

  return {
    name,
    minutes,
    hrZone: [Math.round(hrMax * lo), Math.round(hrMax * hi)],
    note,
  }
}

export function availableEquipment(profile: Profile): Set<EquipmentId> {
  const set = new Set<EquipmentId>(['bodyweight'])
  for (const eq of profile.equipment) set.add(eq.id)
  return set
}

/** 決定的な擬似乱数。同じシードなら同じメニューを再現できる */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
