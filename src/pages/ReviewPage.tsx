import { useEffect, useMemo, useState } from 'react'
import { Banner, Empty, Stat } from '../components/ui'
import { addDays, formatDate, formatDuration, todayKey } from '../lib/date'
import { buildReview, carryOver } from '../lib/review'
import { loadKintoreDay, type KintoreDay } from '../lib/bridge/kintore'
import { areaOf } from '../lib/study'
import { useApp } from '../state/AppContext'
import { AREA_LABELS } from '../types'

export default function ReviewPage() {
  const { data, upsert, replaceList } = useApp()
  const [date, setDate] = useState(todayKey())
  const [message, setMessage] = useState('')

  const plan = data.plans.find((p) => p.date === date)
  const logs = useMemo(() => data.logs.filter((l) => l.date === date), [data.logs, date])
  const sessions = useMemo(
    () => data.sessions.filter((s) => s.date === date),
    [data.sessions, date],
  )
  const [kintore, setKintore] = useState<KintoreDay | null>(null)

  // 筋トレの実績は筋トレログが正本。今日ぶんだけ読んで写す
  useEffect(() => {
    if (!data.settings.useKintore || date !== todayKey()) {
      setKintore(null)
      return
    }
    let alive = true
    void loadKintoreDay().then((d) => {
      if (alive) setKintore(d)
    })
    return () => {
      alive = false
    }
  }, [date, data.settings.useKintore])

  const workout = useMemo(
    () =>
      kintore?.available
        ? { minutes: kintore.todayMinutes ?? 0, done: kintore.doneToday }
        : undefined,
    [kintore],
  )

  const saved = data.reviews.find((r) => r.date === date)

  // 保存済みがあればそれを、無ければその場で組み立てて見せる
  const review = useMemo(
    () => saved ?? buildReview({ date, plan, tasks: data.tasks, logs, nodes: data.nodes, sessions, workout }),
    [saved, date, plan, data.tasks, logs, data.nodes, sessions, workout],
  )

  const titleOf = (id: string) => data.tasks.find((t) => t.id === id)?.title ?? '（削除済み）'
  const nodeTitleOf = (id: string) => data.nodes.find((n) => n.id === id)?.title ?? '（削除済み）'

  // タスクの実績と学習の実績を同じ分野の物差しで足す
  const byArea = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of logs) m.set(l.area, (m.get(l.area) ?? 0) + l.actualMin)
    for (const s of sessions) {
      const area = areaOf(data.nodes, s.nodeId)
      m.set(area, (m.get(area) ?? 0) + s.minutes)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [logs, sessions, data.nodes])

  const save = () => {
    upsert('reviews', buildReview({ date, plan, tasks: data.tasks, logs, nodes: data.nodes, sessions, workout }))
    setMessage('レビューを保存しました')
  }

  const doCarryOver = () => {
    const { tasks, carried } = carryOver(data.tasks, plan, date)
    replaceList('tasks', tasks)
    setMessage(
      carried.length > 0
        ? `${carried.length}件を明日に繰り越しました。優先順位が上がります。`
        : '繰り越すタスクはありませんでした',
    )
  }

  const isToday = date === todayKey()

  return (
    <div className="page">
      <div className="row">
        <button type="button" className="btn ghost sm" onClick={() => setDate(addDays(date, -1))}>
          前の日
        </button>
        <strong className="grow" style={{ textAlign: 'center' }}>
          {formatDate(date)}
        </strong>
        <button
          type="button"
          className="btn ghost sm"
          disabled={isToday}
          onClick={() => setDate(addDays(date, 1))}
        >
          次の日
        </button>
      </div>

      {message && <Banner>{message}</Banner>}

      <div className="stats">
        <Stat k="完了" v={`${review.doneTaskIds.length + review.doneNodeIds.length}件`} />
        <Stat k="実績" v={formatDuration(review.actualMin)} />
        <Stat k="うち学習" v={formatDuration(review.studyMin)} />
      </div>

      <section className="bucket">
        <h2 className="section">今日をどう見るか</h2>
        <Banner>
          <ul>
            {review.findings.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Banner>
      </section>

      {byArea.length > 0 && (
        <section className="bucket">
          <h2 className="section">分野ごとの実績</h2>
          <div className="timeline">
            {byArea.map(([area, min]) => (
              <div key={area} className="blk">
                <span className="blk-time">{AREA_LABELS[area as keyof typeof AREA_LABELS] ?? area}</span>
                <span className="blk-title">{formatDuration(min)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bucket">
        <h2 className="section">完了 {review.doneTaskIds.length}件</h2>
        {review.doneTaskIds.length === 0 ? (
          <Empty>まだありません</Empty>
        ) : (
          review.doneTaskIds.map((id) => (
            <div key={id} className="task is-done">
              <span className="task-title done">{titleOf(id)}</span>
            </div>
          ))
        )}
      </section>

      <section className="bucket">
        <h2 className="section">未完了 {review.undoneTaskIds.length}件</h2>
        {review.undoneTaskIds.length === 0 ? (
          <Empty>ありません</Empty>
        ) : (
          review.undoneTaskIds.map((id) => (
            <div key={id} className={`task${review.deferredTaskIds.includes(id) ? ' b-urgent' : ''}`}>
              <span className="task-title">{titleOf(id)}</span>
              <span className="dim">
                {review.deferredTaskIds.includes(id) ? '手をつけられなかった' : '途中まで進んだ'}
              </span>
            </div>
          ))
        )}
      </section>

      {(review.doneNodeIds.length > 0 || review.undoneNodeIds.length > 0) && (
        <section className="bucket">
          <h2 className="section">学習</h2>
          {review.doneNodeIds.map((id) => (
            <div key={id} className="task is-done">
              <span className="task-title done">{nodeTitleOf(id)}</span>
            </div>
          ))}
          {review.undoneNodeIds.map((id) => (
            <div key={id} className="task b-urgent">
              <span className="task-title">{nodeTitleOf(id)}</span>
              <span className="dim">手をつけられなかった</span>
            </div>
          ))}
        </section>
      )}

      <div className="row">
        <button type="button" className="btn grow" onClick={save}>
          {saved ? 'レビューを更新' : 'レビューを保存'}
        </button>
        <button
          type="button"
          className="btn primary grow"
          disabled={review.undoneTaskIds.length === 0}
          onClick={doCarryOver}
        >
          未完了を明日へ繰り越す
        </button>
      </div>
      <p className="hint">
        繰り越しても締切は動きません。先送りした回数だけを数えて、次の日の優先順位を上げます。
      </p>
    </div>
  )
}
