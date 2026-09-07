import { useState } from 'react'
import { newId } from '../lib/id'
import { draftsFor, type TaskDraft } from '../lib/jobhunt'
import { Field } from './ui'
import {
  RATING_LABELS,
  SELECTION_KIND_LABELS,
  STAGE_LABELS,
  type Company,
  type CompanyFacts,
  type CompanyRatings,
  type SelectionEvent,
  type SelectionKind,
  type SelectionStage,
} from '../types'

export function blankCompany(): Company {
  const now = new Date().toISOString()
  return {
    id: newId('co'),
    name: '',
    stage: 'none',
    interest: 3,
    facts: {},
    ratings: {},
    createdAt: now,
    updatedAt: now,
  }
}

export function blankSelection(companyId: string): SelectionEvent {
  return {
    id: newId('sel'),
    companyId,
    kind: 'es',
    title: '',
    date: '',
    createdAt: new Date().toISOString(),
  }
}

/** 数値の欄。空文字と 0 を区別する（未記入を 0 にしない） */
function NumberField({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string
  value: number | undefined
  suffix?: string
  onChange: (v: number | undefined) => void
}) {
  return (
    <label className="field">
      <span>
        {label}
        {suffix ? `（${suffix}）` : ''}
      </span>
      <input
        type="number"
        min={0}
        value={value ?? ''}
        placeholder="未記入"
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </label>
  )
}

interface CompanyFormProps {
  initial: Company
  onSave: (company: Company) => void
  onCancel: () => void
  onDelete?: (id: string) => void
}

