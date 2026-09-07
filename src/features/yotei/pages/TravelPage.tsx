import { useMemo, useState } from 'react'
import SubNav from '../components/SubNav'
import { Field, FieldRow, Note, StationInput, Stat } from '../components/ui'
import { formatDuration, formatYen, todayKey } from '../lib/date'
import { newId } from '../lib/id'
import { knownStations } from '../lib/routes'
import { transitLinks } from '../lib/transit'
import { buildJourneys } from '../lib/travel'
import { allStations } from '../data/stations'
import { useApp } from '../state/AppContext'
import type { RouteLeg } from '../types'

const SUB = [
  { to: '/yotei/travel', label: '出発を調べる' },
  { to: '/yotei/routes', label: '区間' },
  { to: '/yotei/bulk', label: 'まとめて登録' },
  { to: '/yotei/trains', label: '時刻表' },
  { to: '/yotei/passes', label: '定期券' },
]

/**
 * 「◯時に着きたい」から出発時刻を逆算する画面。
 * 登録済みの区間で経路が作れれば最大3案、作れなければ乗換案内へ渡して
 * 結果をその場で区間として登録できるようにする。
 */
export default function TravelPage() {
  const { data, upsert } = useApp()
  const [from, setFrom] = useState(data.profile.homeStation)
  const [to, setTo] = useState('')
  const [walk, setWalk] = useState(5)
  const [dateKey, setDateKey] = useState(todayKey())
  const [arriveBy, setArriveBy] = useState('09:00')
  const [fromHome, setFromHome] = useState(true)
  const [draft, setDraft] = useState<RouteLeg | null>(null)

  const stations = useMemo(
    () => knownStations(data.legs, [data.profile.homeStation, ...data.places.map((p) => p.station), ...allStations()]),
    [data.legs, data.places, data.profile.homeStation],
  )

  const journeys = useMemo(() => {
    if (!from.trim() || !to.trim()) return []
    return buildJourneys({
      profile: data.profile,
      legs: data.legs,
      passes: data.passes,
      dateKey,
      fromStation: from,
      fromHome,
      toStation: to,
      walkMinutes: walk,
      arriveBy,
    })
  }, [data.profile, data.legs, data.passes, dateKey, from, fromHome, to, walk, arriveBy])

  const unknown = journeys.length > 0 && journeys.every((j) => j.plan === null)
  const links = transitLinks(from, to, dateKey, arriveBy, 'arrive')

  return (
    <div className="page">
      <SubNav items={SUB} />
      <h1>出発を調べる</h1>

      <div className="card">
        <FieldRow>
          <Field label="出発">
            <StationInput value={from} onChange={setFrom} stations={stations} />
          </Field>
          <Field label="行き先">
            <StationInput value={to} onChange={setTo} stations={stations} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="日付">
            <input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
          </Field>
          <Field label="到着したい時刻">
            <input type="time" value={arriveBy} onChange={(e) => setArriveBy(e.target.value)} />
          </Field>
          <Field label="駅から徒歩(分)">
            <input
              type="number"
              min={0}
              value={walk}
              onChange={(e) => setWalk(Number(e.target.value))}
            />
          </Field>
        </FieldRow>
        <div className="switch-row">
          <label className="switch">
            <input
              type="checkbox"
              checked={fromHome}
              onChange={(e) => setFromHome(e.target.checked)}
            />
            <span>
              自宅から出る（家から駅までの {data.profile.homeToStationMinutes}分 を足す）
            </span>
          </label>
        </div>
      </div>

      {journeys.length === 0 ? (
        <Note>出発地と行き先を入れると、出発時刻を逆算します。</Note>
      ) : null}

      {(unknown ? [] : journeys).map((j, i) => (
        <div className="card" key={i}>
          <div className="depart-head">
            <div>
              <span className="depart-label">
                {j.plan?.label ? `${j.plan.label}の案` : '出発時刻'}
              </span>
              <strong className="depart-time">
                {j.previousDay ? '前日 ' : ''}
                {j.leaveHomeAt}
              </strong>
            </div>
            <div className="depart-side">
              <span className="muted">所要 {formatDuration(j.totalMinutes)}</span>
              {j.fare ? (
                <span className="muted">
                  {j.fare.chargedYen === 0 && j.fare.coveredYen > 0
                    ? `定期券で0円（${j.fare.coveredBy.join('・')}）`
                    : `片道 ${formatYen(j.fare.chargedYen)}`}
                </span>
              ) : null}
            </div>
          </div>

          {fromHome && data.profile.prepMinutes > 0 ? (
            <p className="depart-prep">
              準備を含めるなら <strong>{j.prepareFrom}</strong> から
            </p>
          ) : null}

          <ol className="steps">
            {j.steps.map((s, k) => (
              <li key={k}>
                <span className="step-at">{s.at}</span>
                <span className="step-label">{s.label}</span>
                {s.minutes > 0 ? <span className="step-min">{s.minutes}分</span> : null}
              </li>
            ))}
          </ol>

          {j.plan ? (
            <div className="stat-row">
              <Stat label="乗車" value={formatDuration(j.plan.minutes)} />
              <Stat label="乗換" value={`${j.plan.transfers}回`} />
              <Stat
                label="運賃(片道)"
                value={formatYen(j.fare?.chargedYen ?? j.plan.fareYen)}
                sub={
                  j.fare && j.fare.coveredYen > 0
                    ? `定期券で ${formatYen(j.fare.coveredYen)} 節約`
                    : undefined
                }
              />
            </div>
          ) : null}
        </div>
      ))}

      {unknown ? (
        <div className="card">
          <Note tone="warn">
            この区間はまだ登録されていません。乗換案内で調べて、その結果をここに登録すると
            次からは出発時刻も交通費も自動で出ます。
          </Note>
          <div className="link-row">
            {links.map((l) => (
              <a key={l.url} className="btn ghost sm" href={l.url} target="_blank" rel="noreferrer">
                {l.label}
              </a>
            ))}
          </div>
          {draft ? (
            <>
              <FieldRow>
                <Field label="乗車時間(分)">
                  <input
                    type="number"
                    min={0}
                    value={draft.minutes}
                    onChange={(e) => setDraft({ ...draft, minutes: Number(e.target.value) })}
                  />
                </Field>
                <Field label="運賃(円)">
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={draft.fareYen}
                    onChange={(e) => setDraft({ ...draft, fareYen: Number(e.target.value) })}
                  />
                </Field>
                <Field label="乗換(回)">
                  <input
                    type="number"
                    min={0}
                    value={draft.transfers}
                    onChange={(e) => setDraft({ ...draft, transfers: Number(e.target.value) })}
                  />
                </Field>
              </FieldRow>
              <Field label="経由メモ" wide>
                <input
                  type="text"
                  value={draft.via ?? ''}
                  placeholder="例) JR中央線経由"
                  onChange={(e) => setDraft({ ...draft, via: e.target.value })}
                />
              </Field>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    upsert('legs', draft)
                    setDraft(null)
                  }}
                >
                  この区間を登録
                </button>
                <button type="button" className="btn ghost" onClick={() => setDraft(null)}>
                  やめる
                </button>
              </div>
            </>
          ) : (
            <div className="btn-row">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setDraft({
                    id: newId('lg'),
                    from,
                    to,
                    minutes: 30,
                    fareYen: 0,
                    transfers: 0,
                  })
                }
              >
                調べた結果をこの区間として登録
              </button>
            </div>
          )}
        </div>
      ) : null}

      {journeys.length > 0 && !unknown ? (
        <div className="link-row">
          {links.map((l) => (
            <a key={l.url} className="btn ghost sm" href={l.url} target="_blank" rel="noreferrer">
              {l.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  )
}
