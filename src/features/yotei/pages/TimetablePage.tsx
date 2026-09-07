import { useMemo, useState } from 'react'
import SubNav from '../components/SubNav'
import { Field, FieldRow, Note, Sheet } from '../components/ui'
import { DAY_LABELS, formatDate, todayKey } from '../lib/date'
import { newId } from '../lib/id'
import { useApp } from '../state/AppContext'
import type { Course, PeriodTime } from '../types'

const SUB = [
  { to: '/yotei/calendar', label: 'カレンダー' },
  { to: '/yotei/timetable', label: '時間割' },
  { to: '/yotei/trips', label: '旅行' },
]

/** ふだんは月〜土。日曜は集中講義や補講のときだけ出す */
const WEEK_DAYS = [1, 2, 3, 4, 5, 6]
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

/** 今日から見て、前期 (4月〜9月) と後期 (10月〜3月) のどちらかを既定にする */
function defaultTerm(): { start: string; end: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  if (m >= 4 && m <= 9) return { start: `${y}-04-01`, end: `${y}-09-30` }
  if (m >= 10) return { start: `${y}-10-01`, end: `${y + 1}-03-31` }
  return { start: `${y - 1}-10-01`, end: `${y}-03-31` }
}

export default function TimetablePage() {
  const { data, upsert, remove, setProfile } = useApp()
  // 学期の期間は保存する。画面内だけの値だと、開き直すたびに既定値へ戻ってしまう
  const term = {
    start: data.profile.termStart ?? defaultTerm().start,
    end: data.profile.termEnd ?? defaultTerm().end,
  }
  const setTerm = (next: { start: string; end: string }) =>
    setProfile({ termStart: next.start, termEnd: next.end })
  const [editing, setEditing] = useState<Course | null>(null)
  const [showPeriods, setShowPeriods] = useState(false)
  const [skipDate, setSkipDate] = useState(todayKey())
  const [showSunday, setShowSunday] = useState(false)

  const periods = data.profile.periods
  // 日曜に登録済みの授業があれば、隠さず必ず出す
  const days = showSunday || data.courses.some((c) => c.day === 0) ? ALL_DAYS : WEEK_DAYS
  const byCell = useMemo(() => {
    const map = new Map<string, Course>()
    for (const c of data.courses) map.set(`${c.day}-${c.period}`, c)
    return map
  }, [data.courses])

  const openCell = (day: number, period: number) => {
    const existing = byCell.get(`${day}-${period}`)
    setEditing(
      existing ?? {
        id: newId('cs'),
        name: '',
        day,
        period,
        startDate: term.start,
        endDate: term.end,
        skipDates: [],
        placeId: data.places.find((p) => p.category === 'campus')?.id,
      },
    )
  }

  const applyTermToAll = () => {
    for (const c of data.courses) {
      upsert('courses', { ...c, startDate: term.start, endDate: term.end })
    }
  }

  return (
    <div className="page">
      <SubNav items={SUB} />
      <h1>時間割</h1>
      <p className="muted small">
        半年間の固定の予定はここに一度入れれば、毎日のタイムラインと出発時刻に自動で反映されます。
      </p>

      <div className="card">
        <FieldRow>
          <Field label="学期の開始">
            <input
              type="date"
              value={term.start}
              onChange={(e) => setTerm({ ...term, start: e.target.value })}
            />
          </Field>
          <Field label="学期の終了">
            <input
              type="date"
              value={term.end}
              onChange={(e) => setTerm({ ...term, end: e.target.value })}
            />
          </Field>
        </FieldRow>
        <div className="btn-row">
          <button type="button" className="btn ghost sm" onClick={applyTermToAll}>
            登録済みの授業をこの期間に揃える
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setShowPeriods((v) => !v)}
          >
            {showPeriods ? '時限の時刻を閉じる' : '時限の時刻を変える'}
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setShowSunday((v) => !v)}
          >
            {days.includes(0) ? '日曜を隠す' : '日曜も表示'}
          </button>
        </div>
      </div>

      {showPeriods ? (
        <div className="card">
          <h2>時限の時刻</h2>
          <p className="muted small">大学ごとに違うので、自分の大学に合わせてください。</p>
          {periods.map((p) => (
            <FieldRow key={p.period}>
              <Field label={`${p.period}限 開始`}>
                <input
                  type="time"
                  value={p.start}
                  onChange={(e) =>
                    setProfile({
                      periods: periods.map((x) =>
                        x.period === p.period ? { ...x, start: e.target.value } : x,
                      ),
                    })
                  }
                />
              </Field>
              <Field label="終了">
                <input
                  type="time"
                  value={p.end}
                  onChange={(e) =>
                    setProfile({
                      periods: periods.map((x) =>
                        x.period === p.period ? { ...x, end: e.target.value } : x,
                      ),
                    })
                  }
                />
              </Field>
            </FieldRow>
          ))}
          <div className="btn-row">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                const next: PeriodTime = {
                  period: periods.length + 1,
                  start: '19:40',
                  end: '21:10',
                }
                setProfile({ periods: [...periods, next] })
              }}
            >
              時限を増やす
            </button>
            {periods.length > 1 ? (
              <button
                type="button"
                className="btn ghost sm danger"
                onClick={() => setProfile({ periods: periods.slice(0, -1) })}
              >
                最後の時限を消す
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="timetable-scroll">
        <table className="timetable">
          <thead>
            <tr>
              <th />
              {days.map((d) => (
                <th key={d}>{DAY_LABELS[d]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.period}>
                <th className="tt-period">
                  <span>{p.period}限</span>
                  <span className="muted small">{p.start}</span>
                </th>
                {days.map((d) => {
                  const course = byCell.get(`${d}-${p.period}`)
                  return (
                    <td key={d}>
                      <button
                        type="button"
                        className={`tt-cell${course ? ' is-filled' : ''}`}
                        onClick={() => openCell(d, p.period)}
                      >
                        {course ? (
                          <>
                            <span className="tt-name">{course.name}</span>
                            {course.room ? <span className="tt-room">{course.room}</span> : null}
                          </>
                        ) : (
                          <span className="tt-empty">+</span>
                        )}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.places.length === 0 ? (
        <Note tone="warn">
          大学を「設定 → 場所」に登録しておくと、授業の日の出発時刻と交通費まで出せます。
        </Note>
      ) : null}

      <Sheet
        open={editing !== null}
        title={editing ? `${DAY_LABELS[editing.day]}曜 ${editing.period}限` : ''}
        onClose={() => setEditing(null)}
        footer={
          <>
            {editing && data.courses.some((c) => c.id === editing.id) ? (
              <button
                type="button"
                className="btn ghost danger"
                onClick={() => {
                  if (editing && confirm(`「${editing.name}」を削除しますか？`)) {
                    remove('courses', editing.id)
                    setEditing(null)
                  }
                }}
              >
                削除
              </button>
            ) : null}
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (editing && editing.name.trim()) upsert('courses', editing)
                setEditing(null)
              }}
            >
              保存
            </button>
          </>
        }
      >
        {editing ? (
          <>
            <Field label="科目名" wide>
              <input
                type="text"
                value={editing.name}
                placeholder="例) 経営学概論"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <FieldRow>
              <Field label="教室">
                <input
                  type="text"
                  value={editing.room ?? ''}
                  onChange={(e) => setEditing({ ...editing, room: e.target.value })}
                />
              </Field>
              <Field label="場所">
                <select
                  value={editing.placeId ?? ''}
                  onChange={(e) => setEditing({ ...editing, placeId: e.target.value || undefined })}
                >
                  <option value="">選択なし</option>
                  {data.places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </FieldRow>
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

            <h3>休講の日</h3>
            <div className="field-row">
              <input
                type="date"
                value={skipDate}
                onChange={(e) => setSkipDate(e.target.value)}
              />
              <button
                type="button"
                className="btn ghost sm"
                onClick={() =>
                  setEditing({
                    ...editing,
                    skipDates: editing.skipDates.includes(skipDate)
                      ? editing.skipDates
                      : [...editing.skipDates, skipDate].sort(),
                  })
                }
              >
                休講にする
              </button>
            </div>
            {editing.skipDates.length > 0 ? (
              <div className="chips">
                {editing.skipDates.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className="chip is-on"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        skipDates: editing.skipDates.filter((x) => x !== d),
                      })
                    }
                  >
                    {formatDate(d, false)} ×
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted small">まだありません。</p>
            )}
          </>
        ) : null}
      </Sheet>
    </div>
  )
}
