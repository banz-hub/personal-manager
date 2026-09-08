import { useEffect, useMemo, useState } from 'react'
import { BarChart } from '../components/Chart'
import { Banner, Empty, Stat } from '../components/ui'
import {
  loadKintoreDay,
  loadKintoreRange,
  type KintoreDay,
  type WorkoutDay,
} from '../lib/bridge/kintore'
import { addDays, formatDate, formatDuration, todayKey } from '../lib/date'
import { buildReview, carryOver } from '../lib/review'
import { areaOf } from '../lib/study'
import {
  buildStats,
  monthBuckets,
  totalOf,
  trendOf,
  yearBuckets,
  type Bucket,
} from '../lib/stats'
import { buildWeekly, formatWeek, isCurrentWeek, shiftWeek, weekStartOf } from '../lib/weekly'
import { useApp } from '../state/AppContext'
import { AREA_LABELS } from '../types'

type Tab = 'daily' | 'weekly' | 'monthly' | 'yearly'

export default function ReviewPage() {
  const [tab, setTab] = useState<Tab>('daily')

  return (
    <div className="page">
      <div className="row tight">
        <button
          type="button"
          className={`btn sm${tab === 'daily' ? ' primary' : ' ghost'}`}
          onClick={() => setTab('daily')}
        >
          今日
        </button>
        <button
          type="button"
          className={`btn sm${tab === 'weekly' ? ' primary' : ' ghost'}`}
          onClick={() => setTab('weekly')}
        >
          今週
        </button>
        <button
          type="button"
          className={`btn sm${tab === 'monthly' ? ' primary' : ' ghost'}`}
          onClick={() => setTab('monthly')}
        >
          月ごと
        </button>
        <button
          type="button"
          className={`btn sm${tab === 'yearly' ? ' primary' : ' ghost'}`}
          onClick={() => setTab('yearly')}
        >
          年ごと
        </button>
      </div>

      {tab === 'daily' && <Daily />}
      {tab === 'weekly' && <Weekly />}
      {tab === 'monthly' && <Periodic kind="month" />}
      {tab === 'yearly' && <Periodic kind="year" />}
    </div>
  )
}

function Daily() {
  const { data, upsert, replaceList } = useApp()
  const [date, setDate] = useState(todayKey())
  const [message, setMessage] = useState('')
  const [kintore, setKintore] = useState<KintoreDay | null>(null)

  const plan = data.plans.find((p) => p.date === date)
  const logs = useMemo(() => data.logs.filter((l) => l.date === date), [data.logs, date])
  const sessions = useMemo(() => data.sessions.filter((s) => s.date === date), [data.sessions, date])

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

  const review = useMemo(
    () =>
      saved ??
      buildReview({ date, plan, tasks: data.tasks, logs, nodes: data.nodes, sessions, workout }),
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
    upsert(
      'reviews',
      buildReview({ date, plan, tasks: data.tasks, logs, nodes: data.nodes, sessions, workout }),
    )
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
    <>
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
                <span className="blk-time">
                  {AREA_LABELS[area as keyof typeof AREA_LABELS] ?? area}
                </span>
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
            <div
              key={id}
              className={`task${review.deferredTaskIds.includes(id) ? ' b-urgent' : ''}`}
            >
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
    </>
  )
}

