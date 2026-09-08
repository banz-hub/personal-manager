/**
 * 走っているタイマーの札。今日の画面のいちばん上に出す。
 *
 * ここは**表示と押した合図だけ。**時間の計算は lib/pomodoro.ts にある。
 * 画面の中で計算すると、テストを書くのに画面ごと立ち上げることになるため。
 */

import { useEffect, useRef, useState } from 'react'
import PomodoroRing from './PomodoroRing'
import {
  completedSets,
  finishedMessage,
  formatRemain,
  skip as skipPhase,
  resume,
  tick,
  workedMin,
  type PomodoroConfig,
} from '../lib/pomodoro'
import { formatDuration } from '../lib/date'
import { showNow } from '../lib/reminders'
import { KIND_LABELS, type Running } from '../types'

/** 最後に閉じた区間の終わり時刻。同じ知らせを二度出さないための目印 */
function lastClosedAt(running: Running): string {
  for (let i = running.phases.length - 1; i >= 0; i--) {
    const e = running.phases[i].endedAt
    if (e) return e
  }
  return ''
}

export default function RunningCard({
  running,
  cfg,
  onChange,
  onStop,
}: {
  running: Running
  cfg: PomodoroConfig
  onChange: (next: Running) => void
  onStop: (next: Running, minutes: number, sets: number) => void
}) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const notified = useRef('')

  // 1 秒ごとに「いまの時刻」を新しくするだけ。経過を足していく作りにはしない
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    // 裏から戻ったときは、次の 1 秒を待たずに合わせる
    const wake = () => setNowMs(Date.now())
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])

  const t = tick(running, cfg, nowMs)

  // 区間が終わっていたら、閉じた結果を保存して知らせる
  useEffect(() => {
    if (!t.changed) return
    onChange(t.running)
    if (!t.finished) return
    const key = lastClosedAt(t.running)
    if (key === notified.current) return
    notified.current = key
    const { title, body } = finishedMessage(t.finished, cfg)
    void showNow(title, body)
  })

  const stalled = t.open === null
  const awayMin = Math.round(t.awayMs / 60_000)

  const stop = () => {
    // 開いている区間は今この瞬間で閉じてから記録に回す
    const closed = t.open
      ? {
          ...t.running,
          phases: [
            ...t.running.phases.slice(0, -1),
            { ...t.open, endedAt: new Date(nowMs).toISOString() },
          ],
        }
      : t.running
    onStop(closed, workedMin(closed, nowMs), completedSets(closed, cfg))
  }

  return (
    <section className={`card pomo${stalled ? ' is-stalled' : ` k-${t.open?.kind}`}`}>
      <div className="pomo-head">
        <span className={`tag k-${running.kind}`}>{KIND_LABELS[running.kind]}</span>
        <strong className="grow">{running.title}</strong>
      </div>

      <div className="pomo-body">
        <PomodoroRing
          progress={t.progress}
          label={stalled ? '—' : formatRemain(t.remainMs)}
          sub={stalled ? '止まっています' : t.open?.kind === 'work' ? '作業' : '休憩'}
          kind={t.open?.kind ?? 'work'}
          stalled={stalled}
        />

        <div className="pomo-side">
          <div className="pomo-sets">
            <span className="v">{t.sets}</span>
            <span className="k">セット</span>
          </div>
          <div className="dim">
            やった時間 {formatDuration(t.workedMin)}
            <br />
            予定 {formatDuration(running.plannedMin)}
          </div>
        </div>
      </div>

      {stalled ? (
        <>
          <p className="warn">
            {awayMin > 0 ? `${formatDuration(awayMin)}` : 'しばらく'}
            、画面から離れていました。
            <strong>見ていない間は作業にしていません。</strong>
          </p>
          <div className="row">
            <button type="button" className="btn primary grow" onClick={() => onChange(resume(running, nowMs))}>
              いまから続ける
            </button>
            <button type="button" className="btn grow" onClick={stop}>
              ここまでで記録する
            </button>
          </div>
        </>
      ) : (
        <div className="row">
          <button
            type="button"
            className="btn grow"
            onClick={() => onChange(skipPhase(running, nowMs))}
          >
            {t.open?.kind === 'work' ? `休憩に入る` : `次の${cfg.workMin}分へ`}
          </button>
          <button type="button" className="btn primary grow" onClick={stop}>
            終わりにする
          </button>
        </div>
      )}
    </section>
  )
}
