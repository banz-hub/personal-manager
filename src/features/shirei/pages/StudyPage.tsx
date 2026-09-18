/**
 * 学習。**学習はタスクとして持ち、時間はタイマーで記録する。**
 *
 * ここは「何を勉強しているか」の一覧と、それぞれの累計時間だけ。
 * 習熟度・優先度・試験からの逆算は持たない。その日にやるものは、
 * この一覧から自分で今日のリストに入れる（1 ページ目の「リストから選ぶ」からも入れられる）。
 */

import { useMemo, useState } from 'react'
import { Banner, Empty, Field, Sheet } from '../components/ui'
import { formatDuration, todayKey } from '../lib/date'
import { isOpen } from '../lib/daylist'
import { newStudyTask, nodesToTasks, removableNodes, studyTotals } from '../lib/studylist'
import { useApp } from '../state/AppContext'
import { AREA_LABELS, type Task, type TaskArea } from '../types'

const AREAS = Object.entries(AREA_LABELS) as Array<[TaskArea, string]>

export default function StudyPage() {
  const { data, upsert, remove, replaceList } = useApp()
  const today = todayKey()
  const [title, setTitle] = useState('')
  const [area, setArea] = useState<TaskArea>('math')
  const [editing, setEditing] = useState<Task | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [message, setMessage] = useState('')

  const studies = useMemo(() => data.tasks.filter((t) => t.study), [data.tasks])
  const open = studies.filter(isOpen)
  const finished = studies.filter((t) => !isOpen(t))
  const totals = useMemo(() => studyTotals(data.tasks, data.logs), [data.tasks, data.logs])

  // 分野ごとにまとめる。並びは AREA_LABELS の順
  const groups = AREAS.map(([key, label]) => ({
    key,
    label,
    items: open.filter((t) => t.area === key),
  })).filter((g) => g.items.length > 0)

  const add = () => {
    if (!title.trim()) return
    upsert('tasks', newStudyTask(title, area, new Date().toISOString()))
    setTitle('')
  }

  const toggleToday = (t: Task) =>
    upsert('tasks', { ...t, pinnedDate: t.pinnedDate === today ? undefined : today })

  // 前の版の学習項目を、学習のタスクへ移す。押したときだけ動く
  const migrate = () => {
    const created = nodesToTasks(data.nodes, new Date().toISOString())
    const removable = new Set(removableNodes(data.nodes, data.sessions).map((n) => n.id))
    replaceList('tasks', [...data.tasks, ...created])
    replaceList(
      'nodes',
      data.nodes.filter((n) => !removable.has(n.id)),
    )
    setMessage(`${created.length}件を学習のタスクに移しました`)
  }

  return (
    <div className="page">
      <div className="row">
        <strong className="grow">学習</strong>
        <span className="dim">{open.length}件</span>
      </div>

      {message && <Banner>{message}</Banner>}

      {data.nodes.length > 0 && (
        <Banner>
          前の形の学習項目が{data.nodes.length}件あります（習熟度つきのもの）。
          学習のタスクに移すと、ここに並び、今日のリストに入れられるようになります。
          <div className="row tight" style={{ marginTop: 8 }}>
            <button type="button" className="btn sm primary" onClick={migrate}>
              学習のタスクに移す
            </button>
          </div>
        </Banner>
      )}

      <form
        className="study-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          value={title}
          placeholder="例: 基本情報技術者、複素解析学B"
          aria-label="学習すること"
          onChange={(e) => setTitle(e.target.value)}
        />
        <select value={area} aria-label="分野" onChange={(e) => setArea(e.target.value as TaskArea)}>
          {AREAS.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button type="submit" className="btn primary" disabled={!title.trim()}>
          追加
        </button>
      </form>

      {groups.length === 0 ? (
        <Empty>まだありません。上で「何を勉強するか」を書いて追加してください</Empty>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="bucket">
            <h2 className="section">{g.label}</h2>
            <ul className="todo">
              {g.items.map((t) => {
                const total = totals.get(t.id)
                const inToday = t.pinnedDate === today
                return (
                  <li key={t.id} className="todo-row">
                    <button type="button" className="todo-title" onClick={() => setEditing(t)}>
                      {t.title}
                      <span className="todo-due">
                        {total
                          ? `累計 ${formatDuration(total.minutes)} ・ 最後 ${total.lastDate?.slice(5).replace('-', '/')}`
                          : 'まだ記録なし'}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`btn sm${inToday ? ' ghost' : ''}`}
                      onClick={() => toggleToday(t)}
                    >
                      {inToday ? '今日のリストから外す' : '今日やる'}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}

      <p className="hint">
        時間は、1 ページ目の「今日やること」で「今やる」を押して測ると、ここに累計が出ます。
        今日のリストでチェックを付けても学習そのものは終わらず、その日のぶんが済んだことになります。
      </p>

      {finished.length > 0 && (
        <section className="bucket">
          <button type="button" className="btn ghost sm" onClick={() => setShowDone(!showDone)}>
            終えた学習 {finished.length}件 {showDone ? 'を隠す' : 'を見る'}
          </button>
          {showDone &&
            finished.map((t) => (
              <div key={t.id} className="todo-row is-done">
                <span className="todo-title">
                  {t.title}
                  <span className="todo-due">
                    累計 {formatDuration(totals.get(t.id)?.minutes ?? 0)}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => upsert('tasks', { ...t, status: 'doing', doneAt: undefined })}
                >
                  再開
                </button>
              </div>
            ))}
        </section>
      )}

      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <strong>学習を直す</strong>
          <Field label="学習すること">
            <input
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            />
          </Field>
          <Field label="分野">
            <select
              value={editing.area}
              onChange={(e) => setEditing({ ...editing, area: e.target.value as TaskArea })}
            >
              {AREAS.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <div className="row">
            <button
              type="button"
              className="btn primary grow"
              disabled={!editing.title.trim()}
              onClick={() => {
                upsert('tasks', { ...editing, title: editing.title.trim() })
                setEditing(null)
              }}
            >
              保存
            </button>
            <button type="button" className="btn grow" onClick={() => setEditing(null)}>
              やめる
            </button>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn ghost sm grow"
              onClick={() => {
                upsert('tasks', {
                  ...editing,
                  status: 'done',
                  doneAt: new Date().toISOString(),
                  pinnedDate: undefined,
                })
                setEditing(null)
              }}
            >
              この学習を終える
            </button>
            <button
              type="button"
              className="btn ghost sm danger grow"
              onClick={() => {
                if (!window.confirm(`「${editing.title}」を消しますか？（測った記録は残ります）`)) return
                remove('tasks', editing.id)
                setEditing(null)
              }}
            >
              消す
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
