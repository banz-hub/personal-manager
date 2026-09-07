import { useMemo, useState } from 'react'
import { BarChart, HBarChart, LineChart, type ChartPoint } from '../components/Chart'
import SectionTabs from '../components/SectionTabs'
import { muscleName } from '../data/muscles'
import { toDateKey } from '../lib/calc'
import {
  monthlyStats,
  muscleBalance,
  reviewGoal,
  weightSeries,
  yearlyStats,
  type PeriodStats,
} from '../lib/stats'
import { useApp } from '../state/AppContext'

type Scope = 'month' | 'year'

function sumPeriods(list: PeriodStats[]): PeriodStats {
  return list.reduce(
    (acc, p) => ({
      key: 'total',
      label: '合計',
      sessions: acc.sessions + p.sessions,
      sets: acc.sets + p.sets,
      volumeKg: acc.volumeKg + p.volumeKg,
      cardioMinutes: acc.cardioMinutes + p.cardioMinutes,
      minutes: acc.minutes + p.minutes,
    }),
    { key: 'total', label: '合計', sessions: 0, sets: 0, volumeKg: 0, cardioMinutes: 0, minutes: 0 },
  )
}

function eightWeeksAgo(): string {
  const d = new Date()
  d.setDate(d.getDate() - 56)
  return toDateKey(d)
}

