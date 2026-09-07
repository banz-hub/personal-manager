import { useMemo, useState } from 'react'
import TaskForm, { blankTask } from '../components/TaskForm'
import { Empty, Sheet } from '../components/ui'
import { formatDuration, todayKey } from '../lib/date'
import { useApp } from '../state/AppContext'
import { AREA_LABELS, STATUS_LABELS, type Task, type TaskArea } from '../types'

type Filter = 'open' | 'done' | 'all'

const FILTERS: Array<[Filter, string]> = [
  ['open', '未完了'],
  ['done', '完了'],
  ['all', 'すべて'],
]

export default function TasksPage() {
  const { data, upsert, replaceList } = useApp()
  const [filter, setFilter] = useState<Filter>('open')
  const [area, setArea] = useState<TaskArea | 'all'>('all')
  const [editing, setEditing] = useState<Task | null>(null)
  const today = todayKey()

  const list = useMemo(() => {
    return data.tasks
      .filter((t) => {
        if (filter === 'open') return t.status === 'todo' || t.status === 'doing'
        if (filter === 'done') return t.status === 'done' || t.status === 'dropped'
        return true
      })
      .filter((t) => area === 'all' || t.area === area)
      .sort((a, b) => {
        // 締切のあるものを先に、近い順。締切なしは最後に作成順
        const ad = a.dueDate ?? '9999-99-99'
        const bd = b.dueDate ?? '9999-99-99'
        if (ad !== bd) return ad.localeCompare(bd)
        return a.createdAt.localeCompare(b.createdAt)
      })
  }, [data.tasks, filter, area])

  const openCount = data.tasks.filter((t) => t.status === 'todo' || t.status === 'doing').length

  return (
    <div className="page">
      <div className="row">
        <strong className="grow">タスク</strong>
        <span className="dim">未完了 {openCount} 件</span>
      </div>

      <div className="row tight">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`btn sm${filter === key ? ' primary' : ' ghost'}`}
            onClick={() => setFilter(key)}
          >
            {label}
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

      <button type="button" className="btn primary" onClick={() => setEditing(blankTask())}>
        ＋ タスクを追加
      </button>

      {list.length === 0 ? (
        <Empty>該当するタスクがありません</Empty>
      ) : (
        <div className="bucket">
          {list.map((t) => {
            const done = t.status === 'done' || t.status === 'dropped'
            const overdue = !done && t.dueDate != null && t.dueDate < today
            return (
              <button
                key={t.id}
                type="button"
                className={`task${done ? ' is-done' : ''}${overdue ? ' b-overdue' : ''}`}
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => setEditing(t)}
              >
                <span className={`task-title${done ? ' done' : ''}`}>{t.title}</span>
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
                  {(t.deferCount ?? 0) > 0 && <span>先送り {t.deferCount}回</span>}
                </span>
                {t.note && <span className="dim">{t.note}</span>}
              </button>
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
            onDelete={(id) => {
              replaceList(
                'tasks',
                data.tasks.filter((x) => x.id !== id),
              )
              setEditing(null)
            }}
          />
        </Sheet>
      )}
    </div>
  )
}
