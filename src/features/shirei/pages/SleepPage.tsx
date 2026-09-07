/**
 * 睡眠の記録と傾向。
 *
 * 今日の分は「今日」の画面で押す。ここは振り返りと、目標の調整だけ。
 */

import { useMemo, useState } from 'react'
import { Banner, Empty, Field } from '../components/ui'
import { addDays, formatDate, formatDuration, todayKey } from '../lib/date'
import { advise, summarize, trend, type SleepSummary } from '../lib/sleep'
import { useApp } from '../state/AppContext'

const RATING_CLASS = {
  good: 'routine',
  fair: 'optional',
  short: 'important',
  broken: 'urgent',
} as const

/** 直近何日ぶんを並べるか */
const RANGE_DAYS = 14

export default function SleepPage() {
  const { data, setSettings, replaceList } = useApp()
  const s = data.settings
  const today = todayKey()
  const [message, setMessage] = useState('')

  const days = useMemo(() => {
    const out: Array<{ date: string; summary: SleepSummary }> = []
    for (let i = 0; i < RANGE_DAYS; i++) {
      const date = addDays(today, -i)
      out.push({ date, summary: summarize(data.sleepLogs, date, s) })
    }
    return out
  }, [data.sleepLogs, today, s])

  const t = trend(data.sleepLogs, today, s)
  const tips = advise(summarize(data.sleepLogs, today, s), t, s)

  // いちばん長い日を基準に棒の長さを決める。目盛りを固定すると短い日が潰れる
  const longest = Math.max(s.targetSleepMin, ...days.map((d) => d.summary.minutes))

  const recorded = days.filter((d) => d.summary.minutes > 0 || d.summary.ongoing)

  return (
    <div className="page">
      <strong>睡眠</strong>
      {message && <Banner>{message}</Banner>}

      <section className="bucket">
        <h2 className="section">直近{t.days > 0 ? `${t.days}日` : ''}の傾向</h2>
        {t.days === 0 ? (
          <Empty>まだ記録がありません。「今日」の画面のボタンで記録します。</Empty>
        ) : (
          <>
            <div className="grid2">
              <div className="stat">
                <span className="stat-label">平均</span>
                <span className="stat-value">{formatDuration(t.averageMin)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">目標に届かない日</span>
                <span className="stat-value">
                  {t.shortDays}/{t.days}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">二度寝した日</span>
                <span className="stat-value">
                  {t.snoozeDays}/{t.days}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">寝る時刻のぶれ</span>
                <span className="stat-value">{formatDuration(t.bedtimeSpreadMin)}</span>
              </div>
            </div>
            {tips.map((tip) => (
              <p className="reason" key={tip}>
                {tip}
              </p>
            ))}
          </>
        )}
      </section>

      <section className="bucket">
        <h2 className="section">記録</h2>
        {recorded.length === 0 ? (
          <Empty>まだ記録がありません。</Empty>
        ) : (
          <div className="sleep-bars">
            {days.map(({ date, summary }) => (
              <div className="sleep-bar-row" key={date}>
                <span className="sleep-bar-day">{formatDate(date).replace(/\(.\)$/, '')}</span>
                <span className="sleep-bar-track">
                  {summary.minutes > 0 && (
                    <span
                      className={`sleep-bar b-${RATING_CLASS[summary.rating]}`}
                      style={{ width: `${(summary.minutes / longest) * 100}%` }}
                    />
                  )}
                </span>
                <span className="sleep-bar-len">
                  {summary.ongoing
                    ? '記録中'
                    : summary.minutes > 0
                      ? formatDuration(summary.minutes)
                      : '—'}
                </span>
                {summary.minutes > 0 && !summary.ongoing && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => {
                      if (!window.confirm(`${date} の記録を消しますか？`)) return
                      replaceList(
                        'sleepLogs',
                        data.sleepLogs.filter((l) => l.date !== date),
                      )
                      setMessage(`${date} の記録を消しました`)
                    }}
                  >
                    消す
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="hint">
          押した時刻をそのまま残しています。丸めていないので、押し忘れた日は空欄のままです。
          間違って押した日は消して、次の日から取り直してください。
        </p>
      </section>

      <section className="bucket">
        <h2 className="section">目標</h2>
        <div className="grid2">
          <Field label={`目標の睡眠時間: ${formatDuration(s.targetSleepMin)}`}>
            <input
              type="range"
              min={300}
              max={600}
              step={15}
              value={s.targetSleepMin}
              onChange={(e) => setSettings({ targetSleepMin: Number(e.target.value) })}
            />
          </Field>
          <Field label="目標の就寝時刻">
            <input
              type="time"
              value={s.targetBedtime}
              onChange={(e) => setSettings({ targetBedtime: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid2">
          <Field label="起きてから始めるまで(分)">
            <input
              type="number"
              min={0}
              step={5}
              value={s.wakeBufferMin}
              onChange={(e) => setSettings({ wakeBufferMin: Number(e.target.value) })}
            />
          </Field>
          <Field label="寝る前の支度(分)">
            <input
              type="number"
              min={0}
              step={5}
              value={s.bedtimeBufferMin}
              onChange={(e) => setSettings({ bedtimeBufferMin: Number(e.target.value) })}
            />
          </Field>
        </div>

        <label className="row tight">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={s.useSleep}
            onChange={(e) => setSettings({ useSleep: e.target.checked })}
          />
          <span>睡眠に合わせて今日の予定を組み直す</span>
        </label>
        <p className="hint">
          入れておくと、<strong>起きた時刻から今日を始め</strong>、
          <strong>目標の就寝時刻から逆算して夜の終わりを決め</strong>、
          寝不足の日は詰め込みの上限を下げます。変えたときは「今日」の画面に理由が出ます。
        </p>
      </section>
    </div>
  )
}
