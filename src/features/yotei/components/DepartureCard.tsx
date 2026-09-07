import { useState } from 'react'
import type { PlannedItem } from '../lib/day'
import { buildExpense, draftExpense, trainChoicesFor } from '../lib/day'
import type { RunChoice } from '../lib/timetable'
import type { Journey } from '../lib/travel'
import { toMinutes, fromMinutes } from '../lib/date'
import { formatDuration, formatYen } from '../lib/date'
import { transitLinks } from '../lib/transit'
import { useApp } from '../state/AppContext'
import { Note } from './ui'
import { isBeforeUeno } from '../data/stations'

/**
 * ひとつの予定に対する「何時に出るか」のカード。
 * 登録区間から作れた案は最大3つ並べ、作れなければ乗換案内へのリンクを出す。
 */
export default function DepartureCard({ planned }: { planned: PlannedItem }) {
  const { data, upsert } = useApp()
  const [picked, setPicked] = useState(0)
  const [recorded, setRecorded] = useState(false)
  const [roundTrip, setRoundTrip] = useState(true)

  const { item } = planned
  if (planned.journeys.length === 0) return null

  const journey = planned.journeys[picked] ?? planned.journeys[0]
  const links = transitLinks(
    planned.fromStation || data.profile.homeStation,
    item.station ?? '',
    item.event?.date ?? planned.item.course?.startDate,
    item.start,
    'arrive',
  )
  const draft = draftExpense({ ...planned, journeys: [journey] }, roundTrip)
  // 経路の最初の区間が上野より手前で終わるなら、上野止まりの便でも乗り換えは要らない
  const alightsBeforeUeno = isBeforeUeno(journey.plan?.stations[1] ?? '')

  // 時刻表が入っていれば、実際に乗る電車まで決める
  const dateKey = item.event?.date ?? ''
  const trains = dateKey ? trainChoicesFor(data, journey, item.start, dateKey) : []
  const best = trains[0]
  // 電車が決まれば、そこから逆算した出発時刻のほうが正確
  const leaveForTrain = best
    ? fromMinutes(best.departMinutes - (toMinutes(journey.boardAt) - toMinutes(journey.leaveHomeAt)))
    : null

  const record = () => {
    if (!draft) return
    const dateKey = item.event?.date ?? new Date().toISOString().slice(0, 10)
    upsert(
      'expenses',
      buildExpense({
        dateKey,
        amountYen: draft.amountYen,
        label: `${draft.label}${roundTrip ? '（往復）' : '（片道）'}`,
        category: draft.category,
        tripId: item.event?.tripId,
        reimbursed: false,
      }),
    )
    setRecorded(true)
  }

  // 区間が未登録のときは電車の時間が分からない。
  // ここで時刻を出すと当てにされてしまうので、調べる導線だけを見せる。
  if (planned.unknownRoute) {
    return (
      <div className="depart">
        <Note tone="warn">
          {planned.fromStation || '出発駅'} から {item.station} までの区間が未登録なので、
          出発時刻は出せません。乗換案内で調べて「移動 → 区間」に登録すると、次から自動で出ます。
        </Note>
        <div className="link-row">
          {links.map((l) => (
            <a key={l.url} className="btn ghost sm" href={l.url} target="_blank" rel="noreferrer">
              {l.label}
            </a>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="depart">
      <div className="depart-head">
        <div>
          <span className="depart-label">
            {planned.fromHome ? '家を出る' : `${planned.fromLabel}を出る`}
          </span>
          <strong className="depart-time">
            {journey.previousDay ? '前日 ' : ''}
            {leaveForTrain ?? journey.leaveHomeAt}
          </strong>
        </div>
        <div className="depart-side">
          <span className="muted">所要 {formatDuration(journey.totalMinutes)}</span>
          {journey.fare ? (
            <span className="muted">
              {journey.fare.chargedYen === 0 && journey.fare.coveredYen > 0
                ? `定期券で0円（${journey.fare.coveredBy.join('・')}）`
                : `片道 ${formatYen(journey.fare.chargedYen)}`}
            </span>
          ) : null}
        </div>
      </div>

      {planned.fromHome && data.profile.prepMinutes > 0 ? (
        <p className="depart-prep">
          準備を含めるなら <strong>{journey.prepareFrom}</strong> から動き始める
        </p>
      ) : null}

      {planned.journeys.length > 1 ? (
        <div className="plan-tabs">
          {planned.journeys.map((j, i) => (
            <button
              key={i}
              type="button"
              className={`plan-tab${i === picked ? ' is-active' : ''}`}
              onClick={() => setPicked(i)}
            >
              <span className="plan-tab-label">{j.plan?.label ?? '案'}</span>
              <span className="plan-tab-sub">
                {j.leaveHomeAt}発 / {formatDuration(j.totalMinutes)}
                {j.fare ? ` / ${formatYen(j.fare.chargedYen)}` : ''}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {best ? (
        <div className="trains">
          <p className="trains-best">
            <strong>{best.departAt}</strong> の電車に乗る
            {best.run.kind ? `（${best.run.kind}）` : ''} → {best.alightAt}{' '}
            <strong>{best.arriveAt}</strong> {best.estimated ? '着(見込み)' : '着'}
            {best.slackMinutes > 0 ? (
              <span className="muted small">
                {' '}
                / いつもの余裕より {formatDuration(best.slackMinutes)} 早い
              </span>
            ) : null}
          </p>
          {best.connection ? (
            <p className="trains-best">
              {best.alightAt}で乗り換え（待ち{best.connection.waitMinutes}分）→{' '}
              <strong>{best.connection.departAt}</strong> の電車 →{' '}
              <strong>{best.connection.arriveAt}</strong> 着
            </p>
          ) : null}
          {best.run.surcharge ? (
            <p className="muted small">この便は特急など追加料金が要ります。</p>
          ) : null}
          {best.run.destination === '上野' && !alightsBeforeUeno ? (
            <p className="muted small">
              この便は上野止まりです。上野より先へ行くなら乗り換えが要ります。
            </p>
          ) : null}
          {trains.length > 1 ? (
            <p className="muted small">
              ほかの候補:{' '}
              {trains
                .slice(1)
                .map((t) => `${t.departAt}発${t.run.surcharge ? '(追加料金)' : ''}`)
                .join(' / ')}
            </p>
          ) : null}
        </div>
      ) : null}

      <ol className="steps">
        {(best && leaveForTrain
          ? trainSteps(best, leaveForTrain, journey, item.start, data.profile.bufferMinutes)
          : journey.steps
        ).map((s, i) => (
          <li key={i}>
            <span className="step-at">{s.at}</span>
            <span className="step-label">{s.label}</span>
            {s.minutes > 0 ? <span className="step-min">{s.minutes}分</span> : null}
          </li>
        ))}
      </ol>

      <div className="link-row">
        {links.map((l) => (
          <a key={l.url} className="btn ghost sm" href={l.url} target="_blank" rel="noreferrer">
            {l.label}
          </a>
        ))}
      </div>

      {draft ? (
        <div className="depart-foot">
          <label className="switch">
            <input
              type="checkbox"
              checked={roundTrip}
              onChange={(e) => setRoundTrip(e.target.checked)}
            />
            <span>往復で記録</span>
          </label>
          <button type="button" className="btn sm" onClick={record} disabled={recorded}>
            {recorded ? '記録しました' : `交通費 ${formatYen(draft.amountYen)} を記録`}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 選んだ電車に合わせた内訳。
 * 所要時間だけで作った内訳と混ざると時刻が食い違うので、電車が決まったらこちらを使う。
 */
function trainSteps(
  best: RunChoice,
  leaveAt: string,
  journey: Journey,
  arriveBy: string,
  bufferMinutes: number,
): Array<{ label: string; minutes: number; at: string }> {
  const buffer = Math.max(0, bufferMinutes)
  const toStationMinutes = toMinutes(best.departAt) - toMinutes(leaveAt)
  // 降りたあと目的地までにかかる時間（余裕を除く）
  const onward = Math.max(0, best.extraMinutes - buffer)
  const steps: Array<{ label: string; minutes: number; at: string }> = []

  if (toStationMinutes > 0) {
    steps.push({
      label: `${journey.fromStation}へ`,
      minutes: toStationMinutes,
      at: best.departAt,
    })
  }
  if (best.estimated && journey.plan) {
    // 降車駅の時刻が無い便。区間の所要時間から電車・徒歩・余裕に分けて見せる
    const rideEnd = best.departMinutes + journey.plan.minutes
    steps.push({
      label: `電車 ${journey.plan.stations.join(' → ')}${
        best.run.kind ? `（${best.run.kind}）` : ''
      }`,
      minutes: journey.plan.minutes,
      at: fromMinutes(rideEnd),
    })
    if (journey.walkMinutes > 0) {
      steps.push({
        label: `${journey.toStation}から徒歩`,
        minutes: journey.walkMinutes,
        at: fromMinutes(rideEnd + journey.walkMinutes),
      })
    }
  } else if (best.connection) {
    // 時刻表どうしをつないだとき。乗り継ぎの待ち時間まで実際の便で出せる
    steps.push({
      label: `電車 ${journey.fromStation} → ${best.alightAt}${
        best.run.kind ? `（${best.run.kind}）` : ''
      }`,
      minutes: best.arriveMinutes - best.departMinutes,
      at: best.arriveAt,
    })
    if (best.connection.waitMinutes > 0) {
      steps.push({
        label: `${best.alightAt}で乗り換え・待ち`,
        minutes: best.connection.waitMinutes,
        at: best.connection.departAt,
      })
    }
    steps.push({
      label: `電車 ${best.alightAt} → ${journey.toStation}`,
      minutes: toMinutes(best.connection.arriveAt) - toMinutes(best.connection.departAt),
      at: best.connection.arriveAt,
    })
    if (journey.walkMinutes > 0) {
      steps.push({
        label: `${journey.toStation}から徒歩`,
        minutes: journey.walkMinutes,
        at: fromMinutes(toMinutes(best.connection.arriveAt) + journey.walkMinutes),
      })
    }
  } else {
    steps.push({
      label: `電車 ${journey.fromStation} → ${best.alightAt}${
        best.run.kind ? `（${best.run.kind}）` : ''
      }`,
      minutes: best.arriveMinutes - best.departMinutes,
      at: best.arriveAt,
    })
    if (onward > 0) {
      steps.push({
        label: `${best.alightAt}から先（乗り継ぎ・徒歩）`,
        minutes: onward,
        at: fromMinutes(best.arriveMinutes + onward),
      })
    }
  }
  // 実際に着く時刻から予定開始までが本当の余裕（設定した余裕＋その便で早く着くぶん）
  const arrivedAt = best.connection
    ? toMinutes(best.connection.arriveAt) + journey.walkMinutes
    : best.estimated && journey.plan
      ? best.departMinutes + journey.plan.minutes + journey.walkMinutes
      : best.arriveMinutes + onward
  const realSlack = toMinutes(arriveBy) - arrivedAt
  if (realSlack > 0) {
    steps.push({ label: '余裕', minutes: realSlack, at: arriveBy })
  }
  return steps
}
