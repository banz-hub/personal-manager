import { useMemo, useState } from 'react'
import SubNav from '../components/SubNav'
import { Empty, Field, FieldRow, Sheet, Stat } from '../components/ui'
import { addMonths, formatDate, formatMonth, formatYen, monthKey, todayKey } from '../lib/date'
import { newId } from '../lib/id'
import { byCategory, byKind, inMonth, inYear, monthlySeries, sumExpenses } from '../lib/money'
import { useApp } from '../state/AppContext'
import {
  EXPENSE_LABELS,
  KIND_LABELS,
  type Expense,
  type ExpenseCategory,
  type ExpenseKind,
} from '../types'

const SUB = [
  { to: '/yotei/money', label: '交通費' },
  { to: '/yotei/pay', label: '給与' },
  { to: '/yotei/jobs', label: 'バイト先' },
]

const CATEGORIES = Object.entries(EXPENSE_LABELS) as Array<[ExpenseCategory, string]>
const KINDS = Object.entries(KIND_LABELS) as Array<[ExpenseKind, string]>

function blankExpense(dateKey: string): Expense {
  return {
    id: newId('ex'),
    date: dateKey,
    amountYen: 0,
    category: 'commute',
    kind: 'transport',
    label: '',
    means: '電車',
    reimbursed: false,
    auto: false,
  }
}

/** 交通費と支出の集計。実質の自己負担を主役にして、支給ぶんは別に見せる。 */
export default function MoneyPage() {
  const { data, upsert, remove } = useApp()
  const [ym, setYm] = useState(() => monthKey(todayKey()))
  const [editing, setEditing] = useState<Expense | null>(null)

  const year = ym.slice(0, 4)
  const monthList = useMemo(() => inMonth(data.expenses, ym), [data.expenses, ym])
  const yearList = useMemo(() => inYear(data.expenses, year), [data.expenses, year])
  const monthTotals = useMemo(() => sumExpenses(monthList), [monthList])
  const yearTotals = useMemo(() => sumExpenses(yearList), [yearList])
  const series = useMemo(() => monthlySeries(data.expenses, year), [data.expenses, year])
  const maxMonth = Math.max(1, ...series.map((s) => s.totals.net))

  // 定期券は購入した月の支出として別に見せる
  const passCostThisMonth = useMemo(
    () => data.passes.filter((p) => monthKey(p.startDate) === ym).reduce((s, p) => s + p.costYen, 0),
    [data.passes, ym],
  )

  return (
    <div className="page">
      <SubNav items={SUB} />

      <div className="day-nav">
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setYm(monthKey(addMonths(`${ym}-01`, -1)))}
        >
          前の月
        </button>
        <strong className="month-title">{formatMonth(ym)}</strong>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setYm(monthKey(addMonths(`${ym}-01`, 1)))}
        >
          次の月
        </button>
      </div>

      <div className="stat-row">
        <Stat
          label="今月の自己負担"
          value={formatYen(monthTotals.net)}
          sub={`かかった額 ${formatYen(monthTotals.total)}`}
        />
        <Stat label="今月の支給ぶん" value={formatYen(monthTotals.reimbursed)} />
        <Stat
          label={`${year}年の自己負担`}
          value={formatYen(yearTotals.net)}
          sub={`${yearTotals.count}件`}
        />
      </div>

      {passCostThisMonth > 0 ? (
        <p className="muted small">
          この月は定期券の購入が {formatYen(passCostThisMonth)} あります（上の集計には含めていません）。
        </p>
      ) : null}

      <div className="btn-row">
        <button
          type="button"
          className="btn primary"
          onClick={() => setEditing(blankExpense(`${ym}-01`))}
        >
          支出を追加
        </button>
      </div>

      <h2>{year}年の推移（自己負担）</h2>
      <div className="bars">
        {series.map((s) => (
          <div
            key={s.month}
            className={`bar${monthKey(`${year}-${String(s.month).padStart(2, '0')}-01`) === ym ? ' is-active' : ''}`}
          >
            <span className="bar-value">{s.totals.net > 0 ? formatYen(s.totals.net) : ''}</span>
            <span
              className="bar-fill"
              style={{ height: `${Math.round((s.totals.net / maxMonth) * 100)}%` }}
            />
            <span className="bar-label">{s.month}</span>
          </div>
        ))}
      </div>

      <h2>今月の内訳</h2>
      {monthList.length === 0 ? (
        <Empty>この月の記録はありません。</Empty>
      ) : (
        <>
          <div className="card">
            <h3>用途べつ</h3>
            <ul className="kv">
              {byCategory(monthList).map((row) => (
                <li key={row.category}>
                  <span>{EXPENSE_LABELS[row.category]}</span>
                  <strong>{formatYen(row.totals.net)}</strong>
                </li>
              ))}
            </ul>
            <h3>種類べつ</h3>
            <ul className="kv">
              {byKind(monthList).map((row) => (
                <li key={row.kind}>
                  <span>{KIND_LABELS[row.kind]}</span>
                  <strong>{formatYen(row.totals.net)}</strong>
                </li>
              ))}
            </ul>
          </div>

          <ul className="list">
            {[...monthList]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((e) => (
                <li key={e.id} className="list-item">
                  <div>
                    <strong>{e.label || KIND_LABELS[e.kind]}</strong>
                    <p className="muted small">
                      {formatDate(e.date, false)} / {EXPENSE_LABELS[e.category]} /{' '}
                      {KIND_LABELS[e.kind]}
                      {e.reimbursed ? ' / 支給あり' : ''}
                      {e.auto ? ' / 自動' : ''}
                    </p>
                  </div>
                  <div className="list-actions">
                    <strong>{formatYen(e.amountYen)}</strong>
                    <button type="button" className="btn ghost sm" onClick={() => setEditing(e)}>
                      編集
                    </button>
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
        </>
      )}

      <Sheet
        open={editing !== null}
        title="支出"
        onClose={() => setEditing(null)}
        footer={
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (editing && editing.amountYen > 0) upsert('expenses', editing)
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
              <Field label="日付">
                <input
                  type="date"
                  value={editing.date}
                  onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                />
              </Field>
              <Field label="金額(円)">
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={editing.amountYen}
                  onChange={(e) => setEditing({ ...editing, amountYen: Number(e.target.value) })}
                />
              </Field>
            </FieldRow>
            <Field label="内容" wide>
              <input
                type="text"
                value={editing.label}
                placeholder="例) 自宅 - 大学（往復）"
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
              />
            </Field>
            <FieldRow>
              <Field label="用途">
                <select
                  value={editing.category}
                  onChange={(e) =>
                    setEditing({ ...editing, category: e.target.value as ExpenseCategory })
                  }
                >
                  {CATEGORIES.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="種類">
                <select
                  value={editing.kind}
                  onChange={(e) => setEditing({ ...editing, kind: e.target.value as ExpenseKind })}
                >
                  {KINDS.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </FieldRow>
            {data.trips.length > 0 ? (
              <Field label="旅行に紐づける">
                <select
                  value={editing.tripId ?? ''}
                  onChange={(e) => setEditing({ ...editing, tripId: e.target.value || undefined })}
                >
                  <option value="">なし</option>
                  {data.trips.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <div className="switch-row">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={editing.reimbursed}
                  onChange={(e) => setEditing({ ...editing, reimbursed: e.target.checked })}
                />
                <span>支給・精算される（自己負担から除く）</span>
              </label>
            </div>
          </>
        ) : null}
      </Sheet>
    </div>
  )
}
