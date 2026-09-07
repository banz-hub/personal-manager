import type { ExerciseMap } from '../data/exercises'
import { BUILTIN_EXERCISE_MAP } from '../data/exercises'
import type { Goal, Profile, WorkoutSession } from '../types'
import { estimate1RM, lastPerformance, personalBest } from './progression'

/**
 * 完了したトレーニングを自動採点する。
 * 「やったかどうか」ではなく「前回からどう変わったか」を中心に見るので、
 * 続けるほど基準が上がっていく。
 */

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D'

export interface EvaluationFactor {
  label: string
  /** 画面に出す実測値 */
  value: string
  points: number
  max: number
  /** その項目の一言評価 */
  note: string
}

export interface WorkoutEvaluation {
  /** 0〜100 */
  score: number
  grade: Grade
  headline: string
  factors: EvaluationFactor[]
  /** 次回に向けた具体的な助言 */
  advice: string[]
  /** 自己ベストを更新した種目名 */
  personalRecords: string[]
}

const GRADE_THRESHOLDS: Array<[Grade, number]> = [
  ['S', 90],
  ['A', 78],
  ['B', 64],
  ['C', 48],
  ['D', 0],
]

function toGrade(score: number): Grade {
  return GRADE_THRESHOLDS.find(([, min]) => score >= min)?.[0] ?? 'D'
}

const HEADLINES: Record<Grade, string> = {
  S: '文句なしの内容です。今日の自分を覚えておいてください。',
  A: '狙いどおりに追い込めています。この水準を維持しましょう。',
  B: '悪くない一日です。あと一歩、伸ばせる余地があります。',
  C: '記録は残せました。次回は量か強度のどちらかを上げましょう。',
  D: 'まずは続けたことに意味があります。次はセットを完了させることだけ狙いましょう。',
}

function volumeOf(session: WorkoutSession): number {
  return session.exercises.reduce(
    (acc, ex) =>
      acc + ex.sets.filter((s) => s.done).reduce((a, s) => a + (s.weightKg ?? 0) * s.reps, 0),
    0,
  )
}

function durationMinutes(session: WorkoutSession): number | null {
  if (!session.finishedAt) return null
  const ms = new Date(session.finishedAt).getTime() - new Date(session.startedAt).getTime()
  return Math.max(0, Math.round(ms / 60000))
}

