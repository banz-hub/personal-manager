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
import { BACKUP_INTERVAL_DAYS } from '../lib/routine'
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
          ? `つながっています（今日の予定 ${d.items.length}件、空き時間 ${d.slots.length}コマ）`
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
        <h2 className="section">1日の使い方</h2>
        <div className="grid2">
          <Field label="活動を始める時刻">
            <input
              type="time"
              value={s.dayStart}
              onChange={(e) => setSettings({ dayStart: e.target.value })}
            />
          </Field>
          <Field label="活動を終える時刻">
            <input
              type="time"
              value={s.dayEnd}
              onChange={(e) => setSettings({ dayEnd: e.target.value })}
            />
          </Field>
        </div>

        <Field label={`空き時間のうち作業に使う上限: ${Math.round(s.fillRatio * 100)}%`}>
          <input
            type="range"
            min={50}
            max={95}
            step={5}
            value={Math.round(s.fillRatio * 100)}
            onChange={(e) => setSettings({ fillRatio: Number(e.target.value) / 100 })}
          />
        </Field>
        <p className="hint">
          残りはバッファとして空けます。100%にはできません。予定どおりに進まない日を吸収する余地が無いと、
          1つ遅れただけで全部崩れるためです。
        </p>

        <div className="grid2">
          <Field label="休憩を挟むまでの作業(分)">
            <input
              type="number"
              min={20}
              step={10}
              value={s.workBeforeBreakMin}
              onChange={(e) => setSettings({ workBeforeBreakMin: Number(e.target.value) })}
            />
          </Field>
          <Field label="休憩の長さ(分)">
            <input
              type="number"
              min={5}
              step={5}
              value={s.breakMin}
              onChange={(e) => setSettings({ breakMin: Number(e.target.value) })}
            />
          </Field>
        </div>

        <div className="grid2">
          <Field label="使う空き時間の下限(分)">
            <input
              type="number"
              min={5}
              step={5}
              value={s.minSlotMin}
              onChange={(e) => setSettings({ minSlotMin: Number(e.target.value) })}
            />
          </Field>
          <Field label="移動に見込む時間(分)">
            <input
              type="number"
              min={0}
              step={5}
              value={s.travelAllowanceMin}
              onChange={(e) => setSettings({ travelAllowanceMin: Number(e.target.value) })}
            />
          </Field>
        </div>
        <p className="hint">
          移動時間は、場所が変わる予定の間から先に引きます。経路の計算はよてい帳の担当なので、
          こちらは粗い引き当てだけです。
        </p>
      </section>

      <section className="bucket">
        <h2 className="section">学習</h2>
        <div className="grid2">
          <Field label="1回の学習の長さ(分)">
            <input
              type="number"
              min={10}
              step={5}
              value={s.studyChunkMin}
              onChange={(e) => setSettings({ studyChunkMin: Number(e.target.value) })}
            />
          </Field>
          <Field label="1日に予定へ載せる項目数">
            <input
              type="number"
              min={1}
              max={10}
              value={s.studyPerDayMax}
              onChange={(e) => setSettings({ studyPerDayMax: Number(e.target.value) })}
            />
          </Field>
        </div>
        <p className="hint">
          学習項目は数が増えるので、上位だけを今日の予定に載せます。全部載せると「今日やりたいことの合計」が
          現実離れした数字になり、所見が意味を失うためです。理解が進んだ項目は1回の時間が自動で短くなります。
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
          ふだんは読み取りだけです。書き込むのは「今日の予定表」の「よてい帳へ」を押したときだけで、
          そのときも中身を全部見せてから実行します。手で入れた予定には触れません。
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
        <label className="row tight">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={s.easeAfterWorkout}
            onChange={(e) => setSettings({ easeAfterWorkout: e.target.checked })}
          />
          <span>前日の負荷が高い日は、詰め込みの上限を自動で下げる</span>
        </label>
        <p className="hint">
          読み取りだけで、筋トレログのデータには一切書き込みません。
          メニューの中身（種目・セット・重量）は筋トレログの担当なので、エージェントは時間を空けるところまでです。
          トレーニングの記録も筋トレログでつけてください。こちらで二重に入力する必要はありません。
        </p>
      </section>

      <section className="bucket">
        <h2 className="section">案内</h2>
        <label className="row tight">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={s.showRoutine}
            onChange={(e) => setSettings({ showRoutine: e.target.checked })}
          />
          <span>朝と夜に「次にこれを押す」を出す</span>
        </label>
        <p className="hint">
          時間帯に合わせて 1 つだけ出します。押すものが無いときは何も出しません。
          データの書き出しから{BACKUP_INTERVAL_DAYS}日たつと、ここでも催促します。
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
