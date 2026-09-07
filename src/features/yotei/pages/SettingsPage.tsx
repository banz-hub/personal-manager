import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, Field, FieldRow, Note, SectionTabs, Sheet, StationInput } from '../components/ui'
import { newId } from '../lib/id'
import { notificationSupport, requestNotificationPermission } from '../lib/reminders'
import { knownStations } from '../lib/routes'
import { allStations } from '../data/stations'
import { useApp } from '../state/AppContext'
import { SPOT_LABELS, type Place, type SpotKind } from '../types'

const PLACE_CATEGORIES: Array<[Place['category'], string]> = [
  ['campus', '大学'],
  ['work', 'バイト先'],
  ['home', '自宅・実家'],
  ['other', 'その他'],
]

const SPOTS = Object.entries(SPOT_LABELS) as Array<[SpotKind, string]>

function blankPlace(): Place {
  return {
    id: newId('pl'),
    name: '',
    station: '',
    walkMinutes: 5,
    category: 'other',
    spot: 'outside',
  }
}

export default function SettingsPage() {
  const { data, setProfile, upsert, remove, reset } = useApp()
  const [tab, setTab] = useState<'me' | 'place' | 'data'>('me')
  const [editing, setEditing] = useState<Place | null>(null)
  const [message, setMessage] = useState('')

  const stations = useMemo(
    () => knownStations(data.legs, [data.profile.homeStation, ...data.places.map((p) => p.station), ...allStations()]),
    [data.legs, data.places, data.profile.homeStation],
  )
  const support = notificationSupport()

  return (
    <div className="page">
      <h1>設定</h1>
      <SectionTabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'me', label: '自分' },
          { value: 'place', label: '場所' },
          { value: 'data', label: 'データ' },
        ]}
      />

      {tab === 'me' ? (
        <>
          <div className="card">
            <h2>家からの移動</h2>
            <Field label="自宅の最寄り駅" wide>
              <StationInput
                value={data.profile.homeStation}
                onChange={(v) => setProfile({ homeStation: v })}
                stations={stations}
              />
            </Field>
            <FieldRow>
              <Field label="家から駅まで(分)">
                <input
                  type="number"
                  min={0}
                  value={data.profile.homeToStationMinutes}
                  onChange={(e) => setProfile({ homeToStationMinutes: Number(e.target.value) })}
                />
              </Field>
              <Field label="その手段">
                <select
                  value={data.profile.homeToStationMethod}
                  onChange={(e) => setProfile({ homeToStationMethod: e.target.value })}
                >
                  <option value="徒歩">徒歩</option>
                  <option value="自転車">自転車</option>
                  <option value="バス">バス</option>
                  <option value="車">車</option>
                </select>
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="余裕をみる時間(分)" hint="到着予定より何分早く着きたいか">
                <input
                  type="number"
                  min={0}
                  value={data.profile.bufferMinutes}
                  onChange={(e) => setProfile({ bufferMinutes: Number(e.target.value) })}
                />
              </Field>
              <Field label="出発前の準備(分)" hint="起きてから家を出るまで">
                <input
                  type="number"
                  min={0}
                  value={data.profile.prepMinutes}
                  onChange={(e) => setProfile({ prepMinutes: Number(e.target.value) })}
                />
              </Field>
            </FieldRow>
          </div>

          <div className="card">
            <h2>通知</h2>
            <p className="muted small">
              状態: {support.supported ? `許可 ${support.permission}` : 'この環境では使えません'} /
              閉じていても鳴らせる: {support.canScheduleInBackground ? 'はい' : 'いいえ'} /
              ホーム画面から起動: {support.standalone ? 'はい' : 'いいえ'}
            </p>
            {support.supported && support.permission !== 'granted' ? (
              <div className="btn-row">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void requestNotificationPermission().then(() => setMessage('設定を更新しました。'))}
                >
                  通知を許可する
                </button>
              </div>
            ) : null}
            <Note>
              iPhone では、Safari で開いたままだと通知が使えません。共有メニューから
              「ホーム画面に追加」して、そのアイコンから開いてください。確実に鳴らしたいときは、
              予定ごとの「端末カレンダーに追加」を使うのが一番確実です。
            </Note>
          </div>

          <div className="card">
            <h2>やること・趣味</h2>
            <p className="muted small">空き時間の提案に使う項目はこちらで編集します。</p>
            <div className="btn-row">
              <Link className="btn ghost" to="/yotei/todos">
                やること・趣味・今の状況
              </Link>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'place' ? (
        <>
          <p className="muted small">
            よく行く場所を登録しておくと、予定を作るときに駅と徒歩時間を選ぶだけで済みます。
          </p>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={() => setEditing(blankPlace())}>
              場所を追加
            </button>
          </div>
          {data.places.length === 0 ? (
            <Empty>まずは大学とバイト先を入れておくと便利です。</Empty>
          ) : (
            <ul className="list">
              {data.places.map((p) => (
                <li key={p.id} className="list-item">
                  <div>
                    <strong>{p.name}</strong>
                    <p className="muted small">
                      {p.station}駅から徒歩{p.walkMinutes}分 / {SPOT_LABELS[p.spot]}
                    </p>
                  </div>
                  <div className="list-actions">
                    <button type="button" className="btn ghost sm" onClick={() => setEditing(p)}>
                      編集
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm danger"
                      onClick={() => {
                        if (confirm(`「${p.name}」を削除しますか？`)) remove('places', p.id)
                      }}
                    >
                      削除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {tab === 'data' ? (
        <>
          {/*
            書き出し・読み込みはエージェントの設定に集めた。
            同じことをする場所が 4 つあって、どれを押せばよいか分からなかったため。
          */}
          <div className="card">
            <h2>バックアップ</h2>
            <p className="muted small">
              書き出し・読み込みは <strong>設定 → データの引っ越し</strong> にまとめてあります。
              3 つまとめて 1 ファイルで持ち運べます。よてい帳のぶんだけ入れ替えたいときは、
              そこの「1つずつ」を開いてください。
            </p>
            <Link className="btn" to="/settings">
              設定を開く
            </Link>
            {message ? <p className="muted small">{message}</p> : null}
          </div>

          <div className="card">
            <h2>今入っているもの</h2>
            <ul className="kv">
              <li>
                <span>予定</span>
                <strong>{data.events.length}件</strong>
              </li>
              <li>
                <span>授業</span>
                <strong>{data.courses.length}件</strong>
              </li>
              <li>
                <span>区間</span>
                <strong>{data.legs.length}件</strong>
              </li>
              <li>
                <span>支出</span>
                <strong>{data.expenses.length}件</strong>
              </li>
              <li>
                <span>やること</span>
                <strong>{data.todos.length}件</strong>
              </li>
            </ul>
          </div>

          <div className="card">
            <h2>全部消す</h2>
            <p className="muted small">元に戻せません。先に書き出しておいてください。</p>
            <div className="btn-row">
              <button
                type="button"
                className="btn ghost danger"
                onClick={() => {
                  if (confirm('保存されているデータをすべて削除します。よろしいですか？')) {
                    void reset().then(() => setMessage('削除しました。'))
                  }
                }}
              >
                すべて削除
              </button>
            </div>
          </div>
        </>
      ) : null}

      <Sheet
        open={editing !== null}
        title="場所"
        onClose={() => setEditing(null)}
        footer={
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (editing && editing.name.trim()) upsert('places', editing)
              setEditing(null)
            }}
          >
            保存
          </button>
        }
      >
        {editing ? (
          <>
            <Field label="名前" wide>
              <input
                type="text"
                value={editing.name}
                placeholder="例) 大学 / 駅前のカフェ"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <FieldRow>
              <Field label="最寄り駅">
                <StationInput
                  value={editing.station}
                  onChange={(v) => setEditing({ ...editing, station: v })}
                  stations={stations}
                />
              </Field>
              <Field label="駅から徒歩(分)">
                <input
                  type="number"
                  min={0}
                  value={editing.walkMinutes}
                  onChange={(e) => setEditing({ ...editing, walkMinutes: Number(e.target.value) })}
                />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="種類">
                <select
                  value={editing.category}
                  onChange={(e) =>
                    setEditing({ ...editing, category: e.target.value as Place['category'] })
                  }
                >
                  {PLACE_CATEGORIES.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ここでできること" hint="空き時間の提案に使います">
                <select
                  value={editing.spot}
                  onChange={(e) => setEditing({ ...editing, spot: e.target.value as SpotKind })}
                >
                  {SPOTS.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </FieldRow>
            <Field label="メモ" wide>
              <textarea
                rows={2}
                value={editing.memo ?? ''}
                onChange={(e) => setEditing({ ...editing, memo: e.target.value })}
              />
            </Field>
          </>
        ) : null}
      </Sheet>
    </div>
  )
}
