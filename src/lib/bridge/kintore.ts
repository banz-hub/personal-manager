/**
 * 筋トレログから今日のトレーニングの状況を読む (読み取り専用)。
 *
 * トレーニングの内容と実績の正本は筋トレログ。こちらは **一切書き込まない。**
 * 読むのは司令塔の判断に要ることだけで、セット数・重量・種目には触らない。
 *
 * よてい帳と同じく、同じオリジンに置いてあることが前提。
 */

import { createStore, get } from 'idb-keyval'
import { addDays, dateKey, daysBetween } from '../date'

/** 筋トレログのデータのうち、こちらが読む部分だけの型 */
interface KProfile {
  /** 1 日のトレーニングに使える時間 (分) */
  dailyMinutes: number
  /** 週あたりのトレーニング日数 */
  daysPerWeek: number
  /** 1 日の区切り時刻。深夜に運動する人向け */
  dayCutoffHour?: number
}

interface KSet {
  weightKg: number | null
  reps: number
  done: boolean
}

interface KSession {
  id: string
  /** YYYY-MM-DD */
  date: string
  startedAt: string
  finishedAt?: string
  exercises: Array<{ exerciseId: string; sets: KSet[] }>
  cardioMinutes: number
}

/**
 * 記録から時間を出すときの上下限。
 *
 * 実データに「開始したまま終了を押し忘れて 936 分」という記録があった。
 * そのまま使うと平均が壊れて予定が滅茶苦茶になるので、
 * 外れた値は捨てて、セット数からの見積もりに切り替える。
 */
const MIN_PLAUSIBLE_MIN = 5
const MAX_PLAUSIBLE_MIN = 180

/** セット 1 本あたりの見込み (分)。準備運動ぶんを足して使う */
const MIN_PER_SET = 2.5
const WARMUP_MIN = 10

export interface KintoreDay {
  available: boolean
  reason?: string
  /**
   * 筋トレログ側が「今日」とみなしている日付。
   * 1日の区切りを 3 時などにずらしていると、深夜は司令塔の今日と 1 日ずれる。
   * どちらの日の話かを画面で示せるように、必ず返す。
   */
  forDate: string
  /** 今日すでにやったか */
  doneToday: boolean
  /** 今日の実績時間 (分)。やっていれば入る */
  todayMinutes?: number
  /** 今日はやる日か (筋トレログに予定表が無いので、司令塔側の推定) */
  plannedToday: boolean
  /** その推定の理由。推定であることが分かる言い方にする */
  planReason: string
  /** 予定に入れるときの見込み時間 (分) */
  estimateMin: number
  /** 最後にやった日 */
  lastWorkoutOn?: string
  /** 最後にやってから何日空いたか。一度もやっていなければ null */
  restDays: number | null
  /** 何日続けてやっているか */
  streakDays: number
  /** 休養をとったほうがよさそうか */
  restRecommended: boolean
  /** 昨日の実績時間 (分)。今日の詰め込み具合の判断に使う */
  yesterdayMinutes?: number
  /** 直近 7 日でやった回数 */
  last7Count: number
  /** 週あたりの目標回数 */
  daysPerWeek: number
}

const store = createStore('kintore-app', 'state')

/**
 * 1 回ぶんの時間。記録の時刻が当てにならないときは、セット数から見積もる。
 * どちらで出したかを呼び出し側が知る必要はないので、分だけ返す。
 */
export function sessionMinutes(session: KSession): number {
  if (session.finishedAt) {
    const min = Math.round(
      (new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime()) / 60_000,
    )
    if (min >= MIN_PLAUSIBLE_MIN && min <= MAX_PLAUSIBLE_MIN) return min
  }
  const sets = session.exercises.reduce((sum, e) => sum + e.sets.length, 0)
  return Math.round(sets * MIN_PER_SET + WARMUP_MIN + (session.cardioMinutes ?? 0))
}

/**
 * 筋トレログの「今日」。深夜にやる人向けに区切り時刻をずらせるので、それに合わせる。
 * 例: 区切りが 3 時なら、深夜 2 時は前日のトレーニングとして数える。
 */
export function kintoreToday(now: Date, cutoffHour = 0): string {
  const shifted = new Date(now)
  shifted.setHours(shifted.getHours() - cutoffHour)
  return dateKey(shifted)
}

/** 続けてやっている日数 (その日から遡って数える) */
export function streakEndingAt(dates: Set<string>, from: string): number {
  let count = 0
  let cursor = from
  while (dates.has(cursor)) {
    count += 1
    cursor = addDays(cursor, -1)
  }
  return count
}

export interface DerivedInput {
  profile: KProfile
  sessions: KSession[]
  today: string
}

