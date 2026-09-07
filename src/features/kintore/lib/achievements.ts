import { MUSCLES } from '../data/muscles'
import type { BodyWeightEntry, Goal, MuscleId, Profile, WorkoutSession } from '../types'
import { toDateKey } from './calc'

/** 完了した記録から算出される、モチベーション表示用の集計値 */
export interface TrainingStats {
  totalSessions: number
  totalSets: number
  totalVolumeKg: number
  totalCardioMinutes: number
  /** 連続してトレーニングした日数。今日がまだなら昨日までで数える */
  streakDays: number
  longestStreakDays: number
  /** 今週(月曜始まり)の実施回数 */
  thisWeekCount: number
  /** プロフィールで設定した週あたりの目標日数 */
  weeklyTarget: number
  /** 週の目標を連続で達成している週数 */
  weekStreak: number
  /** 一度でも対象部位にした部位 */
  musclesTrained: Set<MuscleId>
  /** 今日を除く直近の完了セッションの総挙上量 */
  previousVolumeKg: number | null
  /** トレーニングした日 (YYYY-MM-DD) */
  activeDays: Set<string>
}

export function sessionVolume(s: WorkoutSession): number {
  return s.exercises.reduce(
    (acc, ex) =>
      acc + ex.sets.filter((x) => x.done).reduce((a, x) => a + (x.weightKg ?? 0) * x.reps, 0),
    0,
  )
}

export function sessionDoneSets(s: WorkoutSession): number {
  return s.exercises.reduce((acc, ex) => acc + ex.sets.filter((x) => x.done).length, 0)
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

/** 月曜始まりの週の開始日 */
export function startOfWeek(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  // getDay(): 日曜=0。月曜を週初めにするため日曜だけ6日戻す
  const back = (out.getDay() + 6) % 7
  out.setDate(out.getDate() - back)
  return out
}

export function computeStats(
  sessions: WorkoutSession[],
  profile: Profile | null,
  today = new Date(),
): TrainingStats {
  const finished = sessions.filter((s) => s.finishedAt)
  const activeDays = new Set(finished.map((s) => s.date))
  const todayKey = toDateKey(today)

  const musclesTrained = new Set<MuscleId>()
  for (const s of finished) for (const m of s.targetMuscles) musclesTrained.add(m)

  // 今日を除いた直近の記録。「前回を超える」ミッションの基準にする
  const previous = finished
    .filter((s) => s.date !== todayKey)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]

  const weekStart = startOfWeek(today)
  const thisWeekCount = countInWeek(activeDays, weekStart)
  const weeklyTarget = Math.max(1, profile?.daysPerWeek ?? 3)

  return {
    totalSessions: finished.length,
    totalSets: finished.reduce((acc, s) => acc + sessionDoneSets(s), 0),
    totalVolumeKg: finished.reduce((acc, s) => acc + sessionVolume(s), 0),
    totalCardioMinutes: finished.reduce((acc, s) => acc + s.cardioMinutes, 0),
    streakDays: currentStreak(activeDays, today),
    longestStreakDays: longestStreak(activeDays),
    thisWeekCount,
    weeklyTarget,
    weekStreak: weekStreak(activeDays, weekStart, weeklyTarget),
    musclesTrained,
    previousVolumeKg: previous ? sessionVolume(previous) : null,
    activeDays,
  }
}

/** 今日まだ記録していなくてもストリークは途切れていない扱いにする */
function currentStreak(days: Set<string>, today: Date): number {
  let cursor = new Date(today)
  if (!days.has(toDateKey(cursor))) cursor = addDays(cursor, -1)
  let streak = 0
  while (days.has(toDateKey(cursor))) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}

function longestStreak(days: Set<string>): number {
  const sorted = [...days].sort()
  let best = 0
  let run = 0
  let prev: string | null = null
  for (const day of sorted) {
    run = prev !== null && toDateKey(addDays(new Date(prev), 1)) === day ? run + 1 : 1
    best = Math.max(best, run)
    prev = day
  }
  return best
}

function countInWeek(days: Set<string>, weekStart: Date): number {
  let count = 0
  for (let i = 0; i < 7; i++) {
    if (days.has(toDateKey(addDays(weekStart, i)))) count++
  }
  return count
}

