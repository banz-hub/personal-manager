import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TaskForm, { blankTask } from '../components/TaskForm'
import { Banner, Empty, Popup, Sheet, Stat } from '../components/ui'
import { loadKintoreDay, type KintoreDay } from '../lib/bridge/kintore'
import { loadYoteichoDay, parseManualSlots, type YoteichoDay } from '../lib/bridge/yoteicho'
import {
  applyWriteBack,
  clearPmEvents,
  planWriteBack,
  readYoteichoEvents,
  type WriteBackPlan,
} from '../lib/bridge/yoteicho-write'
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
  workBlocks,
  workMinutes,
  type FreeSlot,
} from '../lib/scheduler'
import { ask, EXAMPLES, type Answer } from '../lib/ask'
import { nextActionFor, selectionSummary } from '../lib/jobhunt'
import {
  insertBlock,
  nudgeBlock,
  removeBlock,
  resizeBlock,
  setBlockStart,
  unplaced,
  whyCannotStart,
  NUDGE_MIN,
} from '../lib/planedit'
import { applyImport, linkedCount, parsePlanText, type ImportResult } from '../lib/importplan'
import { nextOccurrence } from '../lib/repeat'
import { needsTriage, nextStep, type RoutineStep, type StepKind } from '../lib/routine'
import {
  buildPlanIcs,
  buildReminders,
  downloadIcs,
  scheduleBackground,
  scheduleWhileOpen,
  showNow,
  type PendingReminder,
} from '../lib/reminders'
import { explainStudy } from '../lib/study'
import {
  buildContextText,
  buildToday,
  currentBlock,
  topThreeToday,
  type TodayContext,
} from '../lib/today'
import { useApp } from '../state/AppContext'
import {
  AREA_LABELS,
  MASTERY_LABELS,
  MASTERY_ORDER,
  STAGE_LABELS,
  type Mastery,
  type PlanBlock,
  type StudyNode,
  type Task,
} from '../types'

