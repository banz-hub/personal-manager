import { useCallback, useEffect, useMemo, useState } from 'react'
import TaskForm, { blankTask } from '../components/TaskForm'
import { Banner, Empty, Sheet, Stat } from '../components/ui'
import { loadYoteichoDay, parseManualSlots, type YoteichoDay } from '../lib/bridge/yoteicho'
import { formatDate, formatDuration, fromMinutes, nowMinutes, todayKey, toMinutes } from '../lib/date'
import {
  BUCKET_LABELS,
  BUCKET_MARKS,
  BUCKET_ORDER,
  explainTop,
  type Bucket,
  type ScoredTask,
} from '../lib/priority'
import { completeStudy, completeWork } from '../lib/review'
import {
  generatePlan,
  minutesOf,
  plannedNodeIds,
  plannedTaskIds,
  subtractBusy,
  workMinutes,
  type FreeSlot,
} from '../lib/scheduler'
import { explainStudy } from '../lib/study'
import { buildContextText, buildToday, currentBlock, topThreeToday } from '../lib/today'
import { useApp } from '../state/AppContext'
import {
  AREA_LABELS,
  MASTERY_LABELS,
  MASTERY_ORDER,
  type Mastery,
  type PlanBlock,
  type Task,
} from '../types'

export default function TodayPage() {
  const { data, upsert, replaceList } = useApp()
  const [now, setNow] = useState(() => nowMinutes())
  const [yoteicho, setYoteicho] = useState<YoteichoDay | null>(null)
  const [manual, setManual] = useState('')
  const [manualSlots, setManualSlots] = useState<FreeSlot[] | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [finishing, setFinishing] = useState<PlanBlock | null>(null)
  const [copied, setCopied] = useState(false)

  const date = todayKey()
  const settings = data.settings

  // 「推奨開始 18:00」がずれないよう、現在時刻を定期的に更新する
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowMinutes()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!settings.useYoteicho) {
      setYoteicho({ available: false, items: [], slots: [], reason: '連携を切ってあります' })
      return
    }
    let alive = true
    void loadYoteichoDay(date, {
      dayStart: settings.dayStart,
      dayEnd: settings.dayEnd,
      minSlotMin: settings.minSlotMin,
      travelAllowanceMin: settings.travelAllowanceMin,
    }).then((d) => {
      if (alive) setYoteicho(d)
    })
    return () => {
      alive = false
    }
  }, [
    date,
    settings.useYoteicho,
    settings.dayStart,
    settings.dayEnd,
    settings.minSlotMin,
    settings.travelAllowanceMin,
  ])

  const plan = data.plans.find((p) => p.date === date)

  // 毎回の描画で新しい配列を作らないよう固定する (作ると buildToday が毎回走る)
  const slots = useMemo(() => manualSlots ?? yoteicho?.slots ?? [], [manualSlots, yoteicho])

  const ctx = useMemo(
    () =>
      buildToday({
        date,
        now,
        tasks: data.tasks,
        logs: data.logs,
        nodes: data.nodes,
        exams: data.exams,
        sessions: data.sessions,
        fixed: yoteicho?.items ?? [],
        slots,
        settings,
        plan,
      }),
    [date, now, data.tasks, data.logs, data.nodes, data.exams, data.sessions, yoteicho, slots, settings, plan],
  )

  const three = topThreeToday(ctx)
  const active = currentBlock(plan, now)
  const plannedIds = useMemo(
    () => new Set(plan ? [...plannedTaskIds(plan), ...plannedNodeIds(plan)] : []),
    [plan],
  )

  const generate = useCallback(() => {
    // 完了済みのブロックは実績なので消さない。その時間は空き時間から先に外す
    const doneBlocks = (plan?.blocks ?? []).filter((b) => b.doneAt)
    const next = generatePlan({
      slots: subtractBusy(
        ctx.slots,
        doneBlocks.map((b) => ({ from: toMinutes(b.start), to: toMinutes(b.end) })),
      ),
      items: ctx.schedulable,
      settings,
      today: date,
      now,
    })
    upsert('plans', {
      ...next,
      blocks: [...doneBlocks, ...next.blocks].sort(
        (a, b) => toMinutes(a.start) - toMinutes(b.start),
      ),
    })
  }, [ctx, settings, date, now, plan, upsert])

  const finishBlock = (
    block: PlanBlock,
    actualMin: number,
    finish: boolean,
    mastery?: Mastery,
    score?: { correct: number; attempted: number },
  ) => {
    const plannedMin = toMinutes(block.end) - toMinutes(block.start)

    if (block.kind === 'study' && block.nodeId) {
      const node = data.nodes.find((n) => n.id === block.nodeId)
      if (node) {
        const { node: nextNode, session } = completeStudy(node, actualMin, date, mastery, score)
        upsert('nodes', nextNode)
        upsert('sessions', session)
      }
    } else if (block.taskId) {
      const task = data.tasks.find((t) => t.id === block.taskId)
      if (task) {
        const { task: nextTask, log } = completeWork(task, actualMin, plannedMin, date, finish)
        upsert('tasks', nextTask)
        upsert('logs', log)
      }
    }

    if (plan) {
      upsert('plans', {
        ...plan,
        blocks: plan.blocks.map((b) =>
          b.id === block.id ? { ...b, doneAt: new Date().toISOString(), actualMin } : b,
        ),
      })
    }
    setFinishing(null)
  }

  const copyContext = async () => {
    try {
      await navigator.clipboard.writeText(buildContextText(ctx))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const applyManual = () => {
    const parsed = parseManualSlots(manual)
    setManualSlots(parsed.length > 0 ? parsed : null)
  }

  const workCount = plan?.blocks.filter((b) => b.kind === 'task' || b.kind === 'study') ?? []
  const doneCount = workCount.filter((b) => b.doneAt).length
  // 直前の試験があれば、いちばん上で知らせる
  const urgentExam = ctx.examPlans.find((p) => p.reviewPhase)

  return (
    <div className="page">
      <div className="row">
        <strong className="grow">{formatDate(date)}</strong>
        <span className="dim">{fromMinutes(now)} 現在</span>
      </div>

      {/* --- 何をすべきか、を最初に --- */}
      <Banner>{explainTop(ctx.ranked)}</Banner>
      {ctx.study.length > 0 && <Banner>{explainStudy(ctx.study)}</Banner>}

      {urgentExam && (
        <Banner alert>
          <strong>{urgentExam.exam.title}</strong> まであと{urgentExam.daysLeft}日
          <ul>
            {urgentExam.findings.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Banner>
      )}

      {three.length > 0 && (
        <div className="card">
          <div className="bucket-head">今日の最重要3項目</div>
          <ol style={{ margin: '6px 0 0', paddingLeft: '1.2em' }}>
            {three.map((s) => (
              <li key={`${s.kind}:${s.refId}`}>
                {s.kind === 'study' && <span className="tag">学習</span>} {s.title}
                <span className="dim"> — {formatDuration(s.todayMin)}</span>
                {/* 大事なものほど「今日は入らない」ことを黙って隠さない */}
                {plan && !plannedIds.has(s.refId) && (
                  <span className="warn"> 今日の予定には入っていません</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="stats">
        <Stat k="空き時間" v={formatDuration(ctx.availableMin)} />
        <Stat k="予定した作業" v={plan ? formatDuration(workMinutes(plan)) : '—'} />
        <Stat k="完了" v={workCount.length ? `${doneCount}/${workCount.length}` : '—'} />
      </div>

      {/* --- 動かせない予定 --- */}
      <section className="bucket">
        <h2 className="section">今日の予定（よてい帳）</h2>
        {yoteicho && !yoteicho.available && (
          <Banner alert>
            {yoteicho.reason}
            <div className="hint" style={{ marginTop: 6 }}>
              下の「空き時間を手で入れる」で、使える時間を直接指定できます。
            </div>
          </Banner>
        )}
        {ctx.fixed.length === 0 ? (
          <Empty>動かせない予定はありません</Empty>
        ) : (
          <div className="timeline">
            {ctx.fixed.map((f) => (
              <div key={f.id} className="blk k-fixed">
                <span className="blk-time">
                  {f.start}–{f.end}
                </span>
                <span className="blk-title">{f.title}</span>
                {f.placeName && <span className="tag">{f.placeName}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* --- 空き時間 --- */}
      <section className="bucket">
        <h2 className="section">空き時間</h2>
        {ctx.slots.length === 0 ? (
          <Empty>これから使える空き時間がありません</Empty>
        ) : (
          <div className="timeline">
            {ctx.slots.map((s) => (
              <div key={s.startMin} className="blk k-buffer">
                <span className="blk-time">
                  {fromMinutes(s.startMin)}–{fromMinutes(s.endMin)}
                </span>
                <span className="blk-title">{s.label ?? '空き'}</span>
                <span className="tag">{formatDuration(minutesOf(s))}</span>
              </div>
            ))}
          </div>
        )}
        <details>
          <summary className="dim" style={{ cursor: 'pointer' }}>
            空き時間を手で入れる
          </summary>
          <div className="row tight" style={{ marginTop: 8 }}>
            <input
              className="grow"
              placeholder="19:00〜23:00"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
            />
            <button type="button" className="btn sm" onClick={applyManual}>
              反映
            </button>
            {manualSlots && (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setManualSlots(null)
                  setManual('')
                }}
              >
                戻す
              </button>
            )}
          </div>
          <p className="hint">
            手入力するとよてい帳の空き時間より優先されます。「13:00-15:00 と 19:30〜22:00」のように複数書けます。
          </p>
        </details>
      </section>

      {/* --- 今日の予定表 --- */}
      <section className="bucket">
        <div className="row">
          <h2 className="section grow">今日の予定表</h2>
          <button type="button" className="btn primary sm" onClick={generate}>
            {plan ? '作り直す' : '今日の予定を作る'}
          </button>
        </div>

        {!plan ? (
          <Empty>まだ作っていません。「今日の予定を作る」を押してください。</Empty>
        ) : (
          <>
            {plan.notes.length > 0 && (
              <Banner alert>
                <ul>
                  {plan.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </Banner>
            )}
            <div className="timeline">
              {plan.blocks.map((b) => (
                <div
                  key={b.id}
                  className={`blk k-${b.kind}${b.doneAt ? ' is-done' : ''}${
                    active?.id === b.id ? ' is-now' : ''
                  }`}
                >
                  <span className="blk-time">
                    {b.start}–{b.end}
                  </span>
                  <span>
                    <span className="blk-title">
                      {b.kind === 'study' && <span className="tag">学習</span>} {b.title}
                    </span>
                    {b.reason && <div className="reason">{b.reason}</div>}
                    {b.doneAt && b.actualMin != null && (
                      <div className="dim">実績 {formatDuration(b.actualMin)}</div>
                    )}
                  </span>
                  {(b.kind === 'task' || b.kind === 'study') && !b.doneAt && (
                    <button type="button" className="btn sm" onClick={() => setFinishing(b)}>
                      完了
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* --- 学習の候補 --- */}
      {ctx.study.length > 0 && (
        <section className="bucket">
          <h2 className="section">今日の学習の候補</h2>
          {ctx.study.slice(0, settings.studyPerDayMax).map((s) => (
            <div key={s.node.id} className={`task m-${s.mastery}`}>
              <span className="task-title">{s.node.title}</span>
              <span className="task-meta">
                {s.path && <span className="tag">{s.path}</span>}
                <span className={`tag m-${s.mastery}`}>{MASTERY_LABELS[s.mastery]}</span>
                <span>{formatDuration(s.todayMin)}</span>
                {s.exam && <span>試験 {s.exam.date}</span>}
                {s.progress.accuracy != null && (
                  <span>正答{Math.round(s.progress.accuracy * 100)}%</span>
                )}
                {s.progress.staleDays != null && <span>{s.progress.staleDays}日ぶり</span>}
              </span>
              {s.reasons.length > 0 && <span className="reason">{s.reasons.join('・')}</span>}
            </div>
          ))}
        </section>
      )}

      {/* --- 優先順位つきタスク --- */}
      <section className="bucket">
        <div className="row">
          <h2 className="section grow">優先順位</h2>
          <button type="button" className="btn sm" onClick={() => setEditing(blankTask())}>
            ＋ 追加
          </button>
        </div>

        {ctx.ranked.length === 0 ? (
          <Empty>タスクがありません。「＋ 追加」から入れてください。</Empty>
        ) : (
          BUCKET_ORDER.map((bucket) => {
            const list = ctx.buckets[bucket]
            if (list.length === 0) return null
            return (
              <BucketSection
                key={bucket}
                bucket={bucket}
                list={list}
                onEdit={setEditing}
                today={date}
              />
            )
          })
        )}
      </section>

      <div className="row">
        <button type="button" className="btn ghost grow" onClick={copyContext}>
          {copied ? 'コピーしました' : '今日の状況をコピー（Claude に貼る用）'}
        </button>
      </div>

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
                data.tasks.filter((t) => t.id !== id),
              )
              setEditing(null)
            }}
          />
        </Sheet>
      )}

      {finishing && (
        <FinishSheet
          block={finishing}
          onClose={() => setFinishing(null)}
          onDone={(actual, finish, mastery, score) =>
            finishBlock(finishing, actual, finish, mastery, score)
          }
        />
      )}
    </div>
  )
}

function BucketSection({
  bucket,
  list,
  onEdit,
  today,
}: {
  bucket: Bucket
  list: ScoredTask[]
  onEdit: (t: Task) => void
  today: string
}) {
  return (
    <div className="bucket">
      <div className="bucket-head">
        <span>
          {BUCKET_MARKS[bucket]} {BUCKET_LABELS[bucket]}
        </span>
        <span className="count">{list.length}件</span>
      </div>
      {list.map((s) => (
        <button
          key={s.task.id}
          type="button"
          className={`task b-${bucket}`}
          style={{ textAlign: 'left', cursor: 'pointer' }}
          onClick={() => onEdit(s.task)}
        >
          <span className="task-title">{s.task.title}</span>
          <span className="task-meta">
            <span className="tag">{AREA_LABELS[s.task.area]}</span>
            <span>{formatDuration(s.todayMin)}</span>
            {s.task.dueDate && (
              <span>
                締切 {s.task.dueDate === today ? '今日' : s.task.dueDate}
                {s.task.dueTime ? ` ${s.task.dueTime}` : ''}
              </span>
            )}
            {/* 継続タスクは残りが減らない作りなので「残り」を出すと嘘になる */}
            {!s.task.recurring && s.task.estimateMin !== s.todayMin && (
              <span>残り {formatDuration(s.task.estimateMin)}</span>
            )}
          </span>
          {s.reasons.length > 0 && <span className="reason">{s.reasons.join('・')}</span>}
          {s.estimateNote && <span className="dim">{s.estimateNote}</span>}
          {s.warnings.map((w) => (
            <span key={w} className="warn">
              ⚠ {w}
            </span>
          ))}
        </button>
      ))}
    </div>
  )
}

function FinishSheet({
  block,
  onClose,
  onDone,
}: {
  block: PlanBlock
  onClose: () => void
  onDone: (
    actualMin: number,
    finish: boolean,
    mastery?: Mastery,
    score?: { correct: number; attempted: number },
  ) => void
}) {
  const planned = toMinutes(block.end) - toMinutes(block.start)
  const [actual, setActual] = useState(planned)
  const [mastery, setMastery] = useState<Mastery | undefined>(undefined)
  const [correct, setCorrect] = useState('')
  const [attempted, setAttempted] = useState('')

  const isStudy = block.kind === 'study'
  const score =
    correct !== '' && attempted !== '' && Number(attempted) > 0
      ? { correct: Number(correct), attempted: Number(attempted) }
      : undefined

  return (
    <Sheet onClose={onClose}>
      <div className="row">
        <strong className="grow">{block.title}</strong>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          閉じる
        </button>
      </div>
      <p className="hint">
        予定は{formatDuration(planned)}でした。実際にかかった時間を入れると、
        {isStudy ? '学習時間として記録されます。' : '次回の見積もりが自動で補正されます。'}
      </p>

      <div className="row tight">
        {[15, 30, 45, 60, 90].map((m) => (
          <button key={m} type="button" className="btn sm" onClick={() => setActual(m)}>
            {m}分
          </button>
        ))}
      </div>
      <label className="field">
        <span>実績（分）</span>
        <input
          type="number"
          min={1}
          step={5}
          value={actual}
          onChange={(e) => setActual(Number(e.target.value))}
        />
      </label>

      {isStudy && (
        <>
          <div className="field">
            <span>やってみた手応え（選ばなければ理解度は変えません）</span>
            <div className="row tight">
              {MASTERY_ORDER.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`chip${mastery === m ? ' is-on' : ''} m-${m}`}
                  onClick={() => setMastery(mastery === m ? undefined : m)}
                >
                  {MASTERY_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid2">
            <label className="field">
              <span>正解した数</span>
              <input
                type="number"
                min={0}
                value={correct}
                placeholder="任意"
                onChange={(e) => setCorrect(e.target.value)}
              />
            </label>
            <label className="field">
              <span>解いた数</span>
              <input
                type="number"
                min={0}
                value={attempted}
                placeholder="任意"
                onChange={(e) => setAttempted(e.target.value)}
              />
            </label>
          </div>
        </>
      )}

      {isStudy ? (
        <button
          type="button"
          className="btn primary"
          onClick={() => onDone(actual, false, mastery, score)}
        >
          記録する
        </button>
      ) : (
        <div className="row">
          <button type="button" className="btn grow" onClick={() => onDone(actual, false)}>
            ここまで記録（続きあり）
          </button>
          <button type="button" className="btn primary grow" onClick={() => onDone(actual, true)}>
            完了にする
          </button>
        </div>
      )}
    </Sheet>
  )
}