/** 読み取った記録から、司令塔が使う形に落とす */
export function deriveKintoreDay(input: DerivedInput): KintoreDay {
  const { profile, sessions, today } = input
  const daysPerWeek = Math.max(1, Math.min(7, profile.daysPerWeek || 3))

  const dates = new Set(sessions.map((s) => s.date))
  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date))
  const todaySession = sorted.find((s) => s.date === today)
  const doneToday = todaySession != null

  const past = sorted.filter((s) => s.date < today)
  const lastWorkoutOn = (todaySession ?? past[0])?.date
  const restDays = past[0] ? daysBetween(past[0].date, today) : null

  const yesterday = addDays(today, -1)
  const yesterdaySession = sorted.find((s) => s.date === yesterday)

  // 連続日数は、今日やっていれば今日から、まだなら昨日から数える
  const streakDays = streakEndingAt(dates, doneToday ? today : yesterday)

  const from7 = addDays(today, -6)
  const last7Count = sessions.filter((s) => s.date >= from7 && s.date <= today).length

  // 3 日続けたら一度休む、という目安。筋トレログ側に休養日の設定は無いので司令塔の判断
  const restRecommended = streakDays >= 3

  const recent = past.slice(0, 5).map(sessionMinutes)
  const estimateMin =
    recent.length > 0
      ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length / 5) * 5
      : profile.dailyMinutes || 45

  const { plannedToday, planReason } = decideToday({
    doneToday,
    restRecommended,
    streakDays,
    last7Count,
    daysPerWeek,
    restDays,
    lastWorkoutOn,
  })

  return {
    available: true,
    forDate: today,
    doneToday,
    todayMinutes: todaySession ? sessionMinutes(todaySession) : undefined,
    plannedToday,
    planReason,
    estimateMin,
    lastWorkoutOn,
    restDays,
    streakDays,
    restRecommended,
    yesterdayMinutes: yesterdaySession ? sessionMinutes(yesterdaySession) : undefined,
    last7Count,
    daysPerWeek,
  }
}

function decideToday(a: {
  doneToday: boolean
  restRecommended: boolean
  streakDays: number
  last7Count: number
  daysPerWeek: number
  restDays: number | null
  lastWorkoutOn?: string
}): { plannedToday: boolean; planReason: string } {
  if (a.doneToday) {
    return { plannedToday: false, planReason: '今日はもう終えています' }
  }
  if (!a.lastWorkoutOn) {
    return { plannedToday: true, planReason: 'まだ記録がないので、今日から始める前提で置きます' }
  }
  if (a.restRecommended) {
    return {
      plannedToday: false,
      planReason: `${a.streakDays}日続けているので、今日は休養に回すのを勧めます`,
    }
  }
  if (a.last7Count >= a.daysPerWeek) {
    return {
      plannedToday: false,
      planReason: `直近7日で${a.last7Count}回。週${a.daysPerWeek}回の目標には届いているので、今日は空けても構いません`,
    }
  }
  return {
    plannedToday: true,
    planReason: `直近7日で${a.last7Count}回。週${a.daysPerWeek}回に届いていないので、今日に置きます`,
  }
}

/**
 * 筋トレログを読む。
 * 使えないときは available:false を返し、理由を添える。例外は投げない
 * (連携が使えないだけで、司令塔は動くべきなので)。
 */
export async function loadKintoreDay(now: Date = new Date()): Promise<KintoreDay> {
  const empty: KintoreDay = {
    available: false,
    forDate: dateKey(now),
    doneToday: false,
    plannedToday: false,
    planReason: '',
    estimateMin: 0,
    restDays: null,
    streakDays: 0,
    restRecommended: false,
    last7Count: 0,
    daysPerWeek: 0,
  }

  try {
    const [profile, sessions] = await Promise.all([
      get<KProfile>('profile', store),
      get<KSession[]>('sessions', store),
    ])

    if (!profile && !sessions?.length) {
      return {
        ...empty,
        reason:
          '筋トレログのデータが見つかりません。同じオリジン (banz-hub.github.io) で開いているか確認してください。開発中の localhost ではポートが違うと読めません。',
      }
    }

    const today = kintoreToday(now, profile?.dayCutoffHour ?? 0)
    return deriveKintoreDay({
      profile: profile ?? { dailyMinutes: 45, daysPerWeek: 3 },
      sessions: sessions ?? [],
      today,
    })
  } catch (e) {
    return {
      ...empty,
      reason: `筋トレログのデータを読めませんでした (${e instanceof Error ? e.message : String(e)})`,
    }
  }
}

/** 期間内の 1 日ぶんの記録 (週次レビュー用) */
export interface WorkoutDay {
  date: string
  minutes: number
}

/**
 * 期間の筋トレ実績を読む (読み取り専用)。
 * 週次レビューでしか使わないので、日付と時間だけに絞ってある。
 */
export async function loadKintoreRange(from: string, to: string): Promise<WorkoutDay[] | null> {
  try {
    const sessions = await get<KSession[]>('sessions', store)
    if (!sessions) return null
    return sessions
      .filter((s) => s.date >= from && s.date <= to)
      .map((s) => ({ date: s.date, minutes: sessionMinutes(s) }))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch {
    return null
  }
}
