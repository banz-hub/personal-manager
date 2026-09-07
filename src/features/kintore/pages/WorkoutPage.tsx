import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import EvaluationCard from '../components/EvaluationCard'
import RestTimer from '../components/RestTimer'

import { muscleName } from '../data/muscles'
import { appNow, cutoffOf, shiftDateKey, shortDateLabel, toDateKey } from '../lib/calc'
import { evaluateSession } from '../lib/evaluation'
import { GOAL_LABEL, generateWorkoutPlan } from '../lib/planner'
import {
  applyProgression,
  estimate1RM,
  lastPerformance,
  personalBest,
  type ExercisePerformance,
} from '../lib/progression'
import { useApp } from '../state/AppContext'
import type {
  LoggedExercise,
  LoggedSet,
  PlannedExercise,
  WorkoutPlan,
  WorkoutSession,
} from '../types'

/** 表示1件分。提案されただけの種目と、記録中の種目の両方を同じ形で扱う */
interface Row {
  exerciseId: string
  planned?: PlannedExercise
  logged?: LoggedExercise
  /** session.exercises 内での位置。未記録なら -1 */
  loggedIdx: number
  /** 前回この種目をやったときの内容 */
  last: ExercisePerformance | null
  /** 今日の推定1RMが自己ベストを超えたか */
  isPr: boolean
  today1RM: number | null
}

/** 日付ごとに安定したシード。同じ日なら再訪してもメニューが変わらない */
function seedForToday(dateKey: string, extra: number): number {
  const key = dateKey
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return (h + extra * 7919) | 0
}

function buildSession(plan: WorkoutPlan, dateKey: string): WorkoutSession {
  const exercises: LoggedExercise[] = plan.exercises.map((p) => ({
    exerciseId: p.exerciseId,
    sets: Array.from({ length: p.sets }, (): LoggedSet => ({
      weightKg: p.suggestedWeightKg,
      reps: p.repRange[0],
      done: false,
    })),
  }))
  return {
    id: `ws_${Date.now()}`,
    date: dateKey,
    startedAt: new Date().toISOString(),
    planId: plan.id,
    targetMuscles: plan.targetMuscles,
    exercises,
    cardioMinutes: 0,
    note: '',
  }
}