/** 週の目標日数を連続で満たしている週数。今週は達成済みの場合のみ数える */
function weekStreak(days: Set<string>, currentWeekStart: Date, target: number): number {
  let streak = 0
  let cursor = new Date(currentWeekStart)
  if (countInWeek(days, cursor) < target) cursor = addDays(cursor, -7)
  while (countInWeek(days, cursor) >= target) {
    streak++
    cursor = addDays(cursor, -7)
  }
  return streak
}

/** 直近 n 日の実施状況。カレンダー風の帯に使う */
export function recentDays(
  activeDays: Set<string>,
  n = 14,
  today = new Date(),
): Array<{ date: string; label: string; active: boolean; isToday: boolean }> {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(today, -i)
    const key = toDateKey(d)
    out.push({
      date: key,
      label: String(d.getDate()),
      active: activeDays.has(key),
      isToday: i === 0,
    })
  }
  return out
}

export interface CalendarDay {
  date: string
  label: string
  active: boolean
  isToday: boolean
  /** 今週のまだ来ていない日 */
  future: boolean
}

export const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日']

/**
 * 月曜始まりで直近 n 週間ぶんのカレンダーを返す。
 * 今週の未来の日も枠として並べるので、週の残りが何日あるか一目で分かる。
 */
export function recentWeeks(
  activeDays: Set<string>,
  weeks = 4,
  today = new Date(),
): CalendarDay[][] {
  const todayKey = toDateKey(today)
  const start = addDays(startOfWeek(today), -7 * (weeks - 1))
  const out: CalendarDay[][] = []
  for (let w = 0; w < weeks; w++) {
    const row: CalendarDay[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d)
      const key = toDateKey(date)
      row.push({
        date: key,
        label: String(date.getDate()),
        active: activeDays.has(key),
        isToday: key === todayKey,
        future: key > todayKey,
      })
    }
    out.push(row)
  }
  return out
}

// ---------- 今日のミッション ----------

export interface Mission {
  id: string
  label: string
  hint?: string
  done: boolean
}

/**
 * 毎日リセットされる小さな目標。
 * 「今日これをやれば1日ぶん前進した」と分かる粒度にしている。
 */
export function todaysMissions(
  sessions: WorkoutSession[],
  goal: Goal | null,
  stats: TrainingStats,
  weights: BodyWeightEntry[] = [],
  today = new Date(),
): Mission[] {
  const todayKey = toDateKey(today)
  const session = sessions.find((s) => s.date === todayKey)
  const weightLogged =
    weights.some((w) => w.date === todayKey) || session?.bodyWeightKg != null
  const plannedSets = session?.exercises.reduce((acc, ex) => acc + ex.sets.length, 0) ?? 0
  const doneSets = session ? sessionDoneSets(session) : 0
  const volume = session ? sessionVolume(session) : 0

  const missions: Mission[] = [
    {
      id: 'workout',
      label: '今日のトレーニングを完了する',
      done: Boolean(session?.finishedAt),
    },
    {
      id: 'all_sets',
      label: '予定したセットをすべて終える',
      hint: plannedSets > 0 ? `${doneSets} / ${plannedSets} セット` : undefined,
      done: plannedSets > 0 && doneSets >= plannedSets,
    },
    {
      id: 'bodyweight',
      label: '今日の体重を記録する',
      done: weightLogged,
    },
  ]

  if (goal?.type === 'fatloss' || goal?.type === 'endurance') {
    missions.push({
      id: 'cardio',
      label: '有酸素運動を10分以上おこなう',
      hint: session ? `${session.cardioMinutes} 分` : undefined,
      done: (session?.cardioMinutes ?? 0) >= 10,
    })
  } else if (stats.previousVolumeKg != null && stats.previousVolumeKg > 0) {
    const target = Math.round(stats.previousVolumeKg)
    missions.push({
      id: 'beat_volume',
      label: `前回の総挙上量 ${target.toLocaleString()}kg を超える`,
      hint: `${Math.round(volume).toLocaleString()} kg`,
      done: volume > stats.previousVolumeKg,
    })
  }

  return missions
}

// ---------- 実績バッジ ----------

export interface BadgeDef {
  id: string
  icon: string
  name: string
  description: string
  target: number
  /** 単位 (進捗表示用) */
  unit: string
  value: (s: TrainingStats) => number
}

