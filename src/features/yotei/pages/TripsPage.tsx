import { useMemo, useState } from 'react'
import SubNav from '../components/SubNav'
import { Empty, Field, FieldRow, Sheet, Stat } from '../components/ui'
import { addDays, formatDate, formatYen, todayKey } from '../lib/date'
import { newId } from '../lib/id'
import { forTrip, sumExpenses } from '../lib/money'
import { useApp } from '../state/AppContext'
import { EXPENSE_LABELS, KIND_LABELS, type Expense, type ExpenseKind, type Trip } from '../types'

const SUB = [
  { to: '/yotei/calendar', label: 'カレンダー' },
  { to: '/yotei/timetable', label: '時間割' },
  { to: '/yotei/trips', label: '旅行' },
]

const KINDS = Object.entries(KIND_LABELS) as Array<[ExpenseKind, string]>

function blankTrip(): Trip {
  return {
    id: newId('tp'),
    name: '',
    startDate: todayKey(),
    endDate: addDays(todayKey(), 2),
  }
}

function blankExpense(trip: Trip): Expense {
  return {
    id: newId('ex'),
    date: trip.startDate,
    amountYen: 0,
    category: 'trip',
    kind: 'transport',
    label: '',
    tripId: trip.id,
    reimbursed: false,
    auto: false,
  }
}

/**
 * 旅行ごとの費用をまとめる画面。
 * 新幹線・高速バス・飛行機は運賃を自動で取れないので、ここで手入力して1本にまとめる。
 */
export default function TripsPage() {
  const { data, upsert, remove } = useApp()
  const [editing, setEditing] = useState<Trip | null>(null)
  const [spending, setSpending] = useState<Expense | null>(null)

  const trips = useMemo(
    () => [...data.trips].sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [data.trips],
  )

  return (
    <div className="page">
      <SubNav items={SUB} />
      <h1>旅行</h1>
      <p className="muted small">
        旅行ごとに費用をまとめます。日々の予定は「カレンダー」で種類を旅行にして、この旅行に紐づけてください。
      </p>

      <div className="btn-row">
        <button type="button" className="btn primary" onClick={() => setEditing(blankTrip())}>
          旅行を追加
        </button>
      </div>

      {trips.length === 0 ? (
        <Empty>まだ登録がありません。</Empty>
      ) : (
        trips.map((trip) => {
          const expenses = forTrip(data.expenses, trip.id)
          const totals = sumExpenses(expenses)
          const events = data.events.filter((e) => e.tripId === trip.id)
          const over = trip.budgetYen != null && totals.net > trip.budgetYen
          return (
            <div className="card" key={trip.id}>
              <div className="list-item no-border">
                <div>
                  <strong>{trip.name || '(名前なし)'}</strong>
                  <p className="muted small">
                    {formatDate(trip.startDate)} - {formatDate(trip.endDate)} / 予定 {events.length}件
                  </p>
                </div>
                <div className="list-actions">
                  <button type="button" className="btn ghost sm" onClick={() => setEditing(trip)}>
                    編集
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm danger"
                    onClick={() => {
                      if (confirm(`「${trip.name}」を削除しますか？費用の記録は残ります。`)) {
                        remove('trips', trip.id)
                      }
                    }}
                  >
                    削除
                  </button>
                </div>
              </div>

              <div className="stat-row">
                <Stat label="かかった額" value={formatYen(totals.total)} />
                <Stat
                  label="自己負担"
                  value={formatYen(totals.net)}
                  sub={totals.reimbursed > 0 ? `支給 ${formatYen(totals.reimbursed)}` : undefined}
                />
                {trip.budgetYen != null ? (
                  <Stat
                    label="予算"
                    value={formatYen(trip.budgetYen)}
                    sub={
                      over
                        ? `${formatYen(totals.net - trip.budgetYen)} 超過`
                        : `残り ${formatYen(trip.budgetYen - totals.net)}`
                    }
                  />
                ) : null}
              </div>

              {expenses.length > 0 ? (
                <ul className="list">
                  {expenses
                    .slice()
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((e) => (
                      <li key={e.id} className="list-item">
                        <div>
                          <strong>{e.label || KIND_LABELS[e.kind]}</strong>
                          <p className="muted small">
                            {formatDate(e.date, false)} / {KIND_LABELS[e.kind]}
                            {e.reimbursed ? ' / 支給あり' : ''}
                          </p>
                        </div>
                        <div className="list-actions">
                          <strong>{formatYen(e.amountYen)}</strong>
                          <button
                            type="button"
                            className="btn ghost sm danger"
                            onClick={() => remove('expenses', e.id)}
                          >
                            削除
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
              ) : null}

              <div className="btn-row">
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setSpending(blankExpense(trip))}
                >
                  費用を追加
                </button>
              </div>
            </div>
          )
        })
      )}

      <Sheet
        open={editing !== null}
        title="旅行"
        onClose={() => setEditing(null)}
        footer={
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (editing && editing.name.trim()) upsert('trips', editing)
              setEditing(null)
            }}
          >
            保存
          </button>
        }
      >
        {editing ? (
          <>
            <Field label="旅行の名前" wide>
              <input
                type="text"
                value={editing.name}
                placeholder="例) 京都旅行"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <FieldRow>
              <Field label="出発日">
                <input
                  type="date"
                  value={editing.startDate}
                  onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
                />
              </Field>
              <Field label="帰宅日">
                <input
                  type="date"
                  value={editing.endDate}
                  onChange={(e) => setEditing({ ...editing, endDate: e.target.value })}
                />
              </Field>
            </FieldRow>
            <Field label="予算(円)" hint="空欄なら予算は見ません">
              <input
                type="number"
                min={0}
                step={1000}
                value={editing.budgetYen ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    budgetYen: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </Field>
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

      <Sheet
        open={spending !== null}
        title="旅行の費用"
        onClose={() => setSpending(null)}
        footer={
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (spending && spending.amountYen > 0) upsert('expenses', spending)
              setSpending(null)
            }}
          >
            保存
          </button>
        }
      >
        {spending ? (
          <>
            <FieldRow>
              <Field label="日付">
                <input
                  type="date"
                  value={spending.date}
                  onChange={(e) => setSpending({ ...spending, date: e.target.value })}
                />
              </Field>
              <Field label="金額(円)">
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={spending.amountYen}
                  onChange={(e) => setSpending({ ...spending, amountYen: Number(e.target.value) })}
                />
              </Field>
            </FieldRow>
            <Field label="内容" wide>
              <input
                type="text"
                value={spending.label}
                placeholder="例) 新幹線 東京→京都 / 宿1泊目"
                onChange={(e) => setSpending({ ...spending, label: e.target.value })}
              />
            </Field>
            <Field label="種類">
              <select
                value={spending.kind}
                onChange={(e) => setSpending({ ...spending, kind: e.target.value as ExpenseKind })}
              >
                {KINDS.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="switch-row">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={spending.reimbursed}
                  onChange={(e) => setSpending({ ...spending, reimbursed: e.target.checked })}
                />
                <span>あとで支給・精算される（自己負担から除く）</span>
              </label>
            </div>
            <p className="muted small">分類は「{EXPENSE_LABELS.trip}」で記録されます。</p>
          </>
        ) : null}
      </Sheet>
    </div>
  )
}
