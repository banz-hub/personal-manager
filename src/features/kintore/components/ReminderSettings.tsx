import { useEffect, useState } from 'react'
import {
  DAY_LABELS,
  buildReminderIcs,
  loadReminder,
  notificationSupport,
  requestNotificationPermission,
  saveReminder,
  scheduleBackgroundNotifications,
  showReminderNow,
  upcomingOccurrences,
  type ReminderSettings as Settings,
} from '../lib/reminders'

interface Props {
  /** カレンダー予定の長さに使う */
  durationMinutes: number
}

export default function ReminderSettings({ durationMinutes }: Props) {
  const [settings, setSettings] = useState<Settings>(() => loadReminder())
  const [support, setSupport] = useState(() => notificationSupport())
  const [message, setMessage] = useState('')

  useEffect(() => {
    saveReminder(settings)
    if (settings.enabled) void scheduleBackgroundNotifications(settings)
  }, [settings])

  const upcoming = settings.enabled ? upcomingOccurrences(settings, 2) : []

  async function enable() {
    const permission = await requestNotificationPermission()
    setSupport(notificationSupport())
    if (permission !== 'granted') {
      setMessage(
        permission === 'denied'
          ? '通知がブロックされています。ブラウザのサイト設定から通知を許可してください。カレンダー登録なら通知なしでも使えます。'
          : '通知が許可されませんでした。',
      )
      setSettings((prev) => ({ ...prev, enabled: false }))
      return
    }
    setMessage('')
    setSettings((prev) => ({ ...prev, enabled: true }))
    const scheduled = await scheduleBackgroundNotifications({ ...settings, enabled: true })
    setMessage(
      scheduled > 0
        ? `${scheduled}回ぶんの通知を予約しました。`
        : 'この環境ではアプリを閉じている間の通知を予約できません。下のカレンダー登録が確実です。',
    )
  }

  function downloadIcs() {
    const ics = buildReminderIcs(settings, durationMinutes)
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'kintore-reminder.ics'
    a.click()
    URL.revokeObjectURL(url)
    setMessage('カレンダーファイルを書き出しました。開いて端末のカレンダーに追加してください。')
  }

  return (
    <section className="card">
      <h2>リマインダー</h2>
      <p className="muted">設定した曜日・時刻に「そろそろトレーニング」を知らせます。</p>

      <fieldset className="picker">
        <legend>曜日</legend>
        <div className="chips">
          {DAY_LABELS.map((label, index) => (
            <button
              key={label}
              type="button"
              className={`chip-button${settings.days.includes(index) ? ' is-on' : ''}`}
              onClick={() =>
                setSettings((prev) => ({
                  ...prev,
                  days: prev.days.includes(index)
                    ? prev.days.filter((d) => d !== index)
                    : [...prev.days, index].sort(),
                }))
              }
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid-2">
        <label>
          時刻
          <input
            type="time"
            value={settings.time}
            onChange={(e) => setSettings((prev) => ({ ...prev, time: e.target.value }))}
          />
        </label>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.skipIfLogged}
          onChange={(e) => setSettings((prev) => ({ ...prev, skipIfLogged: e.target.checked }))}
        />
        <span>その日すでに記録していたら知らせない</span>
      </label>

      <div className="form-actions">
        {settings.enabled ? (
          <button
            type="button"
            onClick={() => {
              setSettings((prev) => ({ ...prev, enabled: false }))
              setMessage('')
            }}
          >
            通知をオフにする
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => void enable()}>
            通知をオンにする
          </button>
        )}
        <button type="button" onClick={downloadIcs} disabled={settings.days.length === 0}>
          カレンダーに登録する
        </button>
        {support.permission === 'granted' && (
          <button type="button" className="ghost" onClick={() => void showReminderNow('テスト通知です。')}>
            テスト通知
          </button>
        )}
      </div>

      {message && <p className="warning">{message}</p>}

      {upcoming.length > 0 && (
        <p className="muted">
          次回: {upcoming.map((d) => `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`).join(' / ')}
        </p>
      )}

      <details className="chart-table">
        <summary>通知が届く条件について</summary>
        <ul className="note-list">
          <li>
            <strong>カレンダー登録</strong>が最も確実です。端末のカレンダーに繰り返し予定とアラームが入るので、アプリを開いていなくても鳴ります。
          </li>
          <li>
            ブラウザ通知は
            {support.canScheduleInBackground
              ? 'この環境では予約に対応しているため、アプリを閉じていても指定時刻に届きます。'
              : 'この環境ではアプリを閉じている間の予約に対応していません。アプリを開いている間の通知と、次に開いたときの「まだ記録がありません」表示で補います。'}
          </li>
          <li>
            iPhone / iPad では、ホーム画面に追加してそこから起動した場合のみ通知が使えます。
            {support.standalone ? '（現在ホーム画面から起動中です）' : '（現在はブラウザで表示中です）'}
          </li>
          <li>端末の設定でブラウザ自体の通知がオフになっていると届きません。</li>
        </ul>
      </details>
    </section>
  )
}
