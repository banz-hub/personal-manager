/**
 * 今日の画面に出す睡眠のカード。
 *
 * 押すのは 3 つだけ。時刻は入力させない。
 * 「起きた」を押した時刻がそのまま記録になるので、寝ぼけていても押せる大きさにしてある。
 */

import { formatDuration } from '../lib/date'
import {
  advise,
  bedtimeGuide,
  sleepAgain,
  startSleep,
  summarize,
  trend,
  wakeUp,
} from '../lib/sleep'
import { SLEEP_RATING_LABELS } from '../types'
import { useApp } from '../state/AppContext'

const RATING_CLASS = {
  good: 'routine',
  fair: 'optional',
  short: 'important',
  broken: 'urgent',
} as const

export default function SleepCard({ date, nowMin }: { date: string; nowMin: number }) {
  const { data, replaceList } = useApp()
  const s = data.settings

  const summary = summarize(data.sleepLogs, date, s)
  const t = trend(data.sleepLogs, date, s)
  const tips = advise(summary, t, s)

  // 押した瞬間の時計をそのまま使う。画面が持っている時刻は 1 分ごとの更新で少しずれる
  const press = (next: typeof startSleep) =>
    replaceList('sleepLogs', next(data.sleepLogs, new Date()))

  return (
    <section className="card sleep-card">
      <div className="row">
        <strong className="grow">睡眠</strong>
        {!summary.ongoing && summary.minutes > 0 && (
          <span className={`tag b-${RATING_CLASS[summary.rating]}`}>
            {SLEEP_RATING_LABELS[summary.rating]}
          </span>
        )}
      </div>

      {summary.ongoing ? (
        <p className="muted">{summary.bedAt}から寝ている記録になっています。</p>
      ) : summary.minutes > 0 ? (
        <>
          <p className="sleep-len">{formatDuration(summary.minutes)}</p>
          <p className="task-meta">
            <span>
              {summary.bedAt}〜{summary.wakeAt}
            </span>
            <span>
              目標比 {summary.diffMin >= 0 ? '+' : '−'}
              {formatDuration(Math.abs(summary.diffMin))}
            </span>
            {summary.snoozeCount > 0 && (
              <span>
                二度寝 {summary.snoozeCount}回 / {formatDuration(summary.snoozeMinutes)}
              </span>
            )}
          </p>
        </>
      ) : (
        <p className="muted">まだ今日の記録がありません。起きたときに押してください。</p>
      )}

      {/* 押せるものだけ出す。押せないボタンを並べると、どれが今の状態か分からない */}
      <div className="row">
        {summary.ongoing ? (
          <button type="button" className="btn primary grow" onClick={() => press(wakeUp)}>
            起きた
          </button>
        ) : (
          <>
            <button type="button" className="btn primary grow" onClick={() => press(startSleep)}>
              寝る
            </button>
            {summary.minutes > 0 && (
              <button type="button" className="btn grow" onClick={() => press(sleepAgain)}>
                二度寝する
              </button>
            )}
          </>
        )}
      </div>

      {!summary.ongoing && <p className="dim">{bedtimeGuide(s, nowMin)}</p>}

      {tips.map((tip) => (
        <p className="reason" key={tip}>
          {tip}
        </p>
      ))}
    </section>
  )
}