export function evaluateSession(
  session: WorkoutSession,
  allSessions: WorkoutSession[],
  profile: Profile | null,
  goal: Goal | null,
  exerciseMap: ExerciseMap = BUILTIN_EXERCISE_MAP,
): WorkoutEvaluation {
  const factors: EvaluationFactor[] = []
  const advice: string[] = []
  const personalRecords: string[] = []

  // --- 1. 完了率 (30点) ---
  const plannedSets = session.exercises.reduce((acc, ex) => acc + ex.sets.length, 0)
  const doneSets = session.exercises.reduce(
    (acc, ex) => acc + ex.sets.filter((s) => s.done).length,
    0,
  )
  const completion = plannedSets > 0 ? doneSets / plannedSets : 0
  factors.push({
    label: '完了率',
    value: `${doneSets} / ${plannedSets} セット`,
    points: Math.round(completion * 30),
    max: 30,
    note:
      completion >= 1
        ? '予定を全部やりきりました'
        : completion >= 0.8
          ? 'ほぼ予定どおりです'
          : '残したセットがあります',
  })
  if (completion < 0.8 && plannedSets > 0) {
    advice.push(
      '予定を最後まで終えられていません。1日の時間設定が実態に合っていないか、種目数が多い可能性があります。設定で「1日に使える時間」を見直すと、メニューの量が自動で調整されます。',
    )
  }

  // --- 2. 前回との比較 (25点) ---
  const previous = allSessions
    .filter((s) => s.finishedAt && s.id !== session.id && s.date <= session.date)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
  const volume = volumeOf(session)
  const prevVolume = previous ? volumeOf(previous) : null

  if (prevVolume != null && prevVolume > 0) {
    const ratio = volume / prevVolume
    const diffPct = Math.round((ratio - 1) * 100)
    // 前回比 +5% で満点、-20% で 0 点になるように配点する
    const points = Math.round(Math.max(0, Math.min(1, (ratio - 0.8) / 0.25)) * 25)
    factors.push({
      label: '前回比のボリューム',
      value: `${Math.round(volume).toLocaleString()}kg (${diffPct >= 0 ? '+' : ''}${diffPct}%)`,
      points,
      max: 25,
      note:
        diffPct >= 5
          ? '前回を上回りました'
          : diffPct >= -5
            ? '前回とほぼ同じ水準です'
            : '前回より落ちています',
    })
    if (diffPct < -5) {
      advice.push(
        `総挙上量が前回より ${Math.abs(diffPct)}% 落ちています。疲労が残っているなら休養日を挟み、そうでなければ重量か回数のどちらかを前回水準まで戻しましょう。`,
      )
    }
  } else {
    factors.push({
      label: '前回比のボリューム',
      value: `${Math.round(volume).toLocaleString()}kg`,
      points: 18,
      max: 25,
      note: '比較できる前回の記録がまだありません',
    })
  }

  // --- 3. 強度・進歩 (25点) ---
  let progressed = 0
  let compared = 0
  for (const logged of session.exercises) {
    const done = logged.sets.filter((s) => s.done)
    if (done.length === 0) continue
    const best = personalBest(allSessions, logged.exerciseId, session.date)
    const last = lastPerformance(allSessions, logged.exerciseId, session.date)
    let today1RM: number | null = null
    for (const s of done) {
      const e = estimate1RM(s.weightKg, s.reps)
      if (e != null && (today1RM == null || e > today1RM)) today1RM = e
    }
    if (best?.best1RM != null && today1RM != null) {
      compared++
      if (today1RM > best.best1RM) {
        progressed++
        personalRecords.push(exerciseMap[logged.exerciseId]?.name ?? logged.exerciseId)
      }
    }
    // 重量が同じで回数が伸びていれば進歩とみなす
    if (last && today1RM == null) {
      const lastReps = last.sets.reduce((a, s) => a + s.reps, 0)
      const nowReps = done.reduce((a, s) => a + s.reps, 0)
      compared++
      if (nowReps > lastReps) progressed++
    }
  }
  const progressRatio = compared > 0 ? progressed / compared : 0
  // 毎回更新できるものではないので、維持できていれば半分の点は入るようにする
  factors.push({
    label: '前回からの進歩',
    value: compared > 0 ? `${progressed} / ${compared} 種目で更新` : '比較対象なし',
    points:
      compared > 0 ? Math.round((0.5 + 0.5 * Math.min(1, progressRatio * 2)) * 25) : 15,
    max: 25,
    note:
      compared === 0
        ? '次回から前回比を見られます'
        : progressed > 0
          ? '記録を更新した種目があります'
          : '今回は更新なし。同じ重量を続けるのも前進です',
  })

  // --- 4. 目標に沿った内容か (20点) ---
  const needsCardio = goal?.type === 'fatloss' || goal?.type === 'endurance'
  if (needsCardio) {
    const minutes = session.cardioMinutes
    const points = Math.round(Math.min(1, minutes / 15) * 20)
    factors.push({
      label: '有酸素運動',
      value: `${minutes} 分`,
      points,
      max: 20,
      note: minutes >= 15 ? '目標に沿った量です' : minutes > 0 ? 'もう少し伸ばせます' : '未実施です',
    })
    if (minutes < 10) {
      advice.push(
        '減量・持久力が目標なら、筋トレ後に15分ほど有酸素を足すと消費カロリーが伸びます。会話ができる程度の強度で十分です。',
      )
    }
  } else {
    // 時間内に収まっているか (長すぎる休憩や中だるみの検出)
    const minutes = durationMinutes(session)
    const budget = profile?.dailyMinutes ?? 45
    let points = 15
    let note = '所要時間は記録されていません'
    let value = '—'
    if (minutes != null && minutes > budget * 3) {
      // 記録画面を開いたまま放置した場合など。実時間として扱わず中立の点にする
      points = 14
      note = '所要時間を計測できませんでした（記録を開いたままだった可能性があります）'
      value = '計測なし'
    } else if (minutes != null && minutes > 0) {
      const ratio = minutes / budget
      // 長引いても0点にはしない。あくまで改善の余地を示す指標
      points = Math.round((ratio <= 1.15 ? 1 : Math.max(0.4, 1 - (ratio - 1.15))) * 20)
      note =
        ratio <= 1.15
          ? '予定した時間に収まりました'
          : '予定より長引いています。休憩が伸びていないか確認しましょう'
      value = `${minutes} 分 / 目安 ${budget} 分`
    }
    factors.push({ label: '時間の使い方', value, points, max: 20, note })
  }

  const score = Math.max(
    0,
    Math.min(100, factors.reduce((acc, f) => acc + f.points, 0)),
  )
  const grade = toGrade(score)

  // --- 次回に向けた具体的な助言 ---
  for (const logged of session.exercises) {
    const done = logged.sets.filter((s) => s.done)
    if (done.length < 2) continue
    const weights = done.map((s) => s.weightKg).filter((w): w is number => w != null)
    if (weights.length === 0) continue
    const topWeight = Math.max(...weights)
    const repsAtTop = done.filter((s) => s.weightKg === topWeight).map((s) => s.reps)
    const minReps = Math.min(...repsAtTop)
    const name = exerciseMap[logged.exerciseId]?.name ?? logged.exerciseId
    // 全セットで12回以上こなせているなら重量を上げる合図
    if (minReps >= 12) {
      advice.push(`${name} は ${topWeight}kg で全セット ${minReps}回に届いています。次回は1段階重くしましょう。`)
    }
  }
  if (personalRecords.length > 0) {
    advice.unshift(
      `${personalRecords.join('・')} で自己ベストを更新しました。同じ重量をもう1〜2回こなせるようになってから、次の段階に上げてください。`,
    )
  }
  if (advice.length === 0) {
    advice.push('今の進め方で問題ありません。次回も同じ流れで続けましょう。')
  }

  return {
    score,
    grade,
    headline: HEADLINES[grade],
    factors,
    advice: advice.slice(0, 4),
    personalRecords,
  }
}