export const BADGES: BadgeDef[] = [
  {
    id: 'first_workout',
    icon: '🎬',
    name: 'はじめの一歩',
    description: '初めてトレーニングを記録する',
    target: 1,
    unit: '回',
    value: (s) => s.totalSessions,
  },
  {
    id: 'streak_3',
    icon: '🔥',
    name: '三日坊主を超えた',
    description: '3日連続でトレーニングする',
    target: 3,
    unit: '日',
    value: (s) => Math.max(s.streakDays, s.longestStreakDays),
  },
  {
    id: 'sessions_10',
    icon: '🔟',
    name: '10回達成',
    description: '累計10回トレーニングする',
    target: 10,
    unit: '回',
    value: (s) => s.totalSessions,
  },
  {
    id: 'week_target',
    icon: '📅',
    name: '週の約束',
    description: '週の目標日数を2週連続で達成する',
    target: 2,
    unit: '週',
    value: (s) => s.weekStreak,
  },
  {
    id: 'streak_7',
    icon: '🔥',
    name: '一週間継続',
    description: '7日連続でトレーニングする',
    target: 7,
    unit: '日',
    value: (s) => Math.max(s.streakDays, s.longestStreakDays),
  },
  {
    id: 'volume_10k',
    icon: '🪨',
    name: '1万キロ',
    description: '総挙上量が10,000kgに到達する',
    target: 10000,
    unit: 'kg',
    value: (s) => s.totalVolumeKg,
  },
  {
    id: 'sets_500',
    icon: '✅',
    name: '500セット',
    description: '累計500セットをこなす',
    target: 500,
    unit: 'セット',
    value: (s) => s.totalSets,
  },
  {
    id: 'full_body',
    icon: '🧍',
    name: '全身制覇',
    description: '14部位すべてを一度は対象にする',
    target: MUSCLES.length,
    unit: '部位',
    value: (s) => s.musclesTrained.size,
  },
  {
    id: 'cardio_300',
    icon: '🏃',
    name: '走り込み',
    description: '有酸素運動が累計300分に到達する',
    target: 300,
    unit: '分',
    value: (s) => s.totalCardioMinutes,
  },
  {
    id: 'week_target_8',
    icon: '🗓️',
    name: '2ヶ月の約束',
    description: '週の目標日数を8週連続で達成する',
    target: 8,
    unit: '週',
    value: (s) => s.weekStreak,
  },
  {
    id: 'sessions_50',
    icon: '🏅',
    name: '50回達成',
    description: '累計50回トレーニングする',
    target: 50,
    unit: '回',
    value: (s) => s.totalSessions,
  },
  {
    id: 'streak_30',
    icon: '🏆',
    name: '皆勤賞',
    description: '30日連続でトレーニングする',
    target: 30,
    unit: '日',
    value: (s) => Math.max(s.streakDays, s.longestStreakDays),
  },
  {
    id: 'volume_100k',
    icon: '🗿',
    name: '10万キロ',
    description: '総挙上量が100,000kgに到達する',
    target: 100000,
    unit: 'kg',
    value: (s) => s.totalVolumeKg,
  },
  {
    id: 'sessions_100',
    icon: '💯',
    name: '100回達成',
    description: '累計100回トレーニングする',
    target: 100,
    unit: '回',
    value: (s) => s.totalSessions,
  },
]

export interface BadgeProgress {
  badge: BadgeDef
  current: number
  unlocked: boolean
  /** 0〜1 */
  ratio: number
}

export function evaluateBadges(stats: TrainingStats): BadgeProgress[] {
  return BADGES.map((badge) => {
    const current = Math.floor(badge.value(stats))
    return {
      badge,
      current,
      unlocked: current >= badge.target,
      ratio: Math.min(1, current / badge.target),
    }
  })
}

/** 未獲得のうち、達成が近いものから n 件 */
export function nextBadges(progress: BadgeProgress[], n = 3): BadgeProgress[] {
  return progress
    .filter((p) => !p.unlocked)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, n)
}

// ---------- 獲得済みバッジの記憶 (獲得の瞬間を知らせるため) ----------

const SEEN_KEY = 'kintore.seenBadges'

/** 未記録なら null。初回起動と「まだ何も獲得していない」を区別するため */
export function loadSeenBadges(): string[] | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return raw ? (JSON.parse(raw) as string[]) : null
  } catch {
    return null
  }
}

export function saveSeenBadges(ids: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids))
  } catch {
    // プライベートモードなどで保存できない場合は通知を諦めるだけ
  }
}
