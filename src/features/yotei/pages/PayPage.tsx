import { useMemo, useState } from 'react'
import SubNav from '../components/SubNav'
import { Empty, Note, Stat } from '../components/ui'
import { formatDate, formatDuration, formatYen, todayKey } from '../lib/date'
import { payPeriodEndingIn, payTypeOf, summarizePay, yearlyPay } from '../lib/payroll'
import { useApp } from '../state/AppContext'

const SUB = [
  { to: '/yotei/money', label: '交通費' },
  { to: '/yotei/pay', label: '給与' },
  { to: '/yotei/jobs', label: 'バイト先' },
]

/** バイトの給与。締め期間ごとに、シフトから自動で計算する。 */
export default function PayPage() {
  const { data } = useApp()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const summaries = useMemo(
    () =>
      data.jobs.map((job) => {
        const period = payPeriodEndingIn(job, year, month)
        return summarizePay(job, data.events, period)
      }),
    [data.jobs, data.events, year, month],
  )

  const yearTotal = useMemo(
    () => yearlyPay(data.jobs, data.events, year),
    [data.jobs, data.events, year],
  )
  const periodTotal = summaries.reduce((s, x) => s + x.totalYen, 0)

  const shift = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
  }

  if (data.jobs.length === 0) {
    return (
      <div className="page">
        <SubNav items={SUB} />
        <h1>給与</h1>
        <Empty>
          先に「バイト先」を登録してください。登録したあと、カレンダーで種類を「バイト」にした予定が
          そのままシフトとして計算されます。
        </Empty>
      </div>
    )
  }

  return (
    <div className="page">
      <SubNav items={SUB} />

      <div className="day-nav">
        <button type="button" className="btn ghost sm" onClick={() => shift(-1)}>
          前の締め
        </button>
        <strong className="month-title">
          {year}年{month}月 締め
        </strong>
        <button type="button" className="btn ghost sm" onClick={() => shift(1)}>
          次の締め
        </button>
      </div>

      <div className="stat-row">
        <Stat label="この締めの合計" value={formatYen(periodTotal)} />
        <Stat label={`${year}年の合計`} value={formatYen(yearTotal)} />
      </div>

      {summaries.map((s) => (
        <div className="card" key={s.job.id}>
          <div className="list-item no-border">
            <div>
              <strong>{s.job.name}</strong>
              <p className="muted small">
                {formatDate(s.period.from, false)} - {formatDate(s.period.to, false)} 締め /{' '}
                {formatDate(s.period.payDate, false)} 支払
              </p>
            </div>
            <strong className="big">{formatYen(s.totalYen)}</strong>
          </div>

          {payTypeOf(s.job) === 'perClass' ? (
            <div className="stat-row">
              <Stat
                label="コマ給"
                value={formatYen(s.classPayYen)}
                sub={`${s.classCount}コマ`}
              />
              <Stat
                label="日当"
                value={formatYen(s.allowanceYen)}
                sub={`${s.shifts.filter((x) => x.allowanceYen > 0).length}日ぶん`}
              />
              <Stat
                label="事務給"
                value={formatYen(s.officePayYen)}
                sub={s.officeMinutes > 0 ? formatDuration(s.officeMinutes) : '0分'}
              />
              <Stat label="在校" value={formatDuration(s.workedMinutes)} sub={`${s.shifts.length}回`} />
              {s.transportYen > 0 ? <Stat label="交通費" value={formatYen(s.transportYen)} /> : null}
            </div>
          ) : (
            <div className="stat-row">
              <Stat
                label="勤務"
                value={formatDuration(s.workedMinutes)}
                sub={`${s.shifts.length}回`}
              />
              <Stat label="基本給" value={formatYen(s.basePayYen)} />
              <Stat label="深夜割増" value={formatYen(s.nightExtraYen)} />
              <Stat label="交通費" value={formatYen(s.transportYen)} />
            </div>
          )}

          {s.shifts.length === 0 ? (
            <p className="muted small">この期間のシフトはまだありません。</p>
          ) : (
            <ul className="list">
              {s.shifts.map((sh) => (
                <li key={sh.event.id} className="list-item">
                  <div>
                    <strong>
                      {formatDate(sh.event.date, false)} {sh.event.start} - {sh.event.end}
                    </strong>
                    {sh.payType === 'perClass' ? (
                      <p className="muted small">
                        {sh.classCount}コマ（{formatDuration(sh.teachingMinutes)}）/ 在校{' '}
                        {formatDuration(sh.workedMinutes)}
                        {sh.officeMinutes > 0
                          ? ` / 事務 ${formatDuration(sh.officeMinutes)}`
                          : ' / 事務なし'}
                        {sh.allowanceYen === 0 ? ' / 日当はこの日の1件目に計上' : ''}
                      </p>
                    ) : (
                      <p className="muted small">
                        実働 {formatDuration(sh.workedMinutes)}
                        {sh.nightMinutes > 0 ? ` / 深夜 ${formatDuration(sh.nightMinutes)}` : ''}
                        {sh.event.breakMinutes ? ` / 休憩 ${sh.event.breakMinutes}分` : ''}
                      </p>
                    )}
                  </div>
                  <strong>{formatYen(sh.totalYen)}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <Note>
        扶養の範囲を気にする場合は、上の「{year}年の合計」を目安にしてください。判定の基準額は
        制度の改正で変わるので、実際の金額は最新の情報を確認してください。
      </Note>
      <p className="muted small">
        今日は {formatDate(todayKey())} です。シフトは「予定」タブで種類を「バイト」にして追加します。
      </p>
    </div>
  )
}