export default function CompanyForm({ initial, onSave, onCancel, onDelete }: CompanyFormProps) {
  const [c, setC] = useState<Company>(initial)
  const isNew = initial.name === ''

  const patch = (p: Partial<Company>) => setC((x) => ({ ...x, ...p }))
  const patchFacts = (p: Partial<CompanyFacts>) => setC((x) => ({ ...x, facts: { ...x.facts, ...p } }))
  const patchRatings = (p: Partial<CompanyRatings>) =>
    setC((x) => ({ ...x, ratings: { ...x.ratings, ...p } }))

  return (
    <>
      <div className="row">
        <strong className="grow">{isNew ? '企業を追加' : c.name}</strong>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          閉じる
        </button>
      </div>

      <Field label="企業名">
        <input value={c.name} onChange={(e) => patch({ name: e.target.value })} />
      </Field>

      <div className="grid2">
        <Field label="業界">
          <input
            value={c.industry ?? ''}
            placeholder="IT / メーカー など"
            onChange={(e) => patch({ industry: e.target.value || undefined })}
          />
        </Field>
        <Field label="職種">
          <input
            value={c.role ?? ''}
            placeholder="エンジニア など"
            onChange={(e) => patch({ role: e.target.value || undefined })}
          />
        </Field>
      </div>

      <div className="grid2">
        <Field label="選考段階">
          <select
            value={c.stage}
            onChange={(e) => patch({ stage: e.target.value as SelectionStage })}
          >
            {Object.entries(STAGE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`志望度 ${c.interest}`}>
          <input
            type="range"
            min={1}
            max={5}
            value={c.interest}
            onChange={(e) => patch({ interest: Number(e.target.value) })}
          />
        </Field>
      </div>

      <Field label="URL">
        <input
          value={c.url ?? ''}
          placeholder="https://"
          onChange={(e) => patch({ url: e.target.value || undefined })}
        />
      </Field>

      {/* --- 事実 --- */}
      <div className="split">
        <div className="split-head">調べた事実</div>
        <p className="hint">
          調べれば同じ答えになるものだけ。出どころも残しておくと、あとで見返したときに困りません。
        </p>
        <div className="grid2">
          <NumberField
            label="年収"
            suffix="万円"
            value={c.facts.salaryManYen}
            onChange={(v) => patchFacts({ salaryManYen: v })}
          />
          <NumberField
            label="年間休日"
            suffix="日"
            value={c.facts.holidaysPerYear}
            onChange={(v) => patchFacts({ holidaysPerYear: v })}
          />
        </div>
        <div className="grid2">
          <NumberField
            label="平均残業"
            suffix="時間/月"
            value={c.facts.overtimeHoursPerMonth}
            onChange={(v) => patchFacts({ overtimeHoursPerMonth: v })}
          />
          <NumberField
            label="離職率"
            suffix="%"
            value={c.facts.turnoverRate}
            onChange={(v) => patchFacts({ turnoverRate: v })}
          />
        </div>
        <Field label="勤務地">
          <input
            value={c.facts.location ?? ''}
            onChange={(e) => patchFacts({ location: e.target.value || undefined })}
          />
        </Field>
        <Field label="福利厚生（書き写す）">
          <textarea
            rows={2}
            value={c.facts.benefits ?? ''}
            onChange={(e) => patchFacts({ benefits: e.target.value || undefined })}
          />
        </Field>
        <Field label="どこで調べたか">
          <input
            value={c.facts.source ?? ''}
            placeholder="採用サイト / 説明会 / 四季報 など"
            onChange={(e) => patchFacts({ source: e.target.value || undefined })}
          />
        </Field>
      </div>

      {/* --- 評価 --- */}
      <div className="split rating">
        <div className="split-head">自分の見立て</div>
        <p className="hint">
          これは事実ではなく、あなたの評価です。上の事実と混ぜないために別にしてあります。
          理由はメモに書いておくと、迷ったときに戻れます。
        </p>
        {(Object.keys(RATING_LABELS) as Array<keyof CompanyRatings>).map((k) => (
          <label key={k} className="field">
            <span>
              {RATING_LABELS[k]} {c.ratings[k] ? `${c.ratings[k]}／5` : '未評価'}
            </span>
            <div className="row tight">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`chip${c.ratings[k] === n ? ' is-on' : ''}`}
                  onClick={() => patchRatings({ [k]: c.ratings[k] === n ? undefined : n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </label>
        ))}
      </div>

      <Field label="メモ">
        <textarea rows={3} value={c.memo ?? ''} onChange={(e) => patch({ memo: e.target.value })} />
      </Field>

      <div className="row">
        <button
          type="button"
          className="btn primary grow"
          disabled={c.name.trim().length === 0}
          onClick={() =>
            onSave({ ...c, name: c.name.trim(), updatedAt: new Date().toISOString() })
          }
        >
          保存
        </button>
        {onDelete && !isNew && (
          <button type="button" className="btn ghost" onClick={() => onDelete(c.id)}>
            削除
          </button>
        )}
      </div>
    </>
  )
}

interface SelectionFormProps {
  initial: SelectionEvent
  companyName: string
  onSave: (event: SelectionEvent, drafts: TaskDraft[]) => void
  onCancel: () => void
  onDelete?: (id: string) => void
}

export function SelectionForm({
  initial,
  companyName,
  onSave,
  onCancel,
  onDelete,
}: SelectionFormProps) {
  const [e, setE] = useState<SelectionEvent>(initial)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const isNew = initial.date === ''
  const patch = (p: Partial<SelectionEvent>) => setE((x) => ({ ...x, ...p }))

  const drafts = draftsFor(e.kind, e.date || undefined)
  const toggle = (title: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })

  return (
    <>
      <div className="row">
        <strong className="grow">{companyName} の予定</strong>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          閉じる
        </button>
      </div>

      <div className="grid2">
        <Field label="種類">
          <select value={e.kind} onChange={(ev) => patch({ kind: ev.target.value as SelectionKind })}>
            {Object.entries(SELECTION_KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="日付">
          <input type="date" value={e.date} onChange={(ev) => patch({ date: ev.target.value })} />
        </Field>
      </div>

      <div className="grid2">
        <Field label={e.kind === 'es' ? '締切の時刻' : '開始時刻'}>
          <input
            type="time"
            value={e.time ?? ''}
            onChange={(ev) => patch({ time: ev.target.value || undefined })}
          />
        </Field>
        <Field label="場所">
          <input
            value={e.place ?? ''}
            placeholder="オンライン / 本社 など"
            onChange={(ev) => patch({ place: ev.target.value || undefined })}
          />
        </Field>
      </div>

      <Field label="メモ">
        <textarea
          rows={2}
          value={e.note ?? ''}
          onChange={(ev) => patch({ note: ev.target.value || undefined })}
        />
      </Field>

      {/* 勝手に登録せず、要るものだけ選んでもらう */}
      {isNew && drafts.length > 0 && e.date && (
        <div className="split">
          <div className="split-head">一緒に作るタスク（選んだものだけ）</div>
          <p className="hint">
            この日付から逆算した日程が入ります。全部が毎回必要なわけではないので、要るものだけ選んでください。
          </p>
          {drafts.map((d) => (
            <label key={d.title} className="row tight">
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={picked.has(d.title)}
                onChange={() => toggle(d.title)}
              />
              <span>
                {d.title}
                <span className="dim">
                  {' '}
                  {d.estimateMin}分{d.dueDate ? ` / ${d.dueDate}` : ''}
                </span>
              </span>
            </label>
          ))}
          <button
            type="button"
            className="btn sm"
            onClick={() =>
              setPicked(picked.size === drafts.length ? new Set() : new Set(drafts.map((d) => d.title)))
            }
          >
            {picked.size === drafts.length ? 'すべて外す' : 'すべて選ぶ'}
          </button>
        </div>
      )}

      <div className="row">
        <button
          type="button"
          className="btn primary grow"
          disabled={!e.date}
          onClick={() =>
            onSave(
              { ...e, title: e.title || SELECTION_KIND_LABELS[e.kind] },
              drafts.filter((d) => picked.has(d.title)),
            )
          }
        >
          保存
          {picked.size > 0 ? `（タスク${picked.size}件も作る）` : ''}
        </button>
        {onDelete && !isNew && (
          <button type="button" className="btn ghost" onClick={() => onDelete(e.id)}>
            削除
          </button>
        )}
      </div>
    </>
  )
}
