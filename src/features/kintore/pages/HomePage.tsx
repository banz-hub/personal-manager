import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import BadgeCard from '../components/BadgeCard'
import { exerciseNameFrom } from '../data/exercises'
import { muscleName } from '../data/muscles'
import {
  computeStats,
  evaluateBadges,
  loadSeenBadges,
  nextBadges,
  recentDays,
  saveSeenBadges,
  todaysMissions,
  type BadgeProgress,
} from '../lib/achievements'
import { appNow, bmi, bmiCategory, buildGoalPlan, cutoffOf, parseDateKey, toDateKey } from '../lib/calc'
import { GOAL_LABEL } from '../lib/planner'
import { isMissedToday, loadReminder } from '../lib/reminders'
import { weightSeries } from '../lib/stats'
import { useApp } from '../state/AppContext'

export default function HomePage() {
  const { profile, goal, sessions, weights, exerciseMap, logWeight } = useApp()
  const [weightInput, setWeightInput] = useState('')
  const [missedDismissed, setMissedDismissed] = useState(false)

  // 1日の区切り時刻を反映した「今」。深夜のトレーニングが翌日扱いにならないようにする
  const now = useMemo(() => appNow(cutoffOf(profile)), [profile])
  const stats = useMemo(() => computeStats(sessions, profile, now), [sessions, profile, now])
  const badges = useMemo(() => evaluateBadges(stats), [stats])
  const missions = useMemo(
    () => todaysMissions(sessions, goal, stats, weights, now),
    [sessions, goal, stats, weights, now],
  )
  const days = useMemo(() => recentDays(stats.activeDays, 14, now), [stats, now])

  const [newBadges, setNewBadges] = useState<BadgeProgress[]>([])

  // 前回の訪問以降に新しく獲得したバッジを知らせる
  useEffect(() => {
    const unlockedIds = badges.filter((b) => b.unlocked).map((b) => b.badge.id)
    const seen = loadSeenBadges()
    if (seen === null) {
      // 初回起動やバックアップ復元直後は、既存ぶんをまとめて通知しない
      saveSeenBadges(unlockedIds)
      return
    }
    const fresh = unlockedIds.filter((id) => !seen.includes(id))
    if (fresh.length === 0) return
    setNewBadges(badges.filter((b) => fresh.includes(b.badge.id)))
    saveSeenBadges(unlockedIds)
  }, [badges])

  if (!profile) {
    return (
      <div className="page">
        <h1>ようこそ</h1>
        <p>
          身長・体重などを登録すると、あなたの機材と使える時間に合わせた筋トレメニューを提案します。
        </p>
        <Link className="button primary" to="/kintore/profile">
          はじめる
        </Link>
      </div>
    )
  }

  const today = toDateKey(now)
  const todaySession = sessions.find((s) => s.date === today)
  const recent = sessions.slice(0, 3)
  const goalPlan = goal
    ? buildGoalPlan(profile, goal.type, goal.targetWeightKg, goal.targetDate)
    : null
  const bmiValue = bmi(profile.heightCm, profile.weightKg)

  const doneMissions = missions.filter((m) => m.done).length
  const allMissionsDone = doneMissions === missions.length
  const weekDone = stats.thisWeekCount >= stats.weeklyTarget
  const restDayOk = weekDone && !todaySession
  const upcoming = nextBadges(badges, 3)
  const unlockedCount = badges.filter((b) => b.unlocked).length

  // 通知が出せない環境でも取りこぼさないよう、予定時刻を過ぎていたら画面で知らせる
  const reminder = loadReminder()
  const loggedToday = Boolean(todaySession?.finishedAt)
  const missedReminder = !missedDismissed && isMissedToday(reminder, loggedToday)

  const series = weightSeries(weights, sessions)
  const todayWeight = series.find((w) => w.date === today)?.weightKg ?? null
  const latestWeight = series[series.length - 1]?.weightKg ?? null
  // 1週間前に最も近い記録と比べる
  const weekAgoDate = parseDateKey(today)
  weekAgoDate.setDate(weekAgoDate.getDate() - 7)
  const weekAgo = toDateKey(weekAgoDate)
  const past = [...series].reverse().find((w) => w.date <= weekAgo)
  const weekChange =
    latestWeight != null && past ? Math.round((latestWeight - past.weightKg) * 10) / 10 : null

  return (
    <div className="page">
      <h1>ホーム</h1>

      {newBadges.length > 0 && (
        <section className="card celebrate">
          <h2>🎉 新しいバッジを獲得しました</h2>
          <ul className="badge-grid">
            {newBadges.map((b) => (
              <BadgeCard key={b.badge.id} progress={b} isNew />
            ))}
          </ul>
          <div className="form-actions">
            <button type="button" onClick={() => setNewBadges([])}>
              閉じる
            </button>
          </div>
        </section>
      )}

      {missedReminder && (
        <section className="card celebrate">
          <h2>⏰ 今日のトレーニングがまだです</h2>
          <p>設定した時刻を過ぎています。1セットだけでも始めると、案外そのまま続きます。</p>
          <div className="form-actions">
            <Link className="button primary" to="/kintore/workout">
              今日のメニューを見る
            </Link>
            <button type="button" onClick={() => setMissedDismissed(true)}>
              今日は休む
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>今日</h2>
        {todaySession?.finishedAt ? (
          <p>今日のトレーニングは完了しています。お疲れさまでした。</p>
        ) : todaySession ? (
          <p>記録中のトレーニングがあります。続きから再開できます。</p>
        ) : restDayOk ? (
          <p>今週の目標はすでに達成しています。今日は休養日にしてもOKです。</p>
        ) : (
          <p>まだ今日の記録はありません。</p>
        )}
        <div className="form-actions">
          <Link className="button primary" to="/kintore/workout">
            {todaySession && !todaySession.finishedAt ? '記録を再開する' : '今日のメニューを見る'}
          </Link>
        </div>
      </section>

      <section className="card">
        <h2>体重</h2>
        {todayWeight != null ? (
          <p>
            今日の記録: <strong>{todayWeight} kg</strong>
            {weekChange != null && (
              <span className="muted">
                {' '}
                （1週間前から {weekChange > 0 ? '+' : ''}
                {weekChange} kg）
              </span>
            )}
          </p>
        ) : (
          <p className="muted">
            トレーニングしない日も記録しておくと、統計から目標ペースを見直せます。
          </p>
        )}
        <div className="weight-form">
          <input
            type="number"
            inputMode="decimal"
            step={0.1}
            min={25}
            max={300}
            placeholder={`${latestWeight ?? profile.weightKg}`}
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            aria-label="今日の体重 (kg)"
          />
          <button
            type="button"
            className="primary"
            disabled={weightInput === '' || !Number.isFinite(Number(weightInput))}
            onClick={() => {
              void logWeight(today, Number(weightInput))
              setWeightInput('')
            }}
          >
            記録する
          </button>
        </div>
      </section>

      <section className="card">
        <h2>継続</h2>
        <div className="streak-row">
          <div className={`streak-flame${stats.streakDays > 0 ? ' is-on' : ''}`}>
            <span className="streak-icon" aria-hidden>
              🔥
            </span>
            <span className="streak-value">{stats.streakDays}</span>
            <span className="streak-unit">日連続</span>
          </div>
          <div className="streak-side">
            <div className="week-progress">
              <span className="week-label">
                今週 {stats.thisWeekCount} / {stats.weeklyTarget} 日
                {weekDone && <span className="week-done">達成</span>}
              </span>
              <span className="week-bar" aria-hidden>
                <span
                  className="week-bar-fill"
                  style={{
                    width: `${Math.min(100, (stats.thisWeekCount / stats.weeklyTarget) * 100)}%`,
                  }}
                />
              </span>
            </div>
            <span className="muted">最長 {stats.longestStreakDays} 日連続</span>
          </div>
        </div>

        <span className="day-dots-caption">直近14日</span>
        <ul className="day-dots">
          {days.map((d) => (
            <li
              key={d.date}
              className={`day-dot${d.active ? ' is-on' : ''}${d.isToday ? ' is-today' : ''}`}
              title={`${d.date}${d.active ? ' トレーニングあり' : ''}`}
            >
              <span className="sr-only">
                {d.date}
                {d.active ? ' トレーニングあり' : ' 記録なし'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>
          今日のミッション <span className="muted">{doneMissions} / {missions.length}</span>
        </h2>
        <ul className="mission-list">
          {missions.map((m) => (
            <li key={m.id} className={`mission${m.done ? ' is-done' : ''}`}>
              <span className="mission-check" aria-hidden>
                {m.done ? '✓' : ''}
              </span>
              <span className="mission-label">
                {m.label}
                {m.hint && <span className="mission-hint">{m.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
        {allMissionsDone && (
          <p className="mission-complete">
            今日のミッションを全部クリアしました。この調子で明日も。
          </p>
        )}
      </section>

      <section className="card">
        <h2>
          実績 <span className="muted">{unlockedCount} / {badges.length}</span>
        </h2>
        {upcoming.length > 0 ? (
          <ul className="badge-grid">
            {upcoming.map((b) => (
              <BadgeCard key={b.badge.id} progress={b} />
            ))}
          </ul>
        ) : (
          <p className="muted">すべてのバッジを獲得しました。</p>
        )}
        <div className="form-actions">
          <Link className="button" to="/kintore/achievements">
            すべての実績を見る
          </Link>
        </div>
      </section>

      <section className="card">
        <h2>目標</h2>
        {goal && goal.targetMuscles.length > 0 ? (
          <>
            <p>
              <strong>{GOAL_LABEL[goal.type]}</strong>
            </p>
            <div className="chips">
              {goal.targetMuscles.map((m) => (
                <span key={m} className="chip is-static">
                  {muscleName(m)}
                </span>
              ))}
            </div>
            {goalPlan && goalPlan.direction !== 'maintain' && (
              <div className="stat-row">
                <div className="stat">
                  <span className="stat-label">目標体重まで</span>
                  <span className="stat-value">
                    {goalPlan.deltaKg > 0 ? '+' : ''}
                    {goalPlan.deltaKg}
                  </span>
                  <span className="stat-sub">kg</span>
                </div>
                <div className="stat">
                  <span className="stat-label">推奨到達</span>
                  <span className="stat-value is-date">{goalPlan.projectedDate ?? '—'}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">1日の目安</span>
                  <span className="stat-value">{goalPlan.dailyCalories}</span>
                  <span className="stat-sub">kcal</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <p>鍛えたい部位が未設定です。</p>
        )}
        <div className="form-actions">
          <Link className="button" to="/kintore/goal">
            目標を{goal ? '変更する' : '設定する'}
          </Link>
        </div>
      </section>

      <section className="card">
        <h2>あなたの現在地</h2>
        <div className="stat-row">
          <div className="stat">
            <span className="stat-label">体重</span>
            <span className="stat-value">{profile.weightKg}</span>
            <span className="stat-sub">kg</span>
          </div>
          <div className="stat">
            <span className="stat-label">BMI</span>
            <span className="stat-value">{bmiValue.toFixed(1)}</span>
            <span className="stat-sub">{bmiCategory(bmiValue)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">記録した回数</span>
            <span className="stat-value">{stats.totalSessions}</span>
            <span className="stat-sub">回</span>
          </div>
          <div className="stat">
            <span className="stat-label">総挙上量</span>
            <span className="stat-value">{Math.round(stats.totalVolumeKg).toLocaleString()}</span>
            <span className="stat-sub">kg</span>
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="card">
          <h2>直近の記録</h2>
          <ul className="recent-list">
            {recent.map((s) => (
              <li key={s.id}>
                <span className="recent-date">{s.date}</span>
                <span className="recent-body">
                  {s.exercises.map((e) => exerciseNameFrom(exerciseMap, e.exerciseId)).join('、') || '種目なし'}
                </span>
              </li>
            ))}
          </ul>
          <div className="form-actions">
            <Link className="button" to="/kintore/history">
              すべての記録を見る
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
