import { useMemo, useState } from 'react'
import CompanyForm, { blankCompany, blankSelection, SelectionForm } from '../components/JobForms'
import { Banner, Empty, Sheet, Stat } from '../components/ui'
import { formatDate, todayKey } from '../lib/date'
import {
  activeCompanies,
  buildComparison,
  groupByUrgency,
  nextActionFor,
  sortComparison,
  taskFromDraft,
  upcomingSelections,
  URGENCY_LABELS,
  URGENCY_ORDER,
  SORT_LABELS,
  type SortKey,
  type TaskDraft,
} from '../lib/jobhunt'
import { useApp } from '../state/AppContext'
import {
  CLOSED_STAGES,
  RATING_LABELS,
  SELECTION_KIND_LABELS,
  STAGE_LABELS,
  type Company,
  type CompanyRatings,
  type SelectionEvent,
} from '../types'

const URGENCY_MARKS: Record<string, string> = {
  overdue: '⚠️',
  today: '🔴',
  tomorrow: '🟠',
  soon: '🟡',
  later: '⚪️',
}

export default function JobPage() {
  const { data, upsert, remove, replaceList } = useApp()
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [editingSelection, setEditingSelection] = useState<SelectionEvent | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('interest')
  const [showClosed, setShowClosed] = useState(false)
  const [message, setMessage] = useState('')
  const today = todayKey()

  const { companies, selections } = data

  const dated = useMemo(
    () => upcomingSelections(selections, companies, today),
    [selections, companies, today],
  )
  const byUrgency = useMemo(() => groupByUrgency(dated), [dated])

  const visible = showClosed ? companies : activeCompanies(companies)
  const rows = useMemo(
    () => sortComparison(buildComparison(visible), sortKey),
    [visible, sortKey],
  )

  const active = activeCompanies(companies)
  const offers = companies.filter((c) => c.stage === 'offer').length

  const saveSelection = (event: SelectionEvent, drafts: TaskDraft[]) => {
    upsert('selections', event)
    const company = companies.find((c) => c.id === event.companyId)
    if (company && drafts.length > 0) {
      const now = new Date().toISOString()
      // 一度に複数入れるので、まとめて置き換える (1件ずつだと取りこぼす)
      replaceList('tasks', [...data.tasks, ...drafts.map((d) => taskFromDraft(d, company, now))])
      setMessage(`${drafts.length}件のタスクを作りました`)
    }
    setEditingSelection(null)
  }

  const companyOf = (id: string) => companies.find((c) => c.id === id)

  return (
    <div className="page">
      <div className="row">
        <strong className="grow">就活</strong>
        <span className="dim">選考中 {active.length}社</span>
      </div>

      {message && <Banner>{message}</Banner>}

      {companies.length > 0 && (
        <div className="stats">
          <Stat k="登録" v={`${companies.length}社`} />
          <Stat k="選考中" v={`${active.length}社`} />
          <Stat k="内定" v={`${offers}`} />
        </div>
      )}

      {/* --- 締切 --- */}
      <section className="bucket">
        <h2 className="section">締切</h2>
        {dated.length === 0 ? (
          <Empty>予定がありません。企業を開いて「＋ 予定」から入れてください。</Empty>
        ) : (
          URGENCY_ORDER.map((u) => {
            const list = byUrgency[u]
            if (list.length === 0) return null
            return (
              <div key={u} className="bucket">
                <div className="bucket-head">
                  <span>
                    {URGENCY_MARKS[u]} {URGENCY_LABELS[u]}
                  </span>
                  <span className="count">{list.length}件</span>
                </div>
                {list.map((d) => (
                  <button
                    key={d.event.id}
                    type="button"
                    className={`task ${u === 'overdue' ? 'b-overdue' : u === 'today' ? 'b-urgent' : u === 'tomorrow' ? 'b-important' : 'b-optional'}`}
                    style={{ textAlign: 'left', cursor: 'pointer' }}
                    onClick={() => setEditingSelection(d.event)}
                  >
                    <span className="task-title">
                      {d.company?.name ?? '企業未設定'} {SELECTION_KIND_LABELS[d.event.kind]}
                    </span>
                    <span className="task-meta">
                      <span>{formatDate(d.event.date)}</span>
                      {d.event.time && <span>{d.event.time}</span>}
                      {d.event.place && <span className="tag">{d.event.place}</span>}
                      <span>
                        {d.daysLeft < 0 ? `${-d.daysLeft}日前に過ぎている` : `あと${d.daysLeft}日`}
                      </span>
                    </span>
                    {d.event.note && <span className="dim">{d.event.note}</span>}
                  </button>
                ))}
              </div>
            )
          })
        )}
      </section>

      {/* --- 企業 --- */}
      <section className="bucket">
        <div className="row">
          <h2 className="section grow">企業</h2>
          <button type="button" className="btn sm" onClick={() => setEditingCompany(blankCompany())}>
            ＋ 追加
          </button>
        </div>

        {companies.length === 0 ? (
          <Empty>企業がありません。「＋ 追加」から入れてください。</Empty>
        ) : (
          <>
            <label className="row tight">
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
              />
              <span className="dim">終わった選考も見る</span>
            </label>

            {visible.map((c) => {
              const next = nextActionFor(c)
              const events = selections.filter((e) => e.companyId === c.id && !e.doneAt).length
              return (
                <div
                  key={c.id}
                  className={`task ${CLOSED_STAGES.includes(c.stage) ? 'is-done' : 'b-important'}`}
                >
                  <button
                    type="button"
                    className="task-title"
                    style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }}
                    onClick={() => setEditingCompany(c)}
                  >
                    {c.name}
                  </button>
                  <span className="task-meta">
                    <span className="tag">{STAGE_LABELS[c.stage]}</span>
                    <span>志望度 {'★'.repeat(c.interest)}</span>
                    {c.industry && <span>{c.industry}</span>}
                    {events > 0 && <span>予定 {events}件</span>}
                  </span>
                  {next && <span className="reason">次にやること: {next}</span>}
                  <div className="row tight">
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => setEditingSelection(blankSelection(c.id))}
                    >
                      ＋ 予定
                    </button>
                    {c.url && (
                      <a
                        className="btn ghost sm"
                        href={c.url}
                        target="_blank"
                        rel="noopener"
                        style={{ textDecoration: 'none' }}
                      >
                        サイト
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </section>

      {/* --- 比較 --- */}
      {visible.length >= 2 && (
        <section className="bucket">
          <h2 className="section">比べる</h2>
          <Banner>
            <strong>事実と見立ては分けてあります。</strong>
            「年間休日125日」は調べれば同じ答えになる事実、「ワークライフ ★4」はあなたの評価です。
            両方を混ぜた総合点は出しません。混ぜると、どちらが効いたのか説明できなくなるためです。
          </Banner>

          <label className="field">
            <span>並べ替え</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
              {Object.entries(SORT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <div className="tablewrap">
            <table className="compare">
              <thead>
                <tr>
                  <th>企業</th>
                  <th className="fact">年収</th>
                  <th className="fact">休日</th>
                  <th className="fact">残業</th>
                  <th className="fact">離職率</th>
                  <th className="rate">見立て</th>
                  <th className="rate">志望度</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.company.id}>
                    <td>{r.company.name}</td>
                    <td className="fact">{r.facts.salaryManYen ?? '—'}</td>
                    <td className="fact">{r.facts.holidaysPerYear ?? '—'}</td>
                    <td className="fact">{r.facts.overtimeHoursPerMonth ?? '—'}</td>
                    <td className="fact">{r.facts.turnoverRate ?? '—'}</td>
                    <td className="rate">
                      {r.ratingAverage != null ? r.ratingAverage.toFixed(1) : '—'}
                    </td>
                    <td className="rate">{r.interest}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            左の4列（青）は調べた事実、右の2列（黄）はあなたの見立てです。「—」は未記入で、0 ではありません。
          </p>

          {/* 見立ての内訳。平均だけだと何が効いたか分からない */}
          <details>
            <summary className="dim" style={{ cursor: 'pointer' }}>
              見立ての内訳を見る
            </summary>
            <div className="tablewrap" style={{ marginTop: 8 }}>
              <table className="compare">
                <thead>
                  <tr>
                    <th>企業</th>
                    {(Object.keys(RATING_LABELS) as Array<keyof CompanyRatings>).map((k) => (
                      <th key={k} className="rate">
                        {RATING_LABELS[k]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.company.id}>
                      <td>{r.company.name}</td>
                      {(Object.keys(RATING_LABELS) as Array<keyof CompanyRatings>).map((k) => (
                        <td key={k} className="rate">
                          {r.company.ratings[k] ?? '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      {editingCompany && (
        <Sheet onClose={() => setEditingCompany(null)}>
          <CompanyForm
            initial={editingCompany}
            onSave={(c) => {
              upsert('companies', c)
              setEditingCompany(null)
            }}
            onCancel={() => setEditingCompany(null)}
            onDelete={(id) => {
              // 企業を消したら、その企業の予定も残さない (どこにも紐づかない予定になるため)
              replaceList(
                'selections',
                selections.filter((e) => e.companyId !== id),
              )
              remove('companies', id)
              setEditingCompany(null)
              setMessage('企業とその予定を削除しました。作ったタスクは残っています。')
            }}
          />
        </Sheet>
      )}

      {editingSelection && (
        <Sheet onClose={() => setEditingSelection(null)}>
          <SelectionForm
            initial={editingSelection}
            companyName={companyOf(editingSelection.companyId)?.name ?? '企業未設定'}
            onSave={saveSelection}
            onCancel={() => setEditingSelection(null)}
            onDelete={(id) => {
              remove('selections', id)
              setEditingSelection(null)
            }}
          />
        </Sheet>
      )}
    </div>
  )
}