function Weekly() {
  const { data, upsert } = useApp()
  const today = todayKey()
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today))
  const [workouts, setWorkouts] = useState<WorkoutDay[] | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!data.settings.useKintore) {
      setWorkouts(null)
      return
    }
    let alive = true
    void loadKintoreRange(weekStart, addDays(weekStart, 6)).then((w) => {
      if (alive) setWorkouts(w)
    })
    return () => {
      alive = false
    }
  }, [weekStart, data.settings.useKintore])

  const saved = data.weeklyReviews.find((r) => r.weekStart === weekStart)

  const compute = () =>
    buildWeekly({
      date: weekStart,
      tasks: data.tasks,
      logs: data.logs,
      plans: data.plans,
      reviews: data.reviews,
      nodes: data.nodes,
      sessions: data.sessions,
      companies: data.companies,
      selections: data.selections,
      workouts,
    })

  // 保存済みがあればその時点の姿を、無ければその場で計算して見せる
  const summary = useMemo(
    () => saved?.summary ?? compute(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saved, weekStart, data, workouts],
  )

  const save = () => {
    upsert('weeklyReviews', {
      id: weekStart,
      weekStart,
      weekEnd: addDays(weekStart, 6),
      summary: compute(),
      createdAt: new Date().toISOString(),
    })
    setMessage('週次レビューを保存しました')
  }

  const current = isCurrentWeek(weekStart, today)

  return (
    <>
      <div className="row">
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setWeekStart(shiftWeek(weekStart, -1))}
        >
          前の週
        </button>
        <strong className="grow" style={{ textAlign: 'center' }}>
          {formatWeek(weekStart)}
          {current && <span className="dim"> 今週</span>}
        </strong>
        <button
          type="button"
          className="btn ghost sm"
          disabled={current}
          onClick={() => setWeekStart(shiftWeek(weekStart, 1))}
        >
          次の週
        </button>
      </div>

      {message && <Banner>{message}</Banner>}
      {current && (
        <p className="hint">
          今週はまだ途中なので、数字は今の時点のものです。日曜の夜に見ると1週間ぶんになります。
        </p>
      )}

      <section className="bucket">
        <h2 className="section">来週改善すべきこと</h2>
        <Banner alert={summary.improvements.length > 1}>
          <ol style={{ margin: 0, paddingLeft: '1.2em' }}>
            {summary.improvements.map((t) => (
              <li key={t} style={{ marginBottom: 6 }}>
                {t}
              </li>
            ))}
          </ol>
        </Banner>
      </section>

      <section className="bucket">
        <h2 className="section">タスク</h2>
        <div className="stats">
          <Stat k="完了率" v={`${Math.round(summary.tasks.completionRate * 100)}%`} />
          <Stat k="延期率" v={`${Math.round(summary.tasks.deferRate * 100)}%`} />
          <Stat
            k="見積もり"
            v={
              summary.tasks.estimateRatio != null
                ? `×${summary.tasks.estimateRatio.toFixed(1)}`
                : '—'
            }
          />
        </div>
        <p className="dim">
          予定 {summary.tasks.planned}件 / 完了 {summary.tasks.done}件 / 先送り{' '}
          {summary.tasks.deferred}件 ・ 予定 {formatDuration(summary.tasks.plannedMin)} → 実績{' '}
          {formatDuration(summary.tasks.actualMin)}
        </p>
      </section>

      <section className="bucket">
        <h2 className="section">学習</h2>
        <div className="stats">
          <Stat k="学習時間" v={formatDuration(summary.study.totalMin)} />
          <Stat k="回数" v={`${summary.study.sessions}`} />
          <Stat k="習得" v={`${summary.study.masteredCount}`} />
        </div>
        {summary.study.byArea.length > 0 && (
          <div className="timeline">
            {summary.study.byArea.map(([area, min]) => (
              <div key={area} className="blk">
                <span className="blk-time">{AREA_LABELS[area] ?? area}</span>
                <span className="blk-title">{formatDuration(min)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bucket">
        <h2 className="section">集中</h2>
        {summary.focusSets == null ? (
          // タイマーより前に作った週次。0 と出すと「その週はやらなかった」に見える
          <Empty>この週はタイマーがまだありませんでした</Empty>
        ) : (
          <>
            <div className="stats">
              <Stat k="セット" v={`${summary.focusSets}`} />
              <Stat k="1日あたり" v={(summary.focusSets / 7).toFixed(1)} />
            </div>
            <p className="hint">
              25分を最後までやりきった回数です。途中で切ったぶんは時間には入りますが、
              セットには数えていません。
            </p>
          </>
        )}
      </section>

      <section className="bucket">
        <h2 className="section">就活</h2>
        <div className="stats">
          <Stat k="ES" v={`${summary.jobhunt.esCount}`} />
          <Stat k="説明会" v={`${summary.jobhunt.briefingCount}`} />
          <Stat k="面接" v={`${summary.jobhunt.interviewCount}`} />
        </div>
        <p className="dim">
          選考中 {summary.jobhunt.activeCompanies}社
          {summary.jobhunt.upcomingCount > 0 &&
            ` ・ 3日以内の予定 ${summary.jobhunt.upcomingCount}件`}
        </p>
      </section>

      <section className="bucket">
        <h2 className="section">筋トレ</h2>
        {!summary.workout.available ? (
          <Empty>筋トレログを読めませんでした</Empty>
        ) : (
          <>
            <div className="stats">
              <Stat k="回数" v={`${summary.workout.count}`} />
              <Stat k="合計" v={formatDuration(summary.workout.totalMin)} />
              <Stat k="休養日" v={`${summary.workout.restDays}`} />
            </div>
            <p className="hint">正本は筋トレログです。ここに出しているのは読み取った値です。</p>
          </>
        )}
      </section>

      <button type="button" className="btn" onClick={save}>
        {saved ? '週次レビューを更新' : '週次レビューを保存'}
      </button>
      <p className="hint">
        保存すると、そのときの数字がそのまま残ります。あとでデータを直しても、当時の姿が見られます。
      </p>
    </>
  )
}

/**
 * 月ごと・年ごとの推移。
 *
 * 週次は「来週どうするか」を決めるためのものだが、こちらは
 * **続いているかどうか**を見るためのもの。だから細かい所見は出さず、
 * 数字と推移をそのまま見せる。
 */
function Periodic({ kind }: { kind: 'month' | 'year' }) {
  const { data } = useApp()
  const today = todayKey()
  const [workouts, setWorkouts] = useState<WorkoutDay[] | null>(null)

  const buckets: Bucket[] = useMemo(
    () => (kind === 'month' ? monthBuckets(today, 6) : yearBuckets(today, 3)),
    [kind, today],
  )

  useEffect(() => {
    if (!data.settings.useKintore) {
      setWorkouts(null)
      return
    }
    let alive = true
    void loadKintoreRange(buckets[0].from, buckets.at(-1)!.to).then((w) => {
      if (alive) setWorkouts(w)
    })
    return () => {
      alive = false
    }
  }, [buckets, data.settings.useKintore])

  const stats = useMemo(
    () =>
      buildStats({
        buckets,
        logs: data.logs,
        sessions: data.sessions,
        nodes: data.nodes,
        plans: data.plans,
        workouts,
      }),
    [buckets, data.logs, data.sessions, data.nodes, data.plans, workouts],
  )

  const total = totalOf(stats)
  const trend = trendOf(stats)
  const latest = stats.at(-1)

  return (
    <>
      <div className="row">
        <strong className="grow">{kind === 'month' ? '月ごとの推移' : '年ごとの推移'}</strong>
        <span className="dim">
          {buckets[0].label}〜{buckets.at(-1)!.label}
        </span>
      </div>

      {trend && <Banner>{trend}</Banner>}

      <section className="bucket">
        <h2 className="section">動かした時間</h2>
        <BarChart stats={stats} />
      </section>

      {latest && (
        <section className="bucket">
          <h2 className="section">{latest.bucket.label}</h2>
          <div className="stats">
            <Stat k="合計" v={formatDuration(latest.totalMin)} />
            <Stat
              k="完了率"
              v={latest.planned > 0 ? `${Math.round((latest.done / latest.planned) * 100)}%` : '—'}
            />
            <Stat k="習得" v={`${latest.masteredCount}`} />
          </div>
          {latest.byArea.length > 0 && (
            <div className="timeline">
              {latest.byArea.map(([area, min]) => (
                <div key={area} className="blk">
                  <span className="blk-time">{AREA_LABELS[area] ?? area}</span>
                  <span className="blk-title">{formatDuration(min)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {total && (
        <section className="bucket">
          <h2 className="section">この期間の合計</h2>
          <div className="stats">
            <Stat k="タスク" v={formatDuration(total.taskMin)} />
            <Stat k="学習" v={formatDuration(total.studyMin)} />
            <Stat k="筋トレ" v={`${total.workoutCount}回`} />
          </div>
          <p className="dim">
            予定 {total.planned}件 / 完了 {total.done}件 ・ 習得 {total.masteredCount}項目
          </p>
        </section>
      )}

      {!workouts && data.settings.useKintore && (
        <p className="hint">筋トレログを読めていないため、筋トレのぶんは入っていません。</p>
      )}
    </>
  )
}
