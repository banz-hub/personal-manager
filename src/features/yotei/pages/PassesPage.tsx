import { useState } from 'react'
import SubNav from '../components/SubNav'
import { Empty, Field, FieldRow, Note, Sheet } from '../components/ui'
import { addDays, formatDate, formatYen, todayKey } from '../lib/date'
import { newId } from '../lib/id'
import { useApp } from '../state/AppContext'
import type { Pass } from '../types'

const SUB = [
  { to: '/yotei/travel', label: '出発を調べる' },
  { to: '/yotei/routes', label: '区間' },
  { to: '/yotei/bulk', label: 'まとめて登録' },
  { to: '/yotei/trains', label: '時刻表' },
  { to: '/yotei/passes', label: '定期券' },
]

function blankPass(): Pass {
  return {
    id: newId('ps'),
    name: '通学定期',
    stations: [],
    startDate: todayKey(),
    endDate: addDays(todayKey(), 180),
    costYen: 0,
  }
}

/**
 * 定期券。区間に含まれる駅どうしの移動は運賃0円で計算する。
 * ここを入れておかないと、通学ぶんの交通費が実態と大きくずれる。
 */
export default function PassesPage() {
  const { data, upsert, remove } = useApp()
  const [editing, setEditing] = useState<Pass | null>(null)
  const [stationText, setStationText] = useState('')

  const open = (pass: Pass) => {
    setEditing(pass)
    setStationText(pass.stations.join(' '))
  }

  const save = () => {
    if (!editing) return
    const stations = stationText
      .split(/[\s,、,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    upsert('passes', { ...editing, stations })
    setEditing(null)
  }

  return (
    <div className="page">
      <SubNav items={SUB} />
      <h1>定期券</h1>
      <p className="muted small">
        区間に含まれる駅の間を移動したときは、交通費を0円として計算します。
      </p>

      <div className="btn-row">
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setEditing(blankPass())
            setStationText('')
          }}
        >
          定期券を追加
        </button>
      </div>

      {data.passes.length === 0 ? (
        <Empty>登録がありません。通学定期があれば入れておくと交通費の集計が実態に合います。</Empty>
      ) : (
        <ul className="list">
          {data.passes.map((pass) => {
            const active = todayKey() >= pass.startDate && todayKey() <= pass.endDate
            return (
              <li key={pass.id} className="list-item">
                <div>
                  <strong>
                    {pass.name} {active ? '' : '(期限外)'}
                  </strong>
                  <p className="muted small">
                    {pass.stations.join(' - ') || '区間の登録なし'}
                  </p>
                  <p className="muted small">
                    {formatDate(pass.startDate, false)} - {formatDate(pass.endDate, false)} /{' '}
                    {formatYen(pass.costYen)}
                  </p>
                </div>
                <div className="list-actions">
                  <button type="button" className="btn ghost sm" onClick={() => open(pass)}>
                    編集
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm danger"
                    onClick={() => {
                      if (confirm(`「${pass.name}」を削除しますか？`)) remove('passes', pass.id)
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
        title="定期券"
        onClose={() => setEditing(null)}
        footer={
          <button type="button" className="btn primary" onClick={save}>
            保存
          </button>
        }
      >
        {editing ? (
          <>
            <Field label="名前">
              <input
                type="text"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field
              label="区間に含まれる駅"
              wide
              hint="スペースか読点で区切って、通る駅を順に書いてください"
            >
              <textarea
                rows={2}
                value={stationText}
                placeholder="例) 自宅最寄り 途中の駅 大学前"
                onChange={(e) => setStationText(e.target.value)}
              />
            </Field>
            <FieldRow>
              <Field label="開始日">
                <input
                  type="date"
                  value={editing.startDate}
                  onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
                />
              </Field>
              <Field label="終了日">
                <input
                  type="date"
                  value={editing.endDate}
                  onChange={(e) => setEditing({ ...editing, endDate: e.target.value })}
                />
              </Field>
            </FieldRow>
            <Field label="購入額(円)">
              <input
                type="number"
                min={0}
                step={100}
                value={editing.costYen}
                onChange={(e) => setEditing({ ...editing, costYen: Number(e.target.value) })}
              />
            </Field>
            <Note>
              判定は「区間の両端がここに書いた駅に入っているか」で行います。途中まで定期、
              そこから先は別料金というときは、定期の外側だけを区間として登録してください。
            </Note>
          </>
        ) : null}
      </Sheet>
    </div>
  )
}
