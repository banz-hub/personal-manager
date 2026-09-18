import { useEffect, useState } from 'react'
import { Banner, Field } from '../components/ui'
import { loadKintoreDay } from '../lib/bridge/kintore'
import {
  notificationSupport,
  requestNotificationPermission,
  showNow,
  type NotificationSupport,
} from '../lib/reminders'
import { loadYoteichoDay } from '../lib/bridge/yoteicho'
import { todayKey } from '../lib/date'
import { useApp } from '../state/AppContext'
import BackupSection from '../../../app/BackupSection'

export default function SettingsPage() {
  const { data, setSettings, reset } = useApp()
  const s = data.settings
  const [message, setMessage] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [kintoreLink, setKintoreLink] = useState<string | null>(null)
  const [notify, setNotify] = useState<NotificationSupport>(() => notificationSupport())

  useEffect(() => {
    if (!s.useKintore) {
      setKintoreLink('連携を切ってあります')
      return
    }
    let alive = true
    void loadKintoreDay().then((d) => {
      if (!alive) return
      setKintoreLink(
        d.available
          ? `つながっています（直近7日 ${d.last7Count}回、週${d.daysPerWeek}回の目標）`
          : (d.reason ?? '読めませんでした'),
      )
    })
    return () => {
      alive = false
    }
  }, [s.useKintore])

  useEffect(() => {
    if (!s.useYoteicho) {
      setLink('連携を切ってあります')
      return
    }
    let alive = true
    void loadYoteichoDay(todayKey(), {
      dayStart: s.dayStart,
      dayEnd: s.dayEnd,
      minSlotMin: s.minSlotMin,
      travelAllowanceMin: s.travelAllowanceMin,
    }).then((d) => {
      if (!alive) return
      setLink(
        d.available
          ? `つながっています（今日の予定 ${d.items.length}件）`
          : (d.reason ?? '読めませんでした'),
      )
    })
    return () => {
      alive = false
    }
  }, [s.useYoteicho, s.dayStart, s.dayEnd, s.minSlotMin, s.travelAllowanceMin])

  return (
    <div className="page">
      <strong>設定</strong>
      {message && <Banner>{message}</Banner>}

      <section className="bucket">
        <h2 className="section">「今やる」タイマー</h2>
        <div className="grid2">
          <Field label="作業1本の長さ(分)">
            <input
              type="number"
              min={5}
              step={5}
              value={s.pomodoroWorkMin}
              onChange={(e) => setSettings({ pomodoroWorkMin: Number(e.target.value) })}
            />
          </Field>
          <Field label="休憩の長さ(分)">
            <input
              type="number"
              min={1}
              step={1}
              value={s.pomodoroBreakMin}
              onChange={(e) => setSettings({ pomodoroBreakMin: Number(e.target.value) })}
            />
          </Field>
        </div>
        <p className="hint">
          「今やる」を押すと、この長さで作業と休憩を繰り返します。
          <strong>やりきった回数だけをセットとして数えます。</strong>
          途中で切ったぶんは、実績の分数には入りますがセットにはしません。
          長く離れていたときは自動で進めず、続けるかどうかを聞きます
          （見ていない間を作業にしないため）。
        </p>

      </section>

      {/*
        よてい帳はこのアプリの中に入ったので、外へのリンクは要らなくなった。
        筋トレログはまだ別アプリなので、行き来はここから。
      */}
      <section className="bucket">
        <h2 className="section">筋トレログを開く</h2>
        <a className="btn" href="../kintore-app/" style={{ textDecoration: 'none', textAlign: 'center' }}>
          筋トレログ
        </a>
        <p className="hint">
          ホーム画面に追加するのはエージェントだけにしてください。別々に追加すると、iPhone では
          それぞれ別のデータの置き場を持つことになり、連携が切れます。ここから開けば同じ場所のままです。
        </p>
      </section>

      <section className="bucket">
        <h2 className="section">よてい帳との連携</h2>
        <label className="row tight">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={s.useYoteicho}
            onChange={(e) => setSettings({ useYoteicho: e.target.checked })}
          />
          <span>よてい帳から今日の予定を読む</span>
        </label>
        {link && <Banner alert={!link.startsWith('つながって')}>{link}</Banner>}
        <p className="hint">
          読み取りだけです。1 ページ目の予定は、よてい帳の授業と予定をそのまま出しています。
          同じオリジン（banz-hub.github.io）で開いている必要があります。
        </p>
      </section>

      <section className="bucket">
        <h2 className="section">筋トレログとの連携</h2>
        <label className="row tight">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={s.useKintore}
            onChange={(e) => setSettings({ useKintore: e.target.checked })}
          />
          <span>筋トレログから今日のトレーニングを読む</span>
        </label>
        {kintoreLink && <Banner alert={!kintoreLink.startsWith('つながって')}>{kintoreLink}</Banner>}
        <p className="hint">
          読み取りだけで、筋トレログのデータには一切書き込みません。
          トレーニングの記録も筋トレログでつけてください。こちらで二重に入力する必要はありません。
        </p>
      </section>

      <section className="bucket">
        <h2 className="section">通知</h2>
        <label className="row tight">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={s.notifyEnabled}
            onChange={(e) => setSettings({ notifyEnabled: e.target.checked })}
          />
          <span>予定のコマと締切を知らせる</span>
        </label>

        <Field label={`何分前に知らせるか: ${s.notifyBeforeMin}分`}>
          <input
            type="range"
            min={0}
            max={30}
            step={5}
            value={s.notifyBeforeMin}
            onChange={(e) => setSettings({ notifyBeforeMin: Number(e.target.value) })}
          />
        </Field>

        <Banner alert={notify.permission !== 'granted'}>{notify.note}</Banner>

        <div className="row">
          {notify.permission !== 'granted' && notify.supported && (
            <button
              type="button"
              className="btn primary grow"
              onClick={() => {
                void requestNotificationPermission().then(() => setNotify(notificationSupport()))
              }}
            >
              通知を許可する
            </button>
          )}
          {notify.permission === 'granted' && (
            <button
              type="button"
              className="btn grow"
              onClick={() => void showNow('テスト通知', 'この形で届きます')}
            >
              試しに1件出す
            </button>
          )}
        </div>

        <p className="hint">
          <strong>アプリを閉じていても確実に鳴らすには、「今日の予定表」の「カレンダーへ」を使ってください。</strong>
          端末のカレンダーにアラーム付きで入るので、ブラウザを閉じていても鳴ります。
          ブラウザの通知だけでアプリを閉じた状態に届けるには通知を配るサーバーが要り、
          このアプリはサーバーを持たないため、そこは端末のカレンダーに任せる作りにしています。
        </p>
      </section>

      {/* 書き出し・読み込みはアプリ全体でここ 1 か所だけ */}
      <BackupSection onExported={() => setSettings({ lastBackupOn: todayKey() })} />

      <section className="bucket">
        <h2 className="section">消す</h2>
        <p className="hint">
          エージェントのぶん（タスク・学習・就活）だけを消します。予定と筋トレは残ります。
          元に戻せないので、先に書き出しておいてください。
          {s.lastBackupOn ? ` 最後に書き出したのは ${s.lastBackupOn} です。` : ' まだ一度も書き出していません。'}
        </p>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            if (window.confirm('エージェントのデータを消します。よろしいですか？')) {
              void reset().then(() => setMessage('消しました'))
            }
          }}
        >
          エージェントのデータを消す
        </button>
      </section>

      <section className="bucket">
        <h2 className="section">保存している件数</h2>
        <p className="dim">
          タスク {data.tasks.length} / 予定表 {data.plans.length} / 実績ログ {data.logs.length} /
          レビュー {data.reviews.length} / 学習項目 {data.nodes.length} / 試験 {data.exams.length} /
          学習記録 {data.sessions.length} / 企業 {data.companies.length} / 選考の予定{' '}
          {data.selections.length} / 週次レビュー {data.weeklyReviews.length}
        </p>
      </section>
    </div>
  )
}
