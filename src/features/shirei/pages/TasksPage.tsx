import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import DecomposeSheet from '../components/DecomposeSheet'
import TaskForm, { blankTask } from '../components/TaskForm'
import { Banner, Empty, Sheet } from '../components/ui'
import { addDays, formatDuration, todayKey } from '../lib/date'
import { childProgress } from '../lib/decompose'
import { repeatLabel } from '../lib/repeat'
import { useApp } from '../state/AppContext'
import { AREA_LABELS, STATUS_LABELS, type Task, type TaskArea } from '../types'

type Filter = 'open' | 'overdue' | 'done' | 'all'

const FILTERS: Array<[Filter, string]> = [
  ['open', '未完了'],
  ['overdue', '期限切れ'],
  ['done', '完了'],
  ['all', 'すべて'],
]

export default function TasksPage() {
  const { data, upsert, replaceList } = useApp()
  const [params, setParams] = useSearchParams()
  const filter = (params.get('filter') as Filter) ?? 'open'
  const [area, setArea] = useState<TaskArea | 'all'>('all')
  const [editing, setEditing] = useState<Task | null>(null)
  const [decomposing, setDecomposing] = useState<Task | null>(null)
  const [message, setMessage] = useState('')
  const today = todayKey()

  const setFilter = (f: Filter) => setParams(f === 'open' ? {} : { filter: f })

  const isOpen = (t: Task) => t.status === 'todo' || t.status === 'doing'
  const isOverdue = (t: Task) => isOpen(t) && t.dueDate != null && t.dueDate < today

  const list = useMemo(() => {
    return data.tasks
      .filter((t) => {
        if (filter === 'open') return isOpen(t)
        if (filter === 'overdue') return isOverdue(t)
        if (filter === 'done') return !isOpen(t)
        return true
      })
      .filter((t) => area === 'all' || t.area === area)
      .sort((a, b) => {
        const ad = a.dueDate ?? '9999-99-99'
        const bd = b.dueDate ?? '9999-99-99'
        if (ad !== bd) return ad.localeCompare(bd)
        return a.createdAt.localeCompare(b.createdAt)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tasks, filter, area, today])

  const openCount = data.tasks.filter(isOpen).length
  const overdueCount = data.tasks.filter(isOverdue).length

  // --- 期限切れの棚卸し。1件ずつ「やる・締切を直す・やめる」を決める ---
  const triage = (task: Task, action: 'today' | 'week' | 'drop') => {
    if (action === 'drop') {
      upsert('tasks', { ...task, status: 'dropped', doneAt: new Date().toISOString() })
      setMessage(`「${task.title}」をやめました。記録は残ります。`)
      return
    }
    const dueDate = action === 'today' ? today : addDays(today, 7)
    upsert('tasks', { ...task, dueDate, deferCount: undefined, deferredOn: undefined })
    setMessage(`「${task.title}」の締切を ${dueDate} に直しました。`)
  }

  const applyDecompose = (children: Task[], parent: Task) => {
    // まとめて入れるので、1件ずつではなく一度に置き換える
    replaceList('tasks', [...data.tasks.map((t) => (t.id === parent.id ? parent : t)), ...children])
    setDecomposing(null)
    setEditing(null)
    setMessage(`${children.length}件の手順に分けました。`)
  }

  return (
    <div className="page">
      <div className="row">
        <strong className="grow">タスク</strong>
        <span className="dim">未完了 {openCount} 件</span>
      </div>

      {message && <Banner>{message}</Banner>}

      {overdueCount > 0 && filter !== 'overdue' && (
        <Banner alert>
          期限切れが{overdueCount}件あります。放っておくと優先順位が歪んだままになります。
          <div className="row tight" style={{ marginTop: 8 }}>
            <button type="button" className="btn sm" onClick={() => setFilter('overdue')}>
              片づける
            </button>
          </div>
        </Banner>
      )}

      <div className="row tight">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`btn sm${filter === key ? ' primary' : ' ghost'}`}
            onClick={() => setFilter(key)}
          >
            {label}
            {key === 'overdue' && overdueCount > 0 ? ` ${overdueCount}` : ''}
          </button>
        ))}
        <select
          style={{ width: 'auto' }}
          value={area}
          onChange={(e) => setArea(e.target.value as TaskArea | 'all')}
        >
          <option value="all">分野すべて</option>
          {Object.entries(AREA_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {filter === 'overdue' && list.length > 0 && (
        <p className="hint">
          1件ずつ決めてください。「今日にする」「来週にする」で締切を引き直し、
          もうやらないものは「やめる」で外します。締切を直すと先送りの回数もリセットします。
        </p>
      )}

      <button type="button" className="btn primary" onClick={() => setEditing(blankTask())}>
        ＋ タスクを追加
      </button>

      {list.length === 0 ? (
        <Empty>
          {filter === 'overdue' ? '期限切れはありません' : '該当するタスクがありません'}
        </Empty>
      ) : (
        <div className="bucket">
          {list.map((t) => {
            const done = !isOpen(t)
            const overdue = isOverdue(t)
            const progress = childProgress(t, data.tasks)
            return (
              <div key={t.id} className={`task${done ? ' is-done' : ''}${overdue ? ' b-overdue' : ''}`}>
                <button
                  type="button"
                  className={`task-title${done ? ' done' : ''}`}
                  style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => setEditing(t)}
                >
                  {t.title}
                </button>
                <span className="task-meta">
                  <span className="tag">{AREA_LABELS[t.area]}</span>
                  <span className="tag">{STATUS_LABELS[t.status]}</span>
                  <span>{formatDuration(t.estimateMin)}</span>
                  {t.dueDate && (
                    <span>
                      締切 {t.dueDate === today ? '今日' : t.dueDate}
                      {t.dueTime ? ` ${t.dueTime}` : ''}
                    </span>
                  )}
                  {t.recurring && <span className="tag">継続</span>}
                  {t.repeat && <span className="tag">{repeatLabel(t.repeat)}</span>}
                  {progress.total > 0 && (
                    <span>
                      手順 {progress.done}/{progress.total}
                    </span>
                  )}
                  {(t.deferCount ?? 0) > 0 && <span>先送り {t.deferCount}回</span>}
                </span>
                {t.note && <span className="dim">{t.note}</span>}

                {overdue && (
                  <div className="row tight">
                    <button type="button" className="btn sm" onClick={() => triage(t, 'today')}>
                      今日にする
                    </button>
                    <button type="button" className="btn sm" onClick={() => triage(t, 'week')}>
                      来週にする
                    </button>
                    <button type="button" className="btn ghost sm" onClick={() => triage(t, 'drop')}>
                      やめる
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <TaskForm
            initial={editing}
            onSave={(t) => {
              upsert('tasks', t)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
            onDecompose={(t) => setDecomposing(t)}
            onDelete={(id) => {
              // 手順に分けたタスクを消すときは、子も一緒に消す
              replaceList(
                'tasks',
                data.tasks.filter((x) => x.id !== id && x.parentId !== id),
              )
              setEditing(null)
            }}
          />
        </Sheet>
      )}

      {decomposing && (
        <DecomposeSheet
          task={decomposing}
          onApply={applyDecompose}
          onClose={() => setDecomposing(null)}
        />
      )}
    </div>
  )
}