export default function WorkoutPage() {
  const { profile, goal, sessions, weights, exercises, exerciseMap, upsertSession, logWeight } = useApp()
  const [reroll, setReroll] = useState(0)
  const [excluded, setExcluded] = useState<string[]>([])
  const [session, setSession] = useState<WorkoutSession | null>(null)
  const sessionRef = useRef<WorkoutSession | null>(null)
  /** 休憩タイマー。null なら非表示 */
  const [rest, setRest] = useState<{ endsAt: number; totalSec: number } | null>(null)
  /** 記録中に追加する種目の選択 */
  const [addingId, setAddingId] = useState('')

  // 1日の区切り時刻を反映した「今日」。深夜0時を回っても設定次第で前日のままになる
  const todayKey = toDateKey(appNow(cutoffOf(profile)))

  const plan = useMemo(() => {
    if (!profile || !goal || goal.targetMuscles.length === 0) return null
    const base = generateWorkoutPlan(profile, goal.type, goal.targetMuscles, {
      seed: seedForToday(todayKey, reroll),
      excludeIds: excluded,
      exercises,
    })
    // 前回の実績があれば、そこから重量を決め直す（漸進性過負荷）
    return applyProgression(base, sessions, profile, todayKey, exerciseMap)
  }, [profile, goal, reroll, excluded, sessions, todayKey, exercises, exerciseMap])

  // 当日のセッションがあれば読み込む。未完了なら再開、完了済みなら結果と評価を表示する
  useEffect(() => {
    const today = toDateKey(appNow(cutoffOf(profile)))
    const todays = sessions.filter((s) => s.date === today)
    const current =
      todays.find((s) => !s.finishedAt) ??
      // 前夜に始めてそのまま日付をまたいだ記録も拾う。放置されたままにしないため
      sessions.find((s) => !s.finishedAt && s.date >= shiftDateKey(today, -1)) ??
      todays.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
    if (current) {
      sessionRef.current = current
      setSession(current)
    }
    // sessions の変化で上書きしないよう初回のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!profile) {
    return (
      <div className="page">
        <h1>今日のメニュー</h1>
        <p>先にプロフィールを入力してください。</p>
        <Link className="button primary" to="/kintore/profile">
          プロフィールを入力する
        </Link>
      </div>
    )
  }

  if (!goal || goal.targetMuscles.length === 0) {
    return (
      <div className="page">
        <h1>今日のメニュー</h1>
        <p>鍛えたい部位が未設定です。</p>
        <Link className="button primary" to="/kintore/goal">
          目標を設定する
        </Link>
      </div>
    )
  }

  function updateSession(next: WorkoutSession) {
    // 再レンダリング前に連続でタップされても取りこぼさないよう ref も同時に進める
    sessionRef.current = next
    setSession(next)
    void upsertSession(next)
  }

  /** 常に最新のセッションを元に更新する */
  function mutateSession(fn: (prev: WorkoutSession) => WorkoutSession) {
    const current = sessionRef.current
    if (!current) return
    updateSession(fn(current))
  }

  function start() {
    if (!plan) return
    updateSession(buildSession(plan, todayKey))
  }

  function patchSet(exIdx: number, setIdx: number, patch: Partial<LoggedSet>) {
    mutateSession((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) =>
        i !== exIdx
          ? ex
          : { ...ex, sets: ex.sets.map((s, j) => (j === setIdx ? { ...s, ...patch } : s)) },
      ),
    }))
  }

  function addSet(exIdx: number) {
    mutateSession((prev) => ({
      ...prev,
      exercises: prev.exercises.map((ex, i) => {
        if (i !== exIdx) return ex
        const last = ex.sets[ex.sets.length - 1]
        return { ...ex, sets: [...ex.sets, { ...last, done: false }] }
      }),
    }))
  }

  function finish() {
    mutateSession((prev) => ({ ...prev, finishedAt: new Date().toISOString() }))
    setRest(null)
  }

  /** セットを完了したら休憩タイマーを開始する */
  function startRest(sec: number) {
    setRest({ endsAt: Date.now() + sec * 1000, totalSec: sec })
  }

  /** 記録中のメニューに種目を足す */
  function addExercise(exerciseId: string) {
    const ex = exerciseMap[exerciseId]
    if (!ex) return
    const planned = plan?.exercises.find((p) => p.exerciseId === exerciseId)
    const sets = planned?.sets ?? 3
    const reps = planned?.repRange[0] ?? 10
    const weight =
      planned?.suggestedWeightKg ?? lastPerformance(sessions, exerciseId)?.topWeightKg ?? null
    mutateSession((prev) => ({
      ...prev,
      exercises: [
        ...prev.exercises,
        {
          exerciseId,
          sets: Array.from({ length: sets }, () => ({ weightKg: weight, reps, done: false })),
        },
      ],
    }))
    setAddingId('')
  }

  /** この記録を何日の分として残すかを変える */
  function setSessionDate(dateKey: string) {
    mutateSession((prev) => ({ ...prev, date: dateKey }))
  }

  /** 記録中のメニューから種目を外す */
  function removeExercise(exerciseId: string) {
    mutateSession((prev) => ({
      ...prev,
      exercises: prev.exercises.filter((e) => e.exerciseId !== exerciseId),
    }))
  }

  const doneSets = session?.exercises.reduce(
    (acc, ex) => acc + ex.sets.filter((s) => s.done).length,
    0,
  )
  const totalSets = session?.exercises.reduce((acc, ex) => acc + ex.sets.length, 0)
  const totalVolume = session?.exercises.reduce(
    (acc, ex) =>
      acc + ex.sets.filter((s) => s.done).reduce((a, s) => a + (s.weightKg ?? 0) * s.reps, 0),
    0,
  )

  // 記録開始後は保存済みセッションを正とする。再読み込みで提案が変わっても記録は失われない
  function decorate(exerciseId: string, logged?: LoggedExercise): Pick<Row, 'last' | 'isPr' | 'today1RM'> {
    const last = lastPerformance(sessions, exerciseId, todayKey)
    const best = personalBest(sessions, exerciseId, todayKey)
    let today1RM: number | null = null
    for (const s of logged?.sets ?? []) {
      if (!s.done) continue
      const e = estimate1RM(s.weightKg, s.reps)
      if (e != null && (today1RM == null || e > today1RM)) today1RM = e
    }
    const isPr = today1RM != null && best?.best1RM != null && today1RM > best.best1RM
    return { last, isPr, today1RM }
  }

  const rows: Row[] = session
    ? session.exercises.map((le, i) => ({
        exerciseId: le.exerciseId,
        planned: plan?.exercises.find((p) => p.exerciseId === le.exerciseId),
        logged: le,
        loggedIdx: i,
        ...decorate(le.exerciseId, le),
      }))
    : (plan?.exercises ?? []).map((p) => ({
        exerciseId: p.exerciseId,
        planned: p,
        loggedIdx: -1,
        ...decorate(p.exerciseId),
      }))

  // 記録を始めた日と、その翌日。日付をまたいだときの選択肢になる
  const startedDateKey = session ? toDateKey(new Date(session.startedAt)) : todayKey
  const nextDateKey = shiftDateKey(startedDateKey, 1)
  // 実際のカレンダー上で日付が変わったか (区切り時刻の設定とは別に判定する)
  const crossedMidnight = Boolean(session) && toDateKey(new Date()) !== startedDateKey

  return (
    <div className={`page${rest ? ' has-rest-timer' : ''}`}>
      <h1>今日のメニュー</h1>
      <p className="muted">
        {GOAL_LABEL[goal.type]} ／ 対象: {goal.targetMuscles.map(muscleName).join('・')} ／ 使える時間{' '}
        {profile.dailyMinutes}分
      </p>

      {session && crossedMidnight && (
        <section className="card celebrate">
          <h2>🌙 日付が変わりました</h2>
          <p>この記録をどちらの日の分として残しますか？ あとから変えられます。</p>
          <div className="segmented" role="group" aria-label="記録日の選択">
            <button
              type="button"
              className={session.date === startedDateKey ? 'is-on' : ''}
              onClick={() => setSessionDate(startedDateKey)}
            >
              前日分 {shortDateLabel(startedDateKey)}
            </button>
            <button
              type="button"
              className={session.date === nextDateKey ? 'is-on' : ''}
              onClick={() => setSessionDate(nextDateKey)}
            >
              翌日分 {shortDateLabel(nextDateKey)}
            </button>
          </div>
          <p className="muted">
            設定の「1日の区切り時刻」を決めておくと、毎回選ばなくても自動で振り分けられます。
          </p>
        </section>
      )}

      {rows.length === 0 ? (
        <div className="card">
          <p>
            条件に合う種目が見つかりませんでした。除外した種目を戻すか、対象部位を増やしてみてください。
          </p>
          <button type="button" onClick={() => setExcluded([])}>
            除外をリセット
          </button>
        </div>
      ) : (
        <>
          {plan && <div className="plan-summary card">
            <div className="stat-row">
              <div className="stat">
                <span className="stat-label">合計</span>
                <span className="stat-value">{plan.totalMinutes}</span>
                <span className="stat-sub">分</span>
              </div>
              <div className="stat">
                <span className="stat-label">ウォームアップ</span>
                <span className="stat-value">{plan.warmupMinutes}</span>
                <span className="stat-sub">分</span>
              </div>
              <div className="stat">
                <span className="stat-label">種目数</span>
                <span className="stat-value">{plan.exercises.length}</span>
                <span className="stat-sub">種目</span>
              </div>
              {plan.cardio && (
                <div className="stat">
                  <span className="stat-label">有酸素</span>
                  <span className="stat-value">{plan.cardio.minutes}</span>
                  <span className="stat-sub">分</span>
                </div>
              )}
            </div>
            {!session && (
              <div className="form-actions">
                <button type="button" className="primary" onClick={start}>
                  このメニューで記録を開始
                </button>
                <button type="button" onClick={() => setReroll((r) => r + 1)}>
                  別のメニューを提案
                </button>
                {excluded.length > 0 && (
                  <button type="button" onClick={() => setExcluded([])}>
                    除外をリセット ({excluded.length})
                  </button>
                )}
              </div>
            )}
          </div>}

          <ol className="exercise-list">
            {rows.map((row) => {
              const ex = exerciseMap[row.exerciseId]
              if (!ex) return null
              const p = row.planned
              const logged = row.logged
              const exIdx = row.loggedIdx
              return (
                <li key={row.exerciseId} className="card exercise-card">
                  <div className="exercise-head">
                    <div>
                      <h2>{ex.name}</h2>
                      <p className="muted">
                        {ex.primary.map(muscleName).join('・')}
                        {ex.secondary.length > 0 && (
                          <span className="secondary-muscles">
                            {' '}
                            (補助: {ex.secondary.map(muscleName).join('・')})
                          </span>
                        )}
                      </p>
                    </div>
                    {!session ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setExcluded((prev) => [...prev, row.exerciseId])}
                      >
                        別の種目にする
                      </button>
                    ) : (
                      !session.finishedAt && (
                        <button
                          type="button"
                          className="ghost danger"
                          onClick={() => removeExercise(row.exerciseId)}
                        >
                          外す
                        </button>
                      )
                    )}
                  </div>

                  {p && (
                    <div className="prescription">
                      <span>
                        {p.sets} セット × {p.repRange[0]}〜{p.repRange[1]} 回
                      </span>
                      <span>休憩 {p.restSec}秒</span>
                      {p.suggestedWeightKg != null && <span>推奨 {p.suggestedWeightKg}kg</span>}
                      <span className="muted">目安 {p.estimatedMinutes}分</span>
                    </div>
                  )}

                  {row.last && (
                    <p className="last-performance">
                      <span className="last-label">前回 {row.last.date}</span>
                      {row.last.sets
                        .map((s) => `${s.weightKg ?? '自重'}×${s.reps}`)
                        .join(' / ')}
                    </p>
                  )}
                  {p?.progressionNote && <p className="progression-note">{p.progressionNote}</p>}
                  {row.isPr && (
                    <p className="pr-note">🏆 自己ベスト更新（推定1RM {row.today1RM}kg）</p>
                  )}

                  <p className="tips">{ex.tips}</p>

                  {logged && (
                    <table className="set-table">
                      <thead>
                        <tr>
                          <th>セット</th>
                          <th>重量(kg)</th>
                          <th>回数</th>
                          <th>完了</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logged.sets.map((s, setIdx) => (
                          <tr key={setIdx} className={s.done ? 'is-done' : ''}>
                            <td>{setIdx + 1}</td>
                            <td>
                              <input
                                type="number"
                                inputMode="decimal"
                                step={0.5}
                                min={0}
                                value={s.weightKg ?? ''}
                                placeholder="自重"
                                onChange={(e) =>
                                  patchSet(exIdx, setIdx, {
                                    weightKg: e.target.value === '' ? null : Number(e.target.value),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                value={s.reps}
                                onChange={(e) =>
                                  patchSet(exIdx, setIdx, { reps: Number(e.target.value) })
                                }
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className={`set-done${s.done ? ' is-on' : ''}`}
                                aria-pressed={s.done}
                                aria-label={`${setIdx + 1}セット目を${s.done ? '未完了に戻す' : '完了にする'}`}
                                onClick={() => {
                                  const next = !s.done
                                  patchSet(exIdx, setIdx, { done: next })
                                  if (next) startRest(p?.restSec ?? 90)
                                }}
                              >
                                {s.done ? '✓' : '−'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {logged && (
                    <button type="button" className="ghost" onClick={() => addSet(exIdx)}>
                      + セットを追加
                    </button>
                  )}
                </li>
              )
            })}
          </ol>

          {session && !session.finishedAt && (
            <div className="card add-exercise">
              <h2>種目を追加する</h2>
              <p className="muted">
                提案に無い種目もここから足せます。自分の種目は設定 → 種目の管理で作れます。
              </p>
              <div className="weight-form">
                <select value={addingId} onChange={(e) => setAddingId(e.target.value)}>
                  <option value="">種目を選ぶ…</option>
                  {exercises
                    .filter((e) => !session.exercises.some((x) => x.exerciseId === e.id))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                        {e.custom ? '（自分の種目）' : ''}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="primary"
                  disabled={addingId === ''}
                  onClick={() => addExercise(addingId)}
                >
                  追加
                </button>
              </div>
            </div>
          )}

          {plan?.cardio && (
            <section className="card">
              <h2>有酸素運動</h2>
              <p>
                <strong>{plan.cardio.name}</strong> / {plan.cardio.minutes}分 / 目標心拍{' '}
                {plan.cardio.hrZone[0]}〜{plan.cardio.hrZone[1]} bpm
              </p>
              <p className="tips">{plan.cardio.note}</p>
              {session && (
                <label>
                  実施した時間 (分)
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={session.cardioMinutes}
                    onChange={(e) =>
                      mutateSession((prev) => ({ ...prev, cardioMinutes: Number(e.target.value) }))
                    }
                  />
                </label>
              )}
            </section>
          )}
        </>
      )}

      {session && (
        <section className="card">
          <h2>記録の仕上げ</h2>
          <div className="stat-row">
            <div className="stat">
              <span className="stat-label">完了セット</span>
              <span className="stat-value">
                {doneSets} / {totalSets}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">総挙上量</span>
              <span className="stat-value">{Math.round(totalVolume ?? 0)}</span>
              <span className="stat-sub">kg</span>
            </div>
          </div>
          <label>
            この記録の日付
            <input
              type="date"
              value={session.date}
              onChange={(e) => e.target.value && setSessionDate(e.target.value)}
            />
          </label>
          <div className="form-actions date-quick">
            <button
              type="button"
              className={session.date === startedDateKey ? 'primary' : ''}
              onClick={() => setSessionDate(startedDateKey)}
            >
              {shortDateLabel(startedDateKey)}
            </button>
            <button
              type="button"
              className={session.date === nextDateKey ? 'primary' : ''}
              onClick={() => setSessionDate(nextDateKey)}
            >
              {shortDateLabel(nextDateKey)}
            </button>
            <span className="muted">開始 {new Date(session.startedAt).toLocaleString()}</span>
          </div>

          <label>
            今日の体重 (kg・任意)
            <input
              type="number"
              inputMode="decimal"
              step={0.1}
              value={session.bodyWeightKg ?? weights.find((w) => w.date === session.date)?.weightKg ?? ''}
              onChange={(e) => {
                const value = e.target.value === '' ? undefined : Number(e.target.value)
                mutateSession((prev) => ({ ...prev, bodyWeightKg: value }))
                // 体重ログにも残し、統計とグラフから参照できるようにする
                if (value != null) void logWeight(session.date, value)
              }}
            />
          </label>
          <label>
            メモ
            <textarea
              rows={3}
              value={session.note}
              placeholder="調子・フォームの気づきなど"
              onChange={(e) => mutateSession((prev) => ({ ...prev, note: e.target.value }))}
            />
          </label>
          <div className="form-actions">
            {session.finishedAt ? (
              <span className="saved-note">お疲れさまでした。記録を保存しました。</span>
            ) : (
              <button type="button" className="primary" onClick={finish}>
                トレーニングを完了する
              </button>
            )}
            <Link className="button" to="/kintore/history">
              記録を見る
            </Link>
          </div>
        </section>
      )}

      {session?.finishedAt && (
        <section className="card">
          <h2>今日の評価</h2>
          <EvaluationCard
            evaluation={evaluateSession(session, sessions, profile, goal, exerciseMap)}
          />
          <div className="form-actions">
            <button
              type="button"
              onClick={() => {
                // 1日に2回やる場合に、新しい記録を始められるようにする
                sessionRef.current = null
                setSession(null)
              }}
            >
              もう一度トレーニングする
            </button>
          </div>
        </section>
      )}

      {rest && (
        <RestTimer
          endsAt={rest.endsAt}
          totalSec={rest.totalSec}
          onExtend={(sec) =>
            setRest((prev) =>
              prev ? { endsAt: prev.endsAt + sec * 1000, totalSec: prev.totalSec + sec } : prev,
            )
          }
          onStop={() => setRest(null)}
        />
      )}
    </div>
  )
}
