import { useMemo, useState } from 'react'
import SubNav from '../components/SubNav'
import { Empty, Field, FieldRow, Note, Sheet, StationInput } from '../components/ui'
import { formatDuration, formatYen } from '../lib/date'
import { newId } from '../lib/id'
import { activePasses, isCoveredByPass, knownStations } from '../lib/routes'
import { yahooTransitUrl } from '../lib/transit'
import { allStations } from '../data/stations'
import { useApp } from '../state/AppContext'
import { todayKey } from '../lib/date'
import type { RouteLeg } from '../types'

const SUB = [
  { to: '/yotei/travel', label: '出発を調べる' },
  { to: '/yotei/routes', label: '区間' },
  { to: '/yotei/bulk', label: 'まとめて登録' },
  { to: '/yotei/trains', label: '時刻表' },
  { to: '/yotei/passes', label: '定期券' },
]

function blankLeg(): RouteLeg {
  return { id: newId('lg'), from: '', to: '', minutes: 20, fareYen: 200, transfers: 0 }
}

/**
 * 一度調べた区間を貯めておく画面。
 * ここに入っている区間どうしはつなげて経路にできるので、
 * よく使う駅を少しずつ足していくほど自動計算が効く範囲が広がる。
 */
export default function RoutesPage() {
  const { data, upsert, remove } = useApp()
  const [editing, setEditing] = useState<RouteLeg | null>(null)

  const stations = useMemo(
    () => knownStations(data.legs, [data.profile.homeStation, ...data.places.map((p) => p.station), ...allStations()]),
    [data.legs, data.places, data.profile.homeStation],
  )
  const passes = useMemo(() => activePasses(data.passes, todayKey()), [data.passes])
  const legs = useMemo(
    () => [...data.legs].sort((a, b) => a.from.localeCompare(b.from, 'ja')),
    [data.legs],
  )

  return (
    <div className="page">
      <SubNav items={SUB} />
      <h1>区間</h1>
      <p className="muted small">
        乗換案内で調べた結果をここに入れておくと、以後は自動で出発時刻と交通費を計算します。
        登録した区間はつなげて使えるので、「自宅→東京」と「東京→渋谷」があれば「自宅→渋谷」も出せます。
      </p>

      <div className="btn-row">
        <button type="button" className="btn primary" onClick={() => setEditing(blankLeg())}>
          区間を追加
        </button>
      </div>

      {legs.length === 0 ? (
        <Empty>まだ登録がありません。まずは自宅の最寄り駅から大学までを入れてみてください。</Empty>
      ) : (
        <ul className="list">
          {legs.map((leg) => {
            const covered = isCoveredByPass(leg, passes)
            return (
              <li key={leg.id} className="list-item">
                <div>
                  <strong>
                    {leg.from} - {leg.to}
                  </strong>
                  <p className="muted small">
                    {formatDuration(leg.minutes)} / {formatYen(leg.fareYen)} / 乗換{leg.transfers}回
                    {leg.via ? ` / ${leg.via}` : ''}
                    {covered ? ` / ${covered.name}の区間内` : ''}
                  </p>
                  <p className="muted small">
                    {leg.lastTrainFrom || leg.lastTrainTo
                      ? `終電 ${leg.from}発 ${leg.lastTrainFrom ?? '未登録'} / ${leg.to}発 ${
                          leg.lastTrainTo ?? '未登録'
                        }`
                      : '終電は未登録'}
                  </p>
                </div>
                <div className="list-actions">
                  <button type="button" className="btn ghost sm" onClick={() => setEditing(leg)}>
                    編集
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm danger"
                    onClick={() => {
                      if (confirm(`${leg.from} - ${leg.to} を削除しますか？`)) remove('legs', leg.id)
                    }}
                  >
                    削除
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Sheet
        open={editing !== null}
        title="区間"
        onClose={() => setEditing(null)}
        footer={
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (editing && editing.from.trim() && editing.to.trim()) upsert('legs', editing)
              setEditing(null)
            }}
          >
            保存
          </button>
        }
      >
        {editing ? (
          <>
            <FieldRow>
              <Field label="出発駅">
                <StationInput
                  value={editing.from}
                  onChange={(v) => setEditing({ ...editing, from: v })}
                  stations={stations}
                />
              </Field>
              <Field label="到着駅">
                <StationInput
                  value={editing.to}
                  onChange={(v) => setEditing({ ...editing, to: v })}
                  stations={stations}
                />
              </Field>
            </FieldRow>

            {editing.from.trim() && editing.to.trim() ? (
              <div className="link-row">
                <a
                  className="btn ghost sm"
                  href={yahooTransitUrl(editing.from, editing.to)}
                  target="_blank"
                  rel="noreferrer"
                >
                  乗換案内で調べる
                </a>
              </div>
            ) : null}

            <FieldRow>
              <Field label="乗車時間(分)">
                <input
                  type="number"
                  min={0}
                  value={editing.minutes}
                  onChange={(e) => setEditing({ ...editing, minutes: Number(e.target.value) })}
                />
              </Field>
              <Field label="IC運賃(円)">
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={editing.fareYen}
                  onChange={(e) => setEditing({ ...editing, fareYen: Number(e.target.value) })}
                />
              </Field>
              <Field label="乗換(回)">
                <input
                  type="number"
                  min={0}
                  value={editing.transfers}
                  onChange={(e) => setEditing({ ...editing, transfers: Number(e.target.value) })}
                />
              </Field>
            </FieldRow>
            <Field label="経由メモ" wide>
              <input
                type="text"
                value={editing.via ?? ''}
                placeholder="例) JR中央線経由"
                onChange={(e) => setEditing({ ...editing, via: e.target.value })}
              />
            </Field>

            <h3>終電</h3>
            <p className="muted small">
              入れておくと「いつまで遊べるか」を逆算します。0時をまわる終電は 00:30 のように書いてください。
            </p>
            <FieldRow>
              <Field label={`${editing.from || '出発駅'} を出る終電`}>
                <input
                  type="time"
                  value={editing.lastTrainFrom ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, lastTrainFrom: e.target.value || undefined })
                  }
                />
              </Field>
              <Field label={`${editing.to || '到着駅'} を出る終電`}>
                <input
                  type="time"
                  value={editing.lastTrainTo ?? ''}
                  onChange={(e) =>
                    setEditing({ ...editing, lastTrainTo: e.target.value || undefined })
                  }
                />
              </Field>
            </FieldRow>

            <Note>
              時間と運賃は向きを区別しません。片道ぶんを入れておけば帰りにも同じ値を使います。
              終電だけは向きで違うので、それぞれ入れてください。
            </Note>
          </>
        ) : null}
      </Sheet>
    </div>
  )
}
