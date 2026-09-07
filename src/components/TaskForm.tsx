import { useMemo, useState } from 'react'
import { todayKey } from '../lib/date'
import { newId } from '../lib/id'
import { parseTaskInput } from '../lib/parse'
import { Field } from './ui'
import type { Importance, Task, TaskArea } from '../types'
import { AREA_LABELS, IMPORTANCE_LABELS } from '../types'

export function blankTask(): Task {
  return {
    id: newId('task'),
    title: '',
    area: 'other',
    status: 'todo',
    estimateMin: 30,
    importance: 2,
    createdAt: new Date().toISOString(),
  }
}

interface Props {
  initial: Task
  onSave: (task: Task) => void
  onCancel: () => void
  onDelete?: (id: string) => void
}

/**
 * タスクの入力。
 * まず一文で書いてもらい、読み取れたものを埋めた状態で細かい欄を出す。
 * 読み取れなかった項目は「確認してください」と明示する (黙って推測で埋めない)。
 */
export default function TaskForm({ initial, onSave, onCancel, onDelete }: Props) {
  const isNew = initial.title === ''
  const [raw, setRaw] = useState('')
  const [task, setTask] = useState<Task>(initial)
  const [unknown, setUnknown] = useState<string[]>([])
  const [detected, setDetected] = useState<string[]>([])

  const patch = (p: Partial<Task>) => setTask((t) => ({ ...t, ...p }))

  const canSave = task.title.trim().length > 0 && task.estimateMin > 0

  const applyParse = () => {
    const text = raw.trim()
    if (!text) return
    const p = parseTaskInput(text, todayKey())
    patch({
      title: p.title,
      area: p.area,
      dueDate: p.dueDate,
      dueTime: p.dueTime,
      estimateMin: p.estimateMin ?? task.estimateMin,
      importance: p.importance,
      recurring: p.recurring,
      chunkMin: p.chunkMin,
    })
    setDetected(p.detected)
    setUnknown(p.unknown)
  }

  const chunkPlaceholder = useMemo(
    () => (task.recurring ? '1回にやる長さ' : '分割するときだけ'),
    [task.recurring],
  )

  return (
    <>
      <div className="row">
        <strong className="grow">{isNew ? 'タスクを追加' : 'タスクを編集'}</strong>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          閉じる
        </button>
      </div>

      {isNew && (
        <div className="field">
          <span>一文で書く</span>
          <div className="row tight">
            <input
              className="grow"
              value={raw}
              placeholder="金曜までに線形代数のレポート 90分"
              onChange={(e) => setRaw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyParse()
                }
              }}
            />
            <button type="button" className="btn sm" onClick={applyParse}>
              読み取る
            </button>
          </div>
          {detected.length > 0 && (
            <p className="hint">
              自動で入れた項目: {detected.join('、')}
              {unknown.length > 0 && ` ／ 分からなかったので確認してください: ${unknown.join('、')}`}
            </p>
          )}
        </div>
      )}

      <Field label="やること">
        <input value={task.title} onChange={(e) => patch({ title: e.target.value })} />
      </Field>

      <div className="grid2">
        <Field label="分野">
          <select value={task.area} onChange={(e) => patch({ area: e.target.value as TaskArea })}>
            {Object.entries(AREA_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="重要度">
          <select
            value={task.importance}
            onChange={(e) => patch({ importance: Number(e.target.value) as Importance })}
          >
            {([3, 2, 1] as Importance[]).map((i) => (
              <option key={i} value={i}>
                {IMPORTANCE_LABELS[i]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid2">
        <Field label="締切の日">
          <input
            type="date"
            value={task.dueDate ?? ''}
            onChange={(e) => patch({ dueDate: e.target.value || undefined })}
          />
        </Field>
        <Field label="締切の時刻">
          <input
            type="time"
            value={task.dueTime ?? ''}
            disabled={!task.dueDate}
            onChange={(e) => patch({ dueTime: e.target.value || undefined })}
          />
        </Field>
      </div>
      {task.dueDate && !task.dueTime && (
        <p className="hint">時刻を空にすると、その日いっぱい (23:59) が締切として扱われます。</p>
      )}

      <div className="grid2">
        <Field label={task.recurring ? '全体の目安(分)' : '残りの見積もり(分)'}>
          <input
            type="number"
            min={5}
            step={5}
            value={task.estimateMin}
            onChange={(e) => patch({ estimateMin: Number(e.target.value) })}
          />
        </Field>
        <Field label={`1回の長さ(分)`}>
          <input
            type="number"
            min={5}
            step={5}
            placeholder={chunkPlaceholder}
            value={task.chunkMin ?? ''}
            onChange={(e) => patch({ chunkMin: e.target.value ? Number(e.target.value) : undefined })}
          />
        </Field>
      </div>

      <label className="row tight">
        <input
          type="checkbox"
          style={{ width: 'auto' }}
          checked={Boolean(task.recurring)}
          onChange={(e) => patch({ recurring: e.target.checked || undefined })}
        />
        <span>毎日すこしずつ続けるタスク（英語・資格の勉強など）</span>
      </label>
      {task.recurring && (
        <p className="hint">
          続けるタスクは「1回の長さ」ぶんだけ今日の予定に入り、残りの見積もりは減りません。
          しばらくやっていないと自動で優先順位が上がります。
        </p>
      )}

      <Field label="メモ">
        <textarea rows={2} value={task.note ?? ''} onChange={(e) => patch({ note: e.target.value })} />
      </Field>

      <div className="row">
        <button
          type="button"
          className="btn primary grow"
          disabled={!canSave}
          onClick={() => onSave({ ...task, title: task.title.trim() })}
        >
          保存
        </button>
        {onDelete && !isNew && (
          <button type="button" className="btn ghost" onClick={() => onDelete(task.id)}>
            削除
          </button>
        )}
      </div>
    </>
  )
}