export default function StatsPage() {
  const { profile, goal, sessions, weights, exerciseMap, saveGoal, saveProfile } = useApp()
  const [scope, setScope] = useState<Scope>('month')
  /** この画面で適用した変更。提案が消えても何をしたか分かるように残す */
  const [applied, setApplied] = useState<string[]>([])

  const months = useMemo(() => monthlyStats(sessions, 12), [sessions])
  const years = useMemo(() => yearlyStats(sessions), [sessions])
  const periods = scope === 'month' ? months : years

  const weightPoints = useMemo(() => weightSeries(weights, sessions), [weights, sessions])
  const balance = useMemo(
    () => muscleBalance(sessions, eightWeeksAgo(), exerciseMap),
    [sessions, exerciseMap],
  )
  const review = useMemo(
    () => reviewGoal(profile, goal, sessions, weights, new Date(), exerciseMap),
    [profile, goal, sessions, weights, exerciseMap],
  )

  const current = periods[periods.length - 1]
  const total = sumPeriods(periods)

  const volumePoints: ChartPoint[] = periods.map((p) => ({
    label: p.label,
    value: Math.round(p.volumeKg),
    sub: p.key,
  }))
  const sessionPoints: ChartPoint[] = periods.map((p) => ({
    label: p.label,
    value: p.sessions,
    sub: p.key,
  }))
  const weightChartPoints: ChartPoint[] = weightPoints.map((p) => ({
    label: p.date.slice(5),
    value: p.weightKg,
    sub: p.date,
  }))
  const balancePoints: ChartPoint[] = balance.map((b) => ({
    label: muscleName(b.muscle),
    value: b.sets,
  }))

  async function applySuggestion(apply: NonNullable<(typeof review.suggestions)[number]['apply']>) {
    if (apply.kind === 'targetDate' && goal) {
      await saveGoal({ ...goal, targetDate: apply.value })
    } else if (apply.kind === 'daysPerWeek' && profile) {
      await saveProfile({ ...profile, daysPerWeek: apply.value })
    }
    setApplied((prev) => [...prev, apply.label])
  }

  return (
    <div className="page">
      <h1>記録</h1>
      <SectionTabs />

      <div className="segmented" role="group" aria-label="集計期間">
        <button
          type="button"
          className={scope === 'month' ? 'is-on' : ''}
          onClick={() => setScope('month')}
        >
          月次
        </button>
        <button
          type="button"
          className={scope === 'year' ? 'is-on' : ''}
          onClick={() => setScope('year')}
        >
          年次
        </button>
      </div>

      <section className="card">
        <h2>{scope === 'month' ? `今月 (${current?.label ?? '—'})` : `今年 (${current?.label ?? '—'})`}</h2>
        <div className="stat-row">
          <div className="stat">
            <span className="stat-label">回数</span>
            <span className="stat-value">{current?.sessions ?? 0}</span>
            <span className="stat-sub">回</span>
          </div>
          <div className="stat">
            <span className="stat-label">セット</span>
            <span className="stat-value">{current?.sets ?? 0}</span>
          </div>
          <div className="stat">
            <span className="stat-label">総挙上量</span>
            <span className="stat-value">
              {Math.round(current?.volumeKg ?? 0).toLocaleString()}
            </span>
            <span className="stat-sub">kg</span>
          </div>
          <div className="stat">
            <span className="stat-label">有酸素</span>
            <span className="stat-value">{current?.cardioMinutes ?? 0}</span>
            <span className="stat-sub">分</span>
          </div>
          <div className="stat">
            <span className="stat-label">トレ時間</span>
            <span className="stat-value">{current?.minutes ?? 0}</span>
            <span className="stat-sub">分</span>
          </div>
        </div>
        <p className="muted">
          {scope === 'month' ? '直近12ヶ月' : '記録のある全期間'}の合計: {total.sessions}回 /{' '}
          {Math.round(total.volumeKg).toLocaleString()}kg / {total.minutes}分
        </p>
      </section>

      <section className="card">
        <LineChart
          title="体重の推移"
          caption={
            goal?.targetWeightKg != null
              ? '点線は目標体重。記録した体重をつなげています。'
              : '記録した体重をつなげています。'
          }
          points={weightChartPoints}
          unit="kg"
          reference={
            goal?.targetWeightKg != null
              ? { value: goal.targetWeightKg, label: `目標 ${goal.targetWeightKg}kg` }
              : undefined
          }
        />
      </section>

      <section className="card">
        <BarChart
          title={scope === 'month' ? '月別の総挙上量' : '年別の総挙上量'}
          caption="重量 × 回数 × セット数の合計。トレーニング量の推移を見る指標です。"
          points={volumePoints}
          unit="kg"
          format={(v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))}
        />
      </section>

      <section className="card">
        <BarChart
          title={scope === 'month' ? '月別のトレーニング回数' : '年別のトレーニング回数'}
          points={sessionPoints}
          unit="回"
        />
      </section>

      <section className="card">
        <HBarChart
          title="部位別のセット数"
          caption="直近8週間。主動筋は1セット、協働筋は0.5セットとして数えています。"
          points={balancePoints}
          unit="セット"
        />
      </section>

      <section className="card">
        <h2>目標の見直し</h2>
        <div className="stat-row">
          <div className="stat">
            <span className="stat-label">体重の実測ペース</span>
            <span className="stat-value">
              {review.actualWeeklyKg == null
                ? '—'
                : `${review.actualWeeklyKg > 0 ? '+' : ''}${review.actualWeeklyKg}`}
            </span>
            <span className="stat-sub">kg / 週</span>
          </div>
          {review.neededWeeklyKg != null && (
            <div className="stat">
              <span className="stat-label">目標日に必要なペース</span>
              <span className="stat-value">
                {review.neededWeeklyKg > 0 ? '+' : ''}
                {review.neededWeeklyKg}
              </span>
              <span className="stat-sub">kg / 週</span>
            </div>
          )}
          <div className="stat">
            <span className="stat-label">週の頻度</span>
            <span className="stat-value">{review.actualFrequency}</span>
            <span className="stat-sub">回 (目標 {review.targetFrequency})</span>
          </div>
          {review.projectedDate && (
            <div className="stat">
              <span className="stat-label">実測ペースでの到達</span>
              <span className="stat-value is-date">{review.projectedDate}</span>
            </div>
          )}
        </div>

        {applied.length > 0 && (
          <ul className="applied-list">
            {applied.map((label) => (
              <li key={label}>✓ {label.replace(/にする$/, 'に変更しました')}</li>
            ))}
          </ul>
        )}

        {review.suggestions.length === 0 ? (
          <p className="muted">
            調整の提案はまだありません。記録が増えると、実測ペースから目標を見直せます。
          </p>
        ) : (
          <ul className="suggestion-list">
            {review.suggestions.map((s) => (
              <li key={s.id} className="suggestion">
                <h3>{s.title}</h3>
                <p>{s.detail}</p>
                {s.apply && (
                  <div className="form-actions">
                    {applied.includes(s.apply.label) ? (
                      <span className="saved-note">適用しました</span>
                    ) : (
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void applySuggestion(s.apply!)}
                      >
                        {s.apply.label}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
