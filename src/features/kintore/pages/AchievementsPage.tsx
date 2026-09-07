import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import BadgeCard from '../components/BadgeCard'
import SectionTabs from '../components/SectionTabs'
import { WEEKDAY_LABELS, computeStats, evaluateBadges, recentWeeks } from '../lib/achievements'
import { appNow, cutoffOf } from '../lib/calc'
import { useApp } from '../state/AppContext'

export default function AchievementsPage() {
  const { profile, sessions } = useApp()

  const now = useMemo(() => appNow(cutoffOf(profile)), [profile])
  const stats = useMemo(() => computeStats(sessions, profile, now), [sessions, profile, now])
  const badges = useMemo(() => evaluateBadges(stats), [stats])
  const weeks = useMemo(() => recentWeeks(stats.activeDays, 4, now), [stats, now])

  const unlocked = badges.filter((b) => b.unlocked)
  const locked = badges.filter((b) => !b.unlocked)

  return (
    <div className="page">
      <h1>記録</h1>
      <SectionTabs />

      <section className="card">
        <h2>継続の記録</h2>
        <div className="stat-row">
          <div className="stat">
            <span className="stat-label">連続日数</span>
            <span className="stat-value">{stats.streakDays}</span>
            <span className="stat-sub">日</span>
          </div>
          <div className="stat">
            <span className="stat-label">最長連続</span>
            <span className="stat-value">{stats.longestStreakDays}</span>
            <span className="stat-sub">日</span>
          </div>
          <div className="stat">
            <span className="stat-label">週連続達成</span>
            <span className="stat-value">{stats.weekStreak}</span>
            <span className="stat-sub">週</span>
          </div>
          <div className="stat">
            <span className="stat-label">累計</span>
            <span className="stat-value">{stats.totalSessions}</span>
            <span className="stat-sub">回</span>
          </div>
        </div>

        <h3>直近4週間</h3>
        <div className="calendar">
          {WEEKDAY_LABELS.map((w) => (
            <span key={w} className="calendar-head" aria-hidden>
              {w}
            </span>
          ))}
          {weeks.flat().map((d) => (
            <span
              key={d.date}
              className={`calendar-day${d.active ? ' is-on' : ''}${d.isToday ? ' is-today' : ''}${
                d.future ? ' is-future' : ''
              }`}
              title={`${d.date}${d.active ? ' トレーニングあり' : ''}`}
            >
              <span aria-hidden>{d.label}</span>
              <span className="sr-only">
                {d.date}
                {d.active ? ' トレーニングあり' : ' 記録なし'}
              </span>
            </span>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>
          獲得したバッジ <span className="muted">{unlocked.length} / {badges.length}</span>
        </h2>
        {unlocked.length === 0 ? (
          <p className="muted">
            まだバッジがありません。まずは1回トレーニングを記録するところから。
          </p>
        ) : (
          <ul className="badge-grid">
            {unlocked.map((b) => (
              <BadgeCard key={b.badge.id} progress={b} />
            ))}
          </ul>
        )}
      </section>

      {locked.length > 0 && (
        <section className="card">
          <h2>次の目標</h2>
          <ul className="badge-grid">
            {locked
              .slice()
              .sort((a, b) => b.ratio - a.ratio)
              .map((b) => (
                <BadgeCard key={b.badge.id} progress={b} />
              ))}
          </ul>
        </section>
      )}

      <div className="form-actions">
        <Link className="button" to="/kintore">
          ホームに戻る
        </Link>
      </div>
    </div>
  )
}