export default function TodayPage() {
  const { data, upsert, replaceList } = useApp()
  const [now, setNow] = useState(() => nowMinutes())
  const [yoteicho, setYoteicho] = useState<YoteichoDay | null>(null)
  const [kintore, setKintore] = useState<KintoreDay | null>(null)
  const [manual, setManual] = useState('')
  const [manualSlots, setManualSlots] = useState<FreeSlot[] | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [finishing, setFinishing] = useState<PlanBlock | null>(null)
  const [copied, setCopied] = useState(false)
  const [writeBack, setWriteBack] = useState<WriteBackPlan | null>(null)
  const [writeMessage, setWriteMessage] = useState('')
  const [popup, setPopup] = useState<PendingReminder | null>(null)
  const [editingPlan, setEditingPlan] = useState(false)
  const [importing, setImporting] = useState(false)

  const date = todayKey()
  const settings = data.settings
  const navigate = useNavigate()

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

  useEffect(() => {
    if (!settings.useKintore) {
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
  }, [date, settings.useKintore])

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
        companies: data.companies,
        selections: data.selections,
        fixed: yoteicho?.items ?? [],
        slots,
        settings,
        workout: kintore ?? undefined,
        plan,
      }),
    [
      date,
      now,
      data.tasks,
      data.logs,
      data.nodes,
      data.exams,
      data.sessions,
      data.companies,
      data.selections,
      yoteicho,
      kintore,
      slots,
      settings,
      plan,
    ],
  )

  // 通知は「閉じていても鳴る予約」と「開いている間のタイマー」の二段構え。
  // どちらも効かない環境のために、画面の中のポップ表示も出す
  const reminders = useMemo(
    () =>
      settings.notifyEnabled
        ? buildReminders({
            date,
            plan,
            tasks: data.tasks,
            beforeMin: settings.notifyBeforeMin,
            nodes: data.nodes,
            sessions: data.sessions,
            reviewAt: settings.dayStart,
          })
        : [],
    [
      settings.notifyEnabled,
      settings.notifyBeforeMin,
      settings.dayStart,
      date,
      plan,
      data.tasks,
      data.nodes,
      data.sessions,
    ],
  )

  useEffect(() => {
    if (reminders.length === 0) return
    void scheduleBackground(reminders)
    return scheduleWhileOpen(reminders, (r) => {
      setPopup(r)
      void showNow(r.title, r.body)
    })
  }, [reminders])

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
      // 前日の負荷が高い日は上限が下がっている
      settings: ctx.planSettings,
      today: date,
      now,
    })
    upsert('plans', {
      ...next,
      blocks: [...doneBlocks, ...next.blocks].sort(
        (a, b) => toMinutes(a.start) - toMinutes(b.start),
      ),
    })
  }, [ctx, date, now, plan, upsert])

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
        // 繰り返しのタスクは、終えたら次の回を作る
        const repeated =
          nextTask.status === 'done' ? nextOccurrence(nextTask, date, new Date().toISOString()) : null
        if (repeated) {
          replaceList('tasks', [
            ...data.tasks.map((t) => (t.id === nextTask.id ? nextTask : t)),
            repeated,
          ])
        } else {
          upsert('tasks', nextTask)
        }
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

  // 予定表の手直し。重なりと時刻の逆転は planedit 側で防いである
  const editPlan = (next: typeof plan) => {
    if (next && plan && next !== plan) upsert('plans', next)
  }
  const addToPlan = (refId: string) => {
    if (!plan) return
    const item = ctx.schedulable.find((s) => s.refId === refId)
    if (!item) return
    const next = insertBlock(plan, item, settings.dayStart, settings.dayEnd)
    if (next) upsert('plans', next)
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

  // 書き戻しは他アプリへの書き込みなので、必ず中身を見せてから実行する
  const previewWriteBack = async () => {
    if (!plan) return
    const existing = await readYoteichoEvents()
    if (existing === null) {
      setWriteMessage('よてい帳のデータを読めませんでした。同じオリジンで開いているか確認してください。')
      return
    }
    setWriteBack(planWriteBack(existing, plan.blocks, date))
  }

  const confirmWriteBack = async () => {
    if (!plan) return
    const r = await applyWriteBack(plan.blocks, date)
    setWriteMessage(r.message)
    setWriteBack(null)
    // 反映後のよてい帳を読み直して画面を合わせる
    if (r.ok && settings.useYoteicho) {
      const d = await loadYoteichoDay(date, {
        dayStart: settings.dayStart,
        dayEnd: settings.dayEnd,
        minSlotMin: settings.minSlotMin,
        travelAllowanceMin: settings.travelAllowanceMin,
      })
      setYoteicho(d)
    }
  }

  const undoWriteBack = async () => {
    const r = await clearPmEvents()
    setWriteMessage(r.message)
    setWriteBack(null)
  }

  const applyManual = () => {
    const parsed = parseManualSlots(manual)
    setManualSlots(parsed.length > 0 ? parsed : null)
  }

  const workCount = plan ? workBlocks(plan) : []
  // 筋トレの完了は筋トレログが正本なので、そちらの記録を見る
  const isBlockDone = (b: PlanBlock) =>
    b.kind === 'workout' ? Boolean(kintore?.doneToday) : Boolean(b.doneAt)
  const doneCount = workCount.filter(isBlockDone).length
  // 直前の試験があれば、いちばん上で知らせる
  const urgentExam = ctx.examPlans.find((p) => p.reviewPhase)
  // 就活の締切は 3 日以内と期限切れだけ今日の画面に出す (先の予定まで並べると埋もれる)
  const nearSelections = ctx.selections.filter((d) => d.urgency !== 'later')

  const routine = nextStep({
    now,
    today: date,
    plan,
    reviewed: data.reviews.some((r) => r.date === date),
    hasUndone: workCount.some((b) => !isBlockDone(b)),
    settings,
    hasTasks: data.tasks.length > 0,
  })
  const triage = needsTriage(ctx.buckets.overdue.length)

  const runRoutine = (kind: StepKind) => {
    if (kind === 'plan') {
      if (data.tasks.length === 0) setEditing(blankTask())
      else generate()
    } else if (kind === 'review' || kind === 'carry') {
      navigate('/review')
    } else if (kind === 'backup') {
      navigate('/settings')
    }
  }

  return (
    <div className="page">
      <div className="row">
        <strong className="grow">{formatDate(date)}</strong>
        <span className="dim">{fromMinutes(now)} 現在</span>
      </div>

      <RoutineCard step={routine} onAction={runRoutine} />

      {/* --- 一画面で今日をつかむ --- */}
      <Dashboard
        ctx={ctx}
        kintore={kintore}
        doneCount={doneCount}
        totalCount={workCount.length}
      />

      {/* --- 何をすべきか、を最初に --- */}
      <Banner>{explainTop(ctx.ranked)}</Banner>
      {ctx.study.length > 0 && <Banner>{explainStudy(ctx.study)}</Banner>}
      {ctx.easedNote && <Banner alert>{ctx.easedNote}</Banner>}
      {triage && (
        <Banner alert>
          {triage}
          <div className="row tight" style={{ marginTop: 8 }}>
            <button type="button" className="btn sm" onClick={() => navigate('/tasks?filter=overdue')}>
              期限切れを片づける
            </button>
          </div>
        </Banner>
      )}

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
          {plan && (
            <button
              type="button"
              className={`btn sm${editingPlan ? ' primary' : ''}`}
              onClick={() => setEditingPlan((v) => !v)}
            >
              {editingPlan ? '直し終わり' : '手で直す'}
            </button>
          )}
          {plan && (
            <button
              type="button"
              className="btn sm"
              title="端末のカレンダーにアラーム付きで入れる"
              onClick={() =>
                downloadIcs(
                  `shireitou-${date}.ics`,
                  buildPlanIcs(plan, date, settings.notifyBeforeMin),
                )
              }
            >
              カレンダーへ
            </button>
          )}
          {plan && yoteicho?.available && (
            <button type="button" className="btn sm" onClick={() => void previewWriteBack()}>
              よてい帳へ
            </button>
          )}
          <button type="button" className="btn primary sm" onClick={generate}>
            {plan ? '作り直す' : '今日の予定を作る'}
          </button>
        </div>

        {writeMessage && <Banner>{writeMessage}</Banner>}

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
                  className={`blk k-${b.kind}${isBlockDone(b) ? ' is-done' : ''}${
                    active?.id === b.id ? ' is-now' : ''
                  }`}
                >
                  <span className="blk-time">
                    {b.start}–{b.end}
                  </span>
                  <span>
                    <span className="blk-title">
                      {b.kind === 'study' && <span className="tag">学習</span>}
                      {b.kind === 'workout' && <span className="tag">🏋️</span>} {b.title}
                    </span>
                    {b.reason && <div className="reason">{b.reason}</div>}
                    {b.doneAt && b.actualMin != null && (
                      <div className="dim">実績 {formatDuration(b.actualMin)}</div>
                    )}
                    {b.kind === 'workout' && kintore?.doneToday && (
                      <div className="dim">
                        実績 {formatDuration(kintore.todayMinutes ?? 0)}（筋トレログの記録）
                      </div>
                    )}
                  </span>
                  {(b.kind === 'task' || b.kind === 'study') && !b.doneAt && (
                    <button type="button" className="btn sm" onClick={() => setFinishing(b)}>
                      完了
                    </button>
                  )}
                  {/* 筋トレの記録は筋トレログでつける。ここで二重に入力させない */}
                  {b.kind === 'workout' && !kintore?.doneToday && !editingPlan && (
                    <a
                      className="btn sm"
                      href="../kintore-app/"
                      target="_blank"
                      rel="noopener"
                      style={{ textDecoration: 'none' }}
                    >
                      開く
                    </a>
                  )}

                  {/* 手直し。完了済みは実績なので触らせない */}
                  {editingPlan && !b.doneAt && (
                    <span className="row tight" style={{ gap: 2 }}>
                      <button
                        type="button"
                        className="btn ghost sm"
                        title={`${NUDGE_MIN}分はやく`}
                        onClick={() => editPlan(nudgeBlock(plan, b.id, -NUDGE_MIN))}
                      >
                        ◀
                      </button>
                      <button
                        type="button"
                        className="btn ghost sm"
                        title={`${NUDGE_MIN}分おそく`}
                        onClick={() => editPlan(nudgeBlock(plan, b.id, NUDGE_MIN))}
                      >
                        ▶
                      </button>
                      <button
                        type="button"
                        className="btn ghost sm"
                        title="短くする"
                        onClick={() => editPlan(resizeBlock(plan, b.id, -NUDGE_MIN))}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="btn ghost sm"
                        title="長くする"
                        onClick={() => editPlan(resizeBlock(plan, b.id, NUDGE_MIN))}
                      >
                        ＋
                      </button>
                      <input
                        type="time"
                        className="blk-time-input"
                        value={b.start}
                        title="開始時刻を決める"
                        onChange={(e) => {
                          const why = whyCannotStart(plan, b.id, e.target.value)
                          setWriteMessage(why ?? '')
                          editPlan(setBlockStart(plan, b.id, e.target.value))
                        }}
                      />
                      <button
                        type="button"
                        className="btn ghost sm"
                        title="消す"
                        onClick={() => editPlan(removeBlock(plan, b.id))}
                      >
                        ✕
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>

            {editingPlan && (
              <>
                <p className="hint">
                  ◀▶ で {NUDGE_MIN} 分ずらし、−＋ で長さを変え、時刻の欄で開始時刻を直に決めます。
                  ほかのコマと重なる動きはしません（重なるときは理由を上に出します）。
                  完了したコマは実績なので触れません。
                </p>
                {unplaced(plan, ctx.schedulable).length > 0 && (
                  <section className="bucket">
                    <h2 className="section">予定に足す</h2>
                    {unplaced(plan, ctx.schedulable)
                      .slice(0, 8)
                      .map((s) => (
                        <button
                          key={`${s.kind}:${s.refId}`}
                          type="button"
                          className="task"
                          style={{ textAlign: 'left', cursor: 'pointer' }}
                          onClick={() => addToPlan(s.refId)}
                        >
                          <span className="task-title">
                            {s.kind === 'study' && <span className="tag">学習</span>} {s.title}
                          </span>
                          <span className="task-meta">
                            <span>{formatDuration(s.todayMin)}</span>
                            <span>{s.reason}</span>
                          </span>
                        </button>
                      ))}
                    <p className="hint">
                      押すと、空いているいちばん早い時間に入ります。入る場所が無いときは何も起きません。
                    </p>
                  </section>
                )}
              </>
            )}
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

      {/* --- 就活の締切。逃すと取り返しがつかないので、近いものは今日の画面にも出す --- */}
      {nearSelections.length > 0 && (
        <section className="bucket">
          <h2 className="section">就活の締切</h2>
          {nearSelections.map((d) => (
            <div
              key={d.event.id}
              className={`task ${
                d.urgency === 'overdue'
                  ? 'b-overdue'
                  : d.urgency === 'today'
                    ? 'b-urgent'
                    : 'b-important'
              }`}
            >
              <span className="task-title">{selectionSummary(d)}</span>
              <span className="task-meta">
                {d.company && <span className="tag">{STAGE_LABELS[d.company.stage]}</span>}
                {d.event.place && <span>{d.event.place}</span>}
                {d.company && <span>志望度 {'★'.repeat(d.company.interest)}</span>}
              </span>
              {d.company && nextActionFor(d.company) && (
                <span className="reason">次にやること: {nextActionFor(d.company)}</span>
              )}
            </div>
          ))}
        </section>
      )}

      {/* --- 筋トレ。内容は筋トレログの担当なので、こちらは状況だけ --- */}
      {kintore && (
        <section className="bucket">
          <h2 className="section">筋トレ</h2>
          {!kintore.available ? (
            <Banner alert>{kintore.reason}</Banner>
          ) : (
            <div className={`task ${kintore.doneToday ? 'is-done b-routine' : 'b-optional'}`}>
              <span className="task-title">
                {kintore.doneToday
                  ? `実施済み ${formatDuration(kintore.todayMinutes ?? 0)}`
                  : kintore.plannedToday
                    ? `今日やる（見込み ${formatDuration(kintore.estimateMin)}）`
                    : '今日は休み'}
              </span>
              <span className="task-meta">
                {/* 筋トレログの1日の区切りは司令塔と違うことがある。どの日の話かを隠さない */}
                {kintore.forDate !== date && (
                  <span className="tag">{kintore.forDate} ぶん</span>
                )}
                <span>
                  直近7日 {kintore.last7Count}回 / 週{kintore.daysPerWeek}回
                </span>
                {kintore.streakDays > 0 && <span>連続{kintore.streakDays}日</span>}
                {kintore.lastWorkoutOn && <span>最終 {kintore.lastWorkoutOn}</span>}
                {kintore.yesterdayMinutes != null && (
                  <span>昨日 {formatDuration(kintore.yesterdayMinutes)}</span>
                )}
              </span>
              <span className="reason">{kintore.planReason}</span>
              {kintore.forDate !== date && (
                <span className="hint">
                  筋トレログは1日の区切りをずらす設定になっているため、いまは {kintore.forDate} を
                  「今日」として数えています。深夜のトレーニングを前日ぶんとして扱う設定です。
                </span>
              )}
              <span className="hint">
                メニューと記録は筋トレログの担当です。司令塔は時間を空けるところまでしかしません。
              </span>
              <a
                className="btn sm"
                href="../kintore-app/"
                target="_blank"
                rel="noopener"
                style={{ textDecoration: 'none', textAlign: 'center' }}
              >
                筋トレログを開く
              </a>
            </div>
          )}
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

      <AskBox ctx={ctx} />

      <div className="row">
        <button type="button" className="btn ghost grow" onClick={copyContext}>
          {copied ? 'コピーしました' : '今日の状況をコピー（Claude に貼る用）'}
        </button>
        <button type="button" className="btn ghost" onClick={() => setImporting(true)}>
          返答を取り込む
        </button>
      </div>
      <p className="hint">
        コピーして Claude に相談し、返ってきた予定を「返答を取り込む」で戻せます。これで往復が閉じます。
      </p>

      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <TaskForm
            initial={editing}
            onSave={(t) => {
              upsert('tasks', t)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
            onDecompose={(t) => {
              // 分解はタスクの画面で行う (まとめて作るので一覧が見えたほうがよい)
              setEditing(null)
              navigate('/tasks')
              void t
            }}
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

      {/* 他のアプリに書き込むのはここだけ。何をするかを先に全部見せてから押させる */}
      {writeBack && (
        <Sheet onClose={() => setWriteBack(null)}>
          <div className="row">
            <strong className="grow">よてい帳に反映する</strong>
            <button type="button" className="btn ghost sm" onClick={() => setWriteBack(null)}>
              閉じる
            </button>
          </div>

          <Banner>
            <strong>手で入れた予定には触れません。</strong>
            司令塔が作った印のある予定だけを作り直します。書き込む直前にもう一度読み直して、
            手で入れた予定が1件でも消える計算になっていれば中止します。
          </Banner>

          <div className="stats">
            <Stat k="作る" v={`${writeBack.create.length}件`} />
            <Stat k="差し替え" v={`${writeBack.remove.length}件`} />
            <Stat k="触らない" v={`${writeBack.untouched}件`} />
          </div>

          {writeBack.create.length > 0 && (
            <section className="bucket">
              <h2 className="section">作る予定</h2>
              <div className="timeline">
                {writeBack.create.map((e) => (
                  <div key={e.id} className="blk">
                    <span className="blk-time">
                      {e.start}–{e.end}
                    </span>
                    <span className="blk-title">{e.title}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {writeBack.remove.length > 0 && (
            <section className="bucket">
              <h2 className="section">前に作ったぶん（差し替え）</h2>
              <div className="timeline">
                {writeBack.remove.map((e) => (
                  <div key={e.id} className="blk k-buffer">
                    <span className="blk-time">
                      {e.start}–{e.end}
                    </span>
                    <span className="blk-title">{e.title}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {writeBack.empty ? (
            <Empty>反映するものがありません</Empty>
          ) : (
            <button type="button" className="btn primary" onClick={() => void confirmWriteBack()}>
              よてい帳に反映する
            </button>
          )}

          <button type="button" className="btn ghost" onClick={() => void undoWriteBack()}>
            司令塔が作った予定をすべて取り消す
          </button>
          <p className="hint">
            取り消しても、手で入れた予定は残ります。よてい帳側で司令塔の予定を直接消しても構いません
            （次に反映したときに作り直されます）。
          </p>
        </Sheet>
      )}

      {/* ブラウザの通知が使えない環境でも、開いてさえいれば必ず目に入るようにする */}
      {popup && (
        <Popup title={popup.title} body={popup.body} onClose={() => setPopup(null)} />
      )}

      {importing && (
        <ImportSheet
          tasks={data.tasks}
          nodes={data.nodes}
          onApply={(result) => {
            upsert('plans', applyImport(plan, result.lines, date))
            setImporting(false)
          }}
          onClose={() => setImporting(false)}
        />
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

/**
 * 一画面で今日をつかむためのまとめ。
 * 下に並ぶ各節の要約なので、ここでは数字と一言だけにして詳細は各節に任せる。
 */
function Dashboard({
  ctx,
  kintore,
  doneCount,
  totalCount,
}: {
  ctx: TodayContext
  kintore: KintoreDay | null
  doneCount: number
  totalCount: number
}) {
  const nextFixed = ctx.fixed.find((f) => f.endMin > ctx.now)
  const nearestExam = ctx.examPlans[0]
  const buckets = ctx.buckets

  const rows: Array<{ icon: string; label: string; value: string }> = [
    {
      icon: '📅',
      label: '予定',
      value:
        ctx.fixed.length === 0
          ? '動かせない予定なし'
          : nextFixed
            ? `次は ${nextFixed.start} ${nextFixed.title}`
            : `${ctx.fixed.length}件（すべて終了）`,
    },
    {
      icon: '🎯',
      label: 'タスク',
      value:
        ctx.ranked.length === 0
          ? 'なし'
          : [
              buckets.overdue.length > 0 ? `期限切れ${buckets.overdue.length}` : null,
              buckets.urgent.length > 0 ? `最優先${buckets.urgent.length}` : null,
              buckets.important.length > 0 ? `重要${buckets.important.length}` : null,
              buckets.routine.length > 0 ? `継続${buckets.routine.length}` : null,
            ]
              .filter(Boolean)
              .join(' / ') || `${ctx.ranked.length}件`,
    },
    {
      icon: '📚',
      label: '学習',
      value: nearestExam
        ? `${nearestExam.exam.title} まで${nearestExam.daysLeft}日` +
          (nearestExam.requiredMin > 0 ? `・1日${formatDuration(nearestExam.perDayMin)}` : '')
        : ctx.study.length > 0
          ? `候補${ctx.study.length}件（試験の登録なし）`
          : '登録なし',
    },
    {
      icon: '💼',
      label: '就活',
      value: (() => {
        const u = ctx.selectionsByUrgency
        const near = [...u.overdue, ...u.today, ...u.tomorrow, ...u.soon]
        if (ctx.selections.length === 0) return '予定なし'
        if (near.length === 0) return `次は ${ctx.selections[0].label}（あと${ctx.selections[0].daysLeft}日）`
        return near
          .slice(0, 2)
          .map((d) => `${d.label}（${d.daysLeft < 0 ? '期限切れ' : d.daysLeft === 0 ? '今日' : `あと${d.daysLeft}日`}）`)
          .join(' / ')
      })(),
    },
    {
      icon: '🏋️',
      label: '筋トレ',
      value: !kintore?.available
        ? '連携なし'
        : kintore.doneToday
          ? `実施済み ${formatDuration(kintore.todayMinutes ?? 0)}` +
            (kintore.forDate !== ctx.date ? `（${kintore.forDate} ぶん）` : '')
          : kintore.plannedToday
            ? `今日やる（見込み ${formatDuration(kintore.estimateMin)}）`
            : '今日は休み',
    },
    {
      icon: '📊',
      label: '進捗',
      value:
        totalCount > 0
          ? `${doneCount}/${totalCount} 完了・空き ${formatDuration(ctx.availableMin)}`
          : `空き ${formatDuration(ctx.availableMin)}`,
    },
  ]

  return (
    <div className="card dashboard">
      <div className="bucket-head">TODAY</div>
      <dl>
        {rows.map((r) => (
          <div key={r.label} className="dash-row">
            <dt>
              <span aria-hidden>{r.icon}</span> {r.label}
            </dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * 朝と夜の案内。
 * ボタンを自分で探させないための一枚。押すものが無いときは何も出さない。
 */
function RoutineCard({
  step,
  onAction,
}: {
  step: RoutineStep
  onAction: (kind: StepKind) => void
}) {
  if (step.kind === 'none') return null
  return (
    <div className={`routine k-${step.kind}`}>
      <span className="routine-title">{step.title}</span>
      <span className="dim">{step.body}</span>
      {step.action && (
        <button type="button" className="btn primary" onClick={() => onAction(step.kind)}>
          {step.action}
        </button>
      )}
    </div>
  )
}

/**
 * 「今日どうすればいい？」に答える欄 (第 24 条)。
 * 中身は LLM ではなく、これまでの判断エンジンへの振り分け。
 * だから答えられないことは答えられないと言う。
 */
function AskBox({ ctx }: { ctx: TodayContext }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const navigate = useNavigate()

  const run = (q: string) => {
    const text = q.trim()
    if (!text) return
    setQuestion(text)
    setAnswer(ask(text, ctx))
  }

  return (
    <section className="bucket">
      <h2 className="section">聞く</h2>
      <div className="row tight">
        <input
          className="grow"
          value={question}
          placeholder="今日どうすればいい？"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              run(question)
            }
          }}
        />
        <button type="button" className="btn sm" onClick={() => run(question)}>
          聞く
        </button>
      </div>

      <div className="chips">
        {EXAMPLES.map((e) => (
          <button key={e} type="button" className="chip" onClick={() => run(e)}>
            {e}
          </button>
        ))}
      </div>

      {answer && (
        <div className="ask-answer">
          <strong>{answer.headline}</strong>
          <ul>
            {answer.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {answer.to && (
            <button type="button" className="btn sm" onClick={() => navigate(answer.to as string)}>
              その画面を開く
            </button>
          )}
        </div>
      )}
      <p className="hint">
        答えているのはアプリの中の決まりごとで、外部の AI ではありません。
        深く相談したいときは「今日の状況をコピー」で Claude に渡してください。
      </p>
    </section>
  )
}

/**
 * Claude の返した予定を取り込む。
 *
 * 書いてあることをそのまま作る。題名から推測して勝手に紐づけたりはしない。
 * 完全に一致するタスクや学習項目があるときだけ結びつける。
 */
function ImportSheet({
  tasks,
  nodes,
  onApply,
  onClose,
}: {
  tasks: Task[]
  nodes: StudyNode[]
  onApply: (result: ImportResult) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const result = useMemo(() => parsePlanText(text, tasks, nodes), [text, tasks, nodes])

  return (
    <Sheet onClose={onClose}>
      <div className="row">
        <strong className="grow">返答を取り込む</strong>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          閉じる
        </button>
      </div>

      <p className="hint">
        「19:00〜20:00 数学課題」のように、時刻と題名が並んでいる行を拾います。
        見出しや説明の行は読み飛ばします。
      </p>

      <label className="field">
        <span>貼り付け</span>
        <textarea
          rows={8}
          value={text}
          placeholder={'19:00〜20:00 数学課題\n20:10〜20:40 開集合\n21:00〜21:20 英語'}
          onChange={(e) => setText(e.target.value)}
        />
      </label>

      {result.lines.length > 0 && (
        <section className="bucket">
          <h2 className="section">読み取った予定 {result.lines.length}件</h2>
          <div className="timeline">
            {result.lines.map((l) => (
              <div key={`${l.start}-${l.title}`} className="blk">
                <span className="blk-time">
                  {l.start}–{l.end}
                </span>
                <span className="blk-title">{l.title}</span>
                {(l.taskId || l.nodeId) && <span className="tag">紐づけ済み</span>}
              </div>
            ))}
          </div>
          <p className="hint">
            {linkedCount(result.lines)}件が既にあるタスク・学習項目と結びつきました。
            結びついたものだけ、完了したときに実績として記録されます。
          </p>
        </section>
      )}

      {result.overlapping && (
        <Banner alert>
          時間が重なっている行があります。そのまま取り込めますが、予定表としては読みにくくなります。
        </Banner>
      )}

      {result.skipped.length > 0 && (
        <Banner alert>
          読み取れなかった行があります。時刻を「19:00〜20:00」の形にすると読めます。
          <ul>
            {result.skipped.slice(0, 4).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Banner>
      )}

      <button
        type="button"
        className="btn primary"
        disabled={result.lines.length === 0}
        onClick={() => onApply(result)}
      >
        {result.lines.length}件を今日の予定にする
      </button>
      <p className="hint">
        いまの予定表は置き換わりますが、<strong>完了したコマは残します。</strong>
        実績を消してしまわないためです。
      </p>
    </Sheet>
  )
}
