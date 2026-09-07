import { useMemo, useState } from 'react'
import SubNav from '../components/SubNav'
import { Field, Note, StationInput } from '../components/ui'
import { allStations, destinationGroups } from '../data/stations'
import { formatYen } from '../lib/date'
import { newId } from '../lib/id'
import { knownStations, normalizeStation } from '../lib/routes'
import { yahooTransitUrl } from '../lib/transit'
import { useApp } from '../state/AppContext'
import type { RouteLeg } from '../types'

const SUB = [
  { to: '/yotei/travel', label: '出発を調べる' },
  { to: '/yotei/routes', label: '区間' },
  { to: '/yotei/bulk', label: 'まとめて登録' },
  { to: '/yotei/trains', label: '時刻表' },
  { to: '/yotei/passes', label: '定期券' },
]

interface Draft {
  minutes: string
  fareYen: string
}

/**
 * よく使う駅への区間を、一覧を見ながらまとめて登録する画面。
 *
 * 所要時間と運賃は乗換案内で調べた実際の値を入れてもらう。
 * ここで概算を出さないのは、間違えた運賃がそのまま交通費の記録になってしまうため。
 * 行ごとに乗換案内へのリンクを置いてあるので、開いて見た値をそのまま写せる。
 */
export default function BulkRoutesPage() {
  const { data, upsert } = useApp()
  const [from, setFrom] = useState(data.profile.homeStation)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saved, setSaved] = useState(0)

  const stations = useMemo(
    () => knownStations(data.legs, [...allStations(), data.profile.homeStation]),
    [data.legs, data.profile.homeStation],
  )
  const groups = useMemo(() => destinationGroups(from), [from])

  /** すでに登録済みの区間を引く（向きは区別しない） */
  const existing = (to: string): RouteLeg | undefined =>
    data.legs.find(
      (l) =>
        (normalizeStation(l.from) === normalizeStation(from) &&
          normalizeStation(l.to) === normalizeStation(to)) ||
        (normalizeStation(l.to) === normalizeStation(from) &&
          normalizeStation(l.from) === normalizeStation(to)),
    )

  const EMPTY: Draft = { minutes: '', fareYen: '' }
  const setDraft = (to: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [to]: { ...(prev[to] ?? EMPTY), ...patch } }))

  const filled = Object.entries(drafts).filter(
    ([, d]) => Number(d.minutes) > 0 && d.fareYen !== '',
  )

  const saveAll = () => {
    let count = 0
    for (const [to, d] of filled) {
      const prev = existing(to)
      const leg: RouteLeg = {
        id: prev?.id ?? newId('lg'),
        from: prev?.from ?? from,
        to: prev?.to ?? to,
        minutes: Number(d.minutes),
        fareYen: Number(d.fareYen),
        transfers: prev?.transfers ?? 0,
        via: prev?.via,
        lastTrainFrom: prev?.lastTrainFrom,
        lastTrainTo: prev?.lastTrainTo,
      }
      upsert('legs', leg)
      count++
    }
    setDrafts({})
    setSaved(count)
  }

  return (
    <div className="page">
      <SubNav items={SUB} />
      <h1>まとめて登録</h1>
      <p className="muted small">
        よく行く駅を一覧にしてあります。乗換案内で調べた <strong>所要時間</strong> と{' '}
        <strong>運賃</strong> を入れて、最後にまとめて保存してください。
        入れた区間はつなげて使えるので、全部埋める必要はありません。
      </p>

      <div className="card">
        <Field label="出発駅" hint="ここからの区間を登録します">
          <StationInput value={from} onChange={setFrom} stations={stations} />
        </Field>
        <Note>
          まずは <strong>自宅の最寄り駅から主要な乗換駅まで</strong>（上野・東京・北千住・柏など）を
          埋めるのが効率的です。そこから先は山手線内だけ登録すれば、組み合わせで計算できます。
        </Note>
      </div>

      {saved > 0 ? <Note>{saved}件を保存しました。</Note> : null}

      {groups.map(({ line, stations: dests }) => (
        <div className="card" key={line.id}>
          <h2>{line.name}</h2>
          {line.note ? <p className="muted small">{line.note}</p> : null}
          <table className="bulk">
            <thead>
              <tr>
                <th>行き先</th>
                <th>所要(分)</th>
                <th>運賃(円)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dests.map((to) => {
                const prev = existing(to)
                const draft = drafts[to]
                return (
                  <tr key={`${line.id}-${to}`} className={prev ? 'is-registered' : ''}>
                    <th scope="row">
                      {to}
                      {prev ? <span className="pill">登録済</span> : null}
                    </th>
                    <td>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        placeholder={prev ? String(prev.minutes) : ''}
                        value={draft?.minutes ?? ''}
                        onChange={(e) => setDraft(to, { minutes: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        placeholder={prev ? String(prev.fareYen) : ''}
                        value={draft?.fareYen ?? ''}
                        onChange={(e) => setDraft(to, { fareYen: e.target.value })}
                      />
                    </td>
                    <td>
                      <a
                        className="btn ghost sm"
                        href={yahooTransitUrl(from, to)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        調べる
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div className="bulk-save">
        <span className="muted small">
          {filled.length > 0
            ? `${filled.length}件を保存します`
            : '所要時間と運賃の両方を入れた行が保存されます'}
        </span>
        <button
          type="button"
          className="btn primary"
          disabled={filled.length === 0}
          onClick={saveAll}
        >
          入力したぶんを保存
        </button>
      </div>

      {data.legs.length > 0 ? (
        <p className="muted small">
          いま登録済みの区間は {data.legs.length} 件、運賃の合計は{' '}
          {formatYen(data.legs.reduce((s, l) => s + l.fareYen, 0))} 相当です。
        </p>
      ) : null}
    </div>
  )
}
