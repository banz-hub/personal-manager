/**
 * 1 ページ目。**その日の予定と、その日やることが一目で分かる**ことだけを目的にする。
 *
 * 上から 3 つだけ:
 *   1. 予定 … よてい帳の授業・予定を時刻順に。色は種類ごと（授業は緑、バイトは水色…）
 *   2. やること … タスクの一覧から選んだもの。チェックで済みにする
 *   3. 睡眠 … 何時から何時まで寝たかを 1 行で
 *
 * 時間の割り当て（何時に何をやるかを組む）はしない。やる順番は本人が決める。
 * 前の日・次の日へは上の矢印で動く。週で見たいときは「予定」のタブ。
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import DayTimeline from '../components/DayTimeline'
import RunningCard from '../components/RunningCard'
import TaskForm from '../components/TaskForm'
import { Banner, Empty, Popup, Sheet } from '../components/ui'
import { loadYoteichoDay, type YoteichoDay } from '../lib/bridge/yoteicho'
import { addDays, formatDate, formatDuration, fromMinutes, nowMinutes, todayKey } from '../lib/date'
import {
  candidates,
  carryToNextDay,
  doneOn,
  leftovers,
  listOn,
  logTimer,
  pullLeftovers,
  quickTask,
  toggleDone,
} from '../lib/daylist'
import { measuredMinOn, setsOn, start as startRun, type PomodoroConfig } from '../lib/pomodoro'
import {
  buildReminders,
  scheduleBackground,
  scheduleWhileOpen,
  showNow,
  type PendingReminder,
} from '../lib/reminders'
import { completeStudy } from '../lib/review'
import { recordSleep, summarize } from '../lib/sleep'
import { freeGaps, longest, sleepOn, totalMin } from '../lib/timeline'
import { useApp } from '../state/AppContext'
import type { Running, Task } from '../types'

/** 「今日」「明日」「昨日」。それ以外は日付だけ */
function relativeLabel(date: string, today: string): string {
  if (date === today) return '今日'
  if (date === addDays(today, 1)) return '明日'
  if (date === addDays(today, -1)) return '昨日'
  return ''
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default function TodayPage() {
  const { data, upsert, remove, replaceList } = useApp()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const today = todayKey()
  const requested = params.get('d')
  const date = requested && DATE_RE.test(requested) ? requested : today
  const isToday = date === today
  const settings = data.settings

  const [now, setNow] = useState(() => nowMinutes())
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [yoteicho, setYoteicho] = useState<YoteichoDay | null>(null)
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')
  const [popup, setPopup] = useState<PendingReminder | null>(null)

  const go = (d: string) => {
    setMessage('')
    setParams(d === today ? {} : { d })
  }

  // 「いま」の印がずれないように 1 分ごとに合わせる
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(nowMinutes())
      setNowMs(Date.now())
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // 予定はよてい帳が正本。こちらは読むだけ
  useEffect(() => {
    if (!settings.useYoteicho) {
      setYoteicho({
        available: false,
        items: [],
        slots: [],
        todos: [],
        interests: [],
        reason: 'よてい帳との連携を切ってあります（設定）',
      })
      return
    }
    let alive = true
    setYoteicho(null)
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

  // 締切の少し前と、復習の日に知らせる。今日のぶんだけ
  const reminders = useMemo(
    () =>
      settings.notifyEnabled
        ? buildReminders({
            date: today,
            tasks: data.tasks,
            beforeMin: settings.notifyBeforeMin,
          })
        : [],
    [
      settings.notifyEnabled,
      settings.notifyBeforeMin,
      today,
      data.tasks,
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

  // 学習の試験は時刻を持たないので「終日」として予定の上に出す
  const exams = data.exams.filter((e) => e.date === date)
  const items = useMemo(() => yoteicho?.items ?? [], [yoteicho])

  // 24 時間のうち、予定も睡眠も入っていない時間
  const sleep = useMemo(() => sleepOn(data.sleepLogs, date), [data.sleepLogs, date])
  const gaps = useMemo(() => freeGaps([...items, ...sleep]), [items, sleep])
  const widest = longest(gaps)
  // 今日なら「いまから先」の空きも出す。過ぎた空きはもう使えないので
  const ahead = isToday
    ? totalMin(
        gaps
          .filter((g) => g.endMin > now)
          .map((g) => ({ ...g, startMin: Math.max(g.startMin, now) })),
      )
    : null

  const list = useMemo(() => listOn(data.tasks, date), [data.tasks, date])
  const openCount = list.filter((t) => !doneOn(t, date)).length
  const left = useMemo(() => (isToday ? leftovers(data.tasks, date) : []), [data.tasks, date, isToday])
  const choices = useMemo(() => candidates(data.tasks, date), [data.tasks, date])

  // ---------- タイマー ----------

  const running: Running | null = data.running[0] ?? null
  const pomoCfg: PomodoroConfig = {
    workMin: settings.pomodoroWorkMin,
    breakMin: settings.pomodoroBreakMin,
  }
  const focus = useMemo(
    () => ({
      sets: setsOn(date, [...data.logs, ...data.sessions], running, {
        workMin: settings.pomodoroWorkMin,
        breakMin: settings.pomodoroBreakMin,
      }),
      minutes: measuredMinOn(date, data.logs, data.sessions, running, nowMs),
    }),
    [
      date,
      data.logs,
      data.sessions,
      running,
      nowMs,
      settings.pomodoroWorkMin,
      settings.pomodoroBreakMin,
    ],
  )

  const startTask = (t: Task) => {
    // 2 つ同時に走らせない。どちらの時間なのか分からなくなる
    if (running) {
      setMessage(`「${running.title}」を測っています。先に終わりにしてください`)
      return
    }
    const planned = Math.min(t.chunkMin ?? t.estimateMin, 23 * 60)
    upsert(
      'running',
      startRun(
        { id: `task:${t.id}`, start: '00:00', end: fromMinutes(planned), kind: t.study ? 'study' : 'task', taskId: t.id, title: t.title },
        Date.now(),
        today,
      ),
    )
  }

  /** 止めたら時間とセットだけ残す。済みにするかはチェックで本人が決める */
  const stopRunning = (r: Running, minutes: number, sets: number) => {
    remove('running', 'running')
    // 押してすぐ止めたものは残さない。0 分の記録が並ぶと集計が読みにくくなる
    if (minutes < 1) {
      setMessage('1分未満だったので記録していません')
      return
    }
    const nowIso = new Date().toISOString()
    const task = r.taskId ? data.tasks.find((t) => t.id === r.taskId) : undefined
    const node = r.nodeId ? data.nodes.find((n) => n.id === r.nodeId) : undefined
    if (task) {
      const out = logTimer(task, minutes, sets, r.plannedMin, r.date, nowIso)
      upsert('tasks', out.task)
      upsert('logs', out.log)
    } else if (node) {
      // 前の版で学習を測っていた途中のもの
      const out = completeStudy(node, minutes, r.date)
      upsert('sessions', sets > 0 ? { ...out.session, pomodoros: sets } : out.session)
    } else {
      setMessage('測っていたタスクが見つからないので、記録せずに止めました')
      return
    }
    setMessage(
      `「${r.title}」を${formatDuration(minutes)}${sets > 0 ? `・${sets}セット` : ''}記録しました。` +
        (task ? '終わっていたらチェックを付けてください' : ''),
    )
  }

  // ---------- リスト ----------

  const addDraft = () => {
    if (!draft.trim()) return
    upsert('tasks', quickTask(draft, date, new Date().toISOString()))
    setDraft('')
  }

  const pick = (t: Task) => upsert('tasks', { ...t, pinnedDate: date })

  const toggle = (t: Task) =>
    replaceList('tasks', toggleDone(data.tasks, t.id, date, new Date().toISOString()))

  const carry = () => {
    const r = carryToNextDay(data.tasks, date)
    replaceList('tasks', r.tasks)
    setMessage(`${r.carried.length}件を${formatDate(addDays(date, 1))}へ送りました`)
  }

  const pull = () => {
    const r = pullLeftovers(data.tasks, date)
    replaceList('tasks', r.tasks)
    setMessage(`前の日までの残り${r.carried.length}件を今日に入れました`)
  }

  const rel = relativeLabel(date, today)

  return (
    <div className="page home">
      {/* --- 日付。左右で前の日・次の日 --- */}
      <div className="day-head">
        <button type="button" className="btn ghost day-step" aria-label="前の日" onClick={() => go(addDays(date, -1))}>
          ‹
        </button>
        <div className="day-title">
          <strong>{formatDate(date)}</strong>
          <span className={isToday ? 'day-rel is-today' : 'day-rel'}>{rel || ' '}</span>
        </div>
        <button type="button" className="btn ghost day-step" aria-label="次の日" onClick={() => go(addDays(date, 1))}>
          ›
        </button>
      </div>
      {!isToday && (
        <button type="button" className="btn ghost sm back-today" onClick={() => go(today)}>
          今日に戻る
        </button>
      )}

      {running && (
        <RunningCard
          running={running}
          cfg={pomoCfg}
          onChange={(next) => upsert('running', next)}
          onStop={stopRunning}
        />
      )}

      {message && <Banner>{message}</Banner>}

      {/* --- 予定 --- */}
      <section className="home-sec">
        <div className="home-sec-head">
          <h2 className="section grow">予定</h2>
          <Link className="btn ghost sm" to={`/yotei/calendar?d=${date}`}>
            週で見る
          </Link>
        </div>

        {yoteicho && !yoteicho.available && <p className="dim small">{yoteicho.reason}</p>}

        {exams.map((e) => (
          <div key={e.id} className="ev t-exam">
            <span className="ev-time">終日</span>
            <span className="ev-title">{e.title}</span>
            <span className="tag t-exam">試験</span>
          </div>
        ))}

        {yoteicho === null ? (
          <p className="dim small">読み込み中…</p>
        ) : (
          <>
            <div className="free-sum">
              <span>
                空き 合計 <strong>{formatDuration(totalMin(gaps))}</strong>
                {ahead != null && (
                  <>
                    {' '}
                    ・ いまから <strong>{formatDuration(ahead)}</strong>
                  </>
                )}
              </span>
              {widest && (
                <span className="dim small">
                  いちばん長い空きは {fromMinutes(widest.startMin)}〜
                  {widest.endMin === 1440 ? '24:00' : fromMinutes(widest.endMin)}（
                  {formatDuration(widest.endMin - widest.startMin)}）
                </span>
              )}
              {sleep.length === 0 && (
                <span className="dim small">睡眠が入っていないので、寝ている時間も空きに入っています</span>
              )}
            </div>
            <DayTimeline items={items} sleep={sleep} gaps={gaps} nowMin={isToday ? now : undefined} />
          </>
        )}
      </section>

      {/* --- やること --- */}
      <section className="home-sec">
        <div className="home-sec-head">
          <h2 className="section grow">
            {rel === '今日' ? '今日やること' : 'やること'}
            {list.length > 0 && (
              <span className="count">
                {' '}
                {list.length - openCount}/{list.length}
              </span>
            )}
          </h2>
          {(focus.sets > 0 || focus.minutes > 0) && (
            <span className="dim small">
              集中 {focus.sets}セット・{formatDuration(focus.minutes)}
            </span>
          )}
        </div>

        {left.length > 0 && (
          <div className="leftover">
            <span className="grow">前の日までの残りが{left.length}件あります</span>
            <button type="button" className="btn sm" onClick={pull}>
              今日に入れる
            </button>
          </div>
        )}

        {list.length === 0 ? (
          <Empty>まだ何も入っていません。下で書くか、リストから選んでください</Empty>
        ) : (
          <ul className="todo">
            {list.map((t) => {
              const done = doneOn(t, date)
              return (
                <li key={t.id} className={`todo-row${done ? ' is-done' : ''}${running?.taskId === t.id ? ' is-running' : ''}`}>
                  <button
                    type="button"
                    className="todo-check"
                    role="checkbox"
                    aria-checked={done}
                    aria-label={`${t.title}を${done ? '未完了に戻す' : '済みにする'}`}
                    onClick={() => toggle(t)}
                  >
                    {done ? '✓' : ''}
                  </button>
                  <button
                    type="button"
                    className="todo-title"
                    onClick={() => (t.study ? navigate('/study') : setEditing(t))}
                  >
                    <span>
                      {t.study && <span className="tag study-tag">学習</span>} {t.title}
                    </span>
                    {t.dueDate && (
                      <span className={`todo-due${t.dueDate <= date ? ' is-near' : ''}`}>
                        締切 {t.dueDate === date ? '今日' : t.dueDate.slice(5).replace('-', '/')}
                        {t.dueTime ? ` ${t.dueTime}` : ''}
                      </span>
                    )}
                  </button>
                  {isToday && !done && running?.taskId !== t.id && (
                    <button type="button" className="btn primary sm" onClick={() => startTask(t)}>
                      今やる
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <form
          className="todo-add"
          onSubmit={(e) => {
            e.preventDefault()
            addDraft()
          }}
        >
          <input
            value={draft}
            placeholder="やることを書いて追加"
            aria-label="やることを追加"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn" disabled={!draft.trim()}>
            追加
          </button>
        </form>
        <div className="row tight">
          <button type="button" className="btn ghost sm grow" onClick={() => setPicking(true)}>
            リストから選ぶ{choices.length > 0 ? `（${choices.length}件）` : ''}
          </button>
          {openCount > 0 && date <= today && (
            <button type="button" className="btn ghost sm grow" onClick={carry}>
              残り{openCount}件を翌日へ
            </button>
          )}
        </div>
      </section>

      {/* --- 睡眠 --- */}
      {/* 日付ごとに作り直す。別の日の入力が残ったまま保存されないように */}
      <SleepRow key={date} date={date} />

      {picking && (
        <Sheet onClose={() => setPicking(false)}>
          <div className="row">
            <strong className="grow">{formatDate(date)}に入れる</strong>
            <button type="button" className="btn ghost sm" onClick={() => setPicking(false)}>
              閉じる
            </button>
          </div>
          {choices.length === 0 ? (
            <Empty>
              選べるタスクがありません。<Link to="/tasks">タスク</Link>で一覧に足せます
            </Empty>
          ) : (
            <ul className="todo">
              {choices.map((t) => (
                <li key={t.id} className="todo-row">
                  <button type="button" className="todo-title" onClick={() => pick(t)}>
                    <span>
                      {t.study && <span className="tag study-tag">学習</span>} {t.title}
                    </span>
                    <span className="todo-due">
                      {t.dueDate ? `締切 ${t.dueDate.slice(5).replace('-', '/')}` : ''}
                      {t.pinnedDate ? ` ・${t.pinnedDate.slice(5).replace('-', '/')}のリストから移す` : ''}
                    </span>
                  </button>
                  <button type="button" className="btn sm" onClick={() => pick(t)}>
                    入れる
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}

      {editing && (
        <Sheet onClose={() => setEditing(null)}>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              upsert('tasks', { ...editing, pinnedDate: undefined })
              setEditing(null)
            }}
          >
            このリストから外す（タスクは残ります）
          </button>
          <TaskForm
            initial={editing}
            onSave={(t) => {
              upsert('tasks', t)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
            onDelete={(id) => {
              remove('tasks', id)
              setEditing(null)
            }}
          />
        </Sheet>
      )}

      {popup && <Popup title={popup.title} body={popup.body} onClose={() => setPopup(null)} />}
    </div>
  )
}

/**
 * 睡眠を 1 行で。入っていなければ時刻 2 つを入れる形、入っていれば結果と「直す」。
 * `date` は起きた日。前の晩に寝た分がその日の記録になる。
 */
function SleepRow({ date }: { date: string }) {
  const { data, replaceList } = useApp()
  const s = data.settings
  const summary = summarize(data.sleepLogs, date, s)
  const recorded = summary.minutes > 0 && !summary.ongoing
  const [open, setOpen] = useState(false)
  const [bed, setBed] = useState(summary.bedAt ?? s.targetBedtime)
  const [wake, setWake] = useState(summary.wakeAt ?? '07:00')
  const [error, setError] = useState('')

  const save = () => {
    const next = recordSleep(data.sleepLogs, date, bed, wake)
    if (!next) {
      setError('5分未満か16時間を超えています。時刻を確かめてください')
      return
    }
    replaceList('sleepLogs', next)
    setOpen(false)
    setError('')
  }

  const editing = open || !recorded

  return (
    <section className="home-sec sleep-row">
      <div className="home-sec-head">
        <h2 className="section grow">睡眠</h2>
        {recorded && !open && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              setBed(summary.bedAt ?? s.targetBedtime)
              setWake(summary.wakeAt ?? '07:00')
              setOpen(true)
            }}
          >
            直す
          </button>
        )}
      </div>
      {!editing ? (
        <p className="sleep-line">
          <span>
            {summary.bedAt}〜{summary.wakeAt}
          </span>
          <strong>{formatDuration(summary.minutes)}</strong>
          <span className="dim small">
            目標比 {summary.diffMin >= 0 ? '+' : '−'}
            {formatDuration(Math.abs(summary.diffMin))}
          </span>
        </p>
      ) : (
        <>
          <div className="sleep-form">
            <label>
              <span className="dim small">寝た</span>
              <input type="time" value={bed} onChange={(e) => setBed(e.target.value)} />
            </label>
            <span className="dim">〜</span>
            <label>
              <span className="dim small">起きた</span>
              <input type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
            </label>
            <button type="button" className="btn primary" onClick={save}>
              記録
            </button>
          </div>
          {error && <p className="warn">{error}</p>}
        </>
      )}
    </section>
  )
}
