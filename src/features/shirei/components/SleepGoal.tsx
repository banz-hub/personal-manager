import { useEffect, useMemo, useState } from 'react'
import { loadNight, type NightInput } from '../lib/bridge/yoteicho'
import { formatDuration, todayKey } from '../lib/date'
import { planBedtime, wakeStreak } from '../lib/sleep'
import { useApp } from '../state/AppContext'

/** 今夜は何時に寝るか。翌朝の予定と早起きの目標から出す */
export function BedtimeAdvice({ date }: { date: string }) {
  const { data } = useApp()
  const s = data.settings
  const [night, setNight] = useState<NightInput>({ duty: null })

  useEffect(() => {
    if (!s.useYoteicho) return
    let alive = true
    void loadNight(date).then((n) => {
      if (alive) setNight(n)
    })
    return () => {
      alive = false
    }
  }, [date, s.useYoteicho])

  const plan = planBedtime({
    wakeGoal: s.wakeGoal,
    targetSleepMin: s.targetSleepMin,
    duty: night.duty,
    tonightEnd: night.tonightEnd,
  })

  return (
    <div className="bedtime">
      <p className="bedtime-main">
        今夜は <strong>{plan.bed}</strong> に寝る
        <span className="dim small"> → {plan.wake} に起きる</span>
      </p>
      <p className="dim small">{plan.reason}</p>
      {plan.shortBy != null && (
        <p className="warn">
          今夜は{night.tonightEnd}まで予定があるので、取れても{formatDuration(Math.max(0, plan.shortBy))}です。
        </p>
      )}
    </div>
  )
}

const STATE_LABEL = { hit: '達成', miss: '遅れた', none: '記録なし' } as const

/** 早起きが続いている日数と、直近の 2 週間 */
export function WakeStreakView({ compact = false }: { compact?: boolean }) {
  const { data } = useApp()
  const s = data.settings
  const today = todayKey()
  const streak = useMemo(() => wakeStreak(data.sleepLogs, today, s), [data.sleepLogs, today, s])

  return (
    <div className="wake-streak">
      <p className="bedtime-main">
        早起き <strong>{streak.current}日</strong> 連続
        <span className="dim small">
          {' '}
          {s.wakeGoal}までに起床 / 最長 {streak.best}日
        </span>
      </p>
      {!compact && (
        <div className="wake-days">
          {streak.recent.map((d) => (
            <span
              key={d.date}
              className={`wake-day is-${d.state}`}
              title={`${d.date} ${STATE_LABEL[d.state]}`}
              aria-label={`${d.date} ${STATE_LABEL[d.state]}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
