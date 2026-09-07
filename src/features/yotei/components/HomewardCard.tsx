import type { Homeward } from '../lib/day'
import { formatDuration, formatYen, fromMinutes } from '../lib/date'
import { formatLateNight } from '../lib/lastTrain'
import { transitLinks } from '../lib/transit'
import { Note } from './ui'

/**
 * その日の帰り道。「いつまでそこにいられるか」を終電から逆算して見せる。
 * 終電が未登録なら時刻は出さず、登録を促すだけにする。
 */
export default function HomewardCard({
  homeward,
  dateKey,
  homeStation,
  freeUntilFrom,
}: {
  homeward: Homeward
  dateKey: string
  homeStation: string
  /** 最後の予定が終わる時刻 (分)。ここから終電までが自由に使える */
  freeUntilFrom?: number
}) {
  const links = transitLinks(homeward.fromStation, homeStation, dateKey, undefined, 'depart')
  const last = homeward.lastTrain
  const run = homeward.lastRun
  // 時刻表から出せるなら、そちらが実際の便なので優先する
  const leaveByMinutes = run ? run.departMinutes - homeward.walkMinutes : last?.leaveByMinutes

  return (
    <div className="card homeward">
      <div className="depart-head">
        <div>
          <span className="depart-label">帰り（{homeward.fromLabel} → 自宅）</span>
          {run ? (
            <strong className="depart-time">
              {formatLateNight(run.departMinutes - homeward.walkMinutes)} までに出る
            </strong>
          ) : last ? (
            <strong className="depart-time">{last.leaveBy} までに出る</strong>
          ) : (
            <strong className="depart-time is-unknown">終電が未登録</strong>
          )}
        </div>
        {homeward.plan ? (
          <div className="depart-side">
            <span className="muted">帰りは {formatDuration(homeward.plan.minutes)}</span>
            <span className="muted">片道 {formatYen(homeward.plan.fareYen)}</span>
          </div>
        ) : null}
      </div>

      {run ? (
        <>
          {'connection' in run && run.connection ? (
            <p className="muted small">
              {homeward.fromStation} {run.departAt}発 → 乗り換え →{' '}
              {(run.connection as { departAt: string }).departAt}発 → {homeStation}{' '}
              {formatLateNight(run.arriveMinutes)}着
            </p>
          ) : null}
          <p className="depart-prep">
            {homeward.fromStation} <strong>{run.departAt}</strong> 発が最終
            {run.run.destination ? `（${run.run.destination}）` : ''} →{' '}
            {homeStation} <strong>{formatLateNight(run.arriveMinutes)}</strong> 着
            {homeward.walkMinutes > 0
              ? `。駅まで徒歩${homeward.walkMinutes}分ぶん引いてあります`
              : ''}
          </p>
          {freeUntilFrom != null && leaveByMinutes != null && leaveByMinutes > freeUntilFrom ? (
            <p className="homeward-free">
              予定が終わってから{' '}
              <strong>{formatDuration(leaveByMinutes - freeUntilFrom)}</strong> 使えます（
              {fromMinutes(freeUntilFrom)} 〜 {formatLateNight(leaveByMinutes)}）
            </p>
          ) : null}
        </>
      ) : last ? (
        <>
          <p className="depart-prep">
            {homeward.fromStation} を <strong>{last.boardBy}</strong> に出る電車が最後
            {homeward.walkMinutes > 0
              ? `。駅まで徒歩${homeward.walkMinutes}分ぶん引いてあります`
              : ''}
          </p>

          {freeUntilFrom != null && last.leaveByMinutes > freeUntilFrom ? (
            <p className="homeward-free">
              予定が終わってから <strong>{formatDuration(last.leaveByMinutes - freeUntilFrom)}</strong>{' '}
              使えます（{fromMinutes(freeUntilFrom)} 〜 {last.leaveBy}）
            </p>
          ) : null}

          {last.legLimits.length > 1 ? (
            <ol className="steps">
              {last.legLimits.map((l, i) => (
                <li key={i}>
                  <span className="step-at">{formatLateNight(l.limitMinutes)}</span>
                  <span className="step-label">
                    {l.from} → {l.to} に乗る
                  </span>
                  <span className="step-min">
                    {l.limitMinutes === l.lastTrainMinutes ? 'これが終電' : '乗り継ぎの都合'}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {last.binding && last.legLimits.length > 1 ? (
            <p className="muted small">
              いちばん厳しいのは {last.binding.from} → {last.binding.to} の終電です。
            </p>
          ) : null}
        </>
      ) : homeward.plan ? (
        <Note tone="warn">
          帰りの経路はわかりますが、終電の時刻が入っていません。「移動 → 区間」でこの区間を開き、
          終電を入れると「いつまでいられるか」が出せます。
        </Note>
      ) : (
        <Note tone="warn">
          {homeward.fromStation} から {homeStation || '自宅の最寄り駅'} への区間が未登録です。
        </Note>
      )}

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

