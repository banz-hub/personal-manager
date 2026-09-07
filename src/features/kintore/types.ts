// アプリ全体で共有するドメイン型定義

export type MuscleId =
  | 'chest'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'abs'
  | 'obliques'
  | 'traps'
  | 'lats'
  | 'lowerback'
  | 'glutes'
  | 'quads'
  | 'hamstrings'
  | 'calves'

export type BodySide = 'front' | 'back'

export type EquipmentId =
  | 'bodyweight'
  | 'dumbbell'
  | 'barbell'
  | 'bench'
  | 'pullup_bar'
  | 'kettlebell'
  | 'band'
  | 'cable'
  | 'machine'
  | 'ab_wheel'
  | 'jump_rope'
  | 'cardio_machine'

/** ユーザーが所有している機材。ダンベルなど重量を持つものは weights を埋める */
export interface OwnedEquipment {
  id: EquipmentId
  /** 所有している重量(kg)の一覧。片手あたりの重量で記録する */
  weights?: number[]
}

export type Sex = 'male' | 'female' | 'other'

/** 日常生活の活動量。TDEE 係数に対応 */
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active'

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced'

export interface Profile {
  heightCm: number
  weightKg: number
  sex: Sex
  age: number
  activityLevel: ActivityLevel
  experience: ExperienceLevel
  /** 1日のトレーニングに使える時間(分) */
  dailyMinutes: number
  /** 週あたりのトレーニング日数 */
  daysPerWeek: number
  equipment: OwnedEquipment[]
  /**
   * 1日の区切り時刻 (0〜6)。深夜に運動する人向け。
   * 例: 4 なら深夜4時までは前日の記録として扱う。既定は 0 (0時で切り替わる)
   */
  dayCutoffHour?: number
  /** メニューに出したくない種目のID */
  hiddenExerciseIds?: string[]
  updatedAt: string
}

export type GoalType = 'hypertrophy' | 'strength' | 'fatloss' | 'endurance'

export interface Goal {
  type: GoalType
  /** 重点的に鍛えたい部位 */
  targetMuscles: MuscleId[]
  /** 目標体重(kg)。未設定なら体重を変えない前提 */
  targetWeightKg?: number
  /** 目標達成予定日 (YYYY-MM-DD) */
  targetDate?: string
  updatedAt: string
}

export type ExercisePattern =
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'core'
  | 'isolation'
  | 'carry'

export interface Exercise {
  id: string
  name: string
  /** 主動筋。メニュー提案のスコアリングで重み 3 */
  primary: MuscleId[]
  /** 協働筋。重み 1 */
  secondary: MuscleId[]
  /** 実施に必要な機材。すべて揃っている場合のみ提案対象 */
  equipment: EquipmentId[]
  pattern: ExercisePattern
  /** コンパウンド種目は時間効率が良いので優先される */
  compound: boolean
  minLevel: ExperienceLevel
  /** ダンベル種目の推奨重量 = 体重 × loadFactor (片手あたり) */
  loadFactor?: number
  /** 左右交互に行う種目。所要時間が倍になる */
  unilateral?: boolean
  /** 通常種目ができない人向けの軽減バージョン。他に選択肢がある限り優先しない */
  regression?: boolean
  /** ユーザーが自分で追加した種目 */
  custom?: boolean
  /** 初回の推奨重量(kg)。ユーザー追加種目で loadFactor の代わりに使う */
  defaultWeightKg?: number
  tips: string
}

export interface PlannedSet {
  weightKg: number | null
  reps: number
}

export interface PlannedExercise {
  exerciseId: string
  sets: number
  /** 目標レップ数の範囲 [下限, 上限] */
  repRange: [number, number]
  restSec: number
  /** 推奨重量(kg)。自重種目や算出不能な場合は null */
  suggestedWeightKg: number | null
  /** 前回の実績から重量を決めた理由。初回など履歴が無い場合は無し */
  progressionNote?: string
  estimatedMinutes: number
}

export interface CardioPlan {
  name: string
  minutes: number
  /** 目標心拍ゾーン [下限, 上限] bpm */
  hrZone: [number, number]
  note: string
}

export interface WorkoutPlan {
  id: string
  createdAt: string
  goalType: GoalType
  targetMuscles: MuscleId[]
  warmupMinutes: number
  exercises: PlannedExercise[]
  cardio: CardioPlan | null
  totalMinutes: number
}

export interface LoggedSet {
  weightKg: number | null
  reps: number
  done: boolean
}

export interface LoggedExercise {
  exerciseId: string
  sets: LoggedSet[]
}

export interface WorkoutSession {
  id: string
  /** YYYY-MM-DD */
  date: string
  startedAt: string
  finishedAt?: string
  planId?: string
  targetMuscles: MuscleId[]
  exercises: LoggedExercise[]
  cardioMinutes: number
  bodyWeightKg?: number
  note: string
}

/** 体重の記録。トレーニングしない日も単独で残せる */
export interface BodyWeightEntry {
  /** YYYY-MM-DD */
  date: string
  weightKg: number
}
