/**
 * タイマーは「押した時刻の引き算」でできている。
 * ここで見るのは、**画面を見ていない間に何が起きるか**がほとんど。
 * 実際に 25 分待つわけにはいかないので、時刻を渡して確かめる。
 */

import { describe, expect, it } from 'vitest'
import {
  canRun,
  closeNow,
  completedSets,
  formatRemain,
  measuredMinOn,
  setsOn,
  openPhase,
  resume,
  skip,
  start,
  tick,
  workedMin,
  type PomodoroConfig,
} from './pomodoro'
import type { PlanBlock, Running } from '../types'

const cfg: PomodoroConfig = { workMin: 25, breakMin: 5 }
const MIN = 60_000

/** 2026-09-08 10:00:00 を起点にする */
const T0 = new Date('2026-09-08T10:00:00.000Z').getTime()
const iso = (ms: number) => new Date(ms).toISOString()

const block: PlanBlock = {
  id: 'blk1',
  start: '10:00',
  end: '11:30',
  kind: 'study',
  nodeId: 'nd1',
  title: '複素解析学B',
}

describe('start', () => {
  it('最初の区間は必ず作業', () => {
    const r = start(block, T0, '2026-09-08')
    expect(r.phases).toHaveLength(1)
    expect(r.phases[0].kind).toBe('work')
    expect(r.phases[0].endedAt).toBeUndefined()
  })

  it('コマの写しを持つ。予定表を作り直しても測っているものが消えない', () => {
    const r = start(block, T0)
    expect(r.title).toBe('複素解析学B')
    expect(r.kind).toBe('study')
    expect(r.nodeId).toBe('nd1')
    // 10:00–11:30 なので 90 分
    expect(r.plannedMin).toBe(90)
  })
})

describe('tick', () => {
  it('作業の途中では、残りと塗る量を出す', () => {
    const r = start(block, T0)
    const t = tick(r, cfg, T0 + 10 * MIN)
    expect(t.changed).toBe(false)
    expect(t.open?.kind).toBe('work')
    expect(t.remainMs).toBe(15 * MIN)
    expect(t.progress).toBeCloseTo(10 / 25)
  })

  it('25分たつと休憩に入る', () => {
    const r = start(block, T0)
    const t = tick(r, cfg, T0 + 26 * MIN)
    expect(t.changed).toBe(true)
    expect(t.finished).toBe('work')
    expect(t.open?.kind).toBe('break')
    expect(t.sets).toBe(1)
  })

  it('区間は「気づいた時刻」ではなく「終わっていた時刻」で閉じる', () => {
    // 25分で終わるはずが、27分後にはじめて画面を見た場合
    const r = start(block, T0)
    const t = tick(r, cfg, T0 + 27 * MIN)
    const work = t.running.phases[0]
    expect(work.endedAt).toBe(iso(T0 + 25 * MIN))
    // 休憩は作業が終わった時刻から始まっている。2分ぶん進んでいる
    expect(t.running.phases[1].startedAt).toBe(iso(T0 + 25 * MIN))
    expect(t.remainMs).toBe(3 * MIN)
    // 気づくのが遅れても、実績は 25 分のまま増えない
    expect(t.workedMin).toBe(25)
  })

  it('休憩が終わると次の作業に入る', () => {
    const r = start(block, T0)
    const afterWork = tick(r, cfg, T0 + 25 * MIN).running
    const t = tick(afterWork, cfg, T0 + 31 * MIN)
    expect(t.finished).toBe('break')
    expect(t.open?.kind).toBe('work')
    expect(t.running.phases).toHaveLength(3)
  })
})

describe('見ていない間を作業にしない', () => {
  it('次の区間まで過ぎているときは、勝手に進めずに止める', () => {
    // 押したまま 3 時間放置した（寝てしまった）
    const r = start(block, T0)
    const t = tick(r, cfg, T0 + 180 * MIN)

    // 作業の 25 分は成立している。そこで止まる
    expect(t.running.phases).toHaveLength(1)
    expect(t.open).toBeNull()
    expect(t.workedMin).toBe(25)
    expect(t.sets).toBe(1)
    // 155 分ぶん離れていたことを画面に出せる
    expect(Math.round(t.awayMs / MIN)).toBe(155)
  })

  it('何時間放置しても、セットは勝手に増えない', () => {
    const r = start(block, T0)
    const a = tick(r, cfg, T0 + 24 * 60 * MIN)
    // 丸一日たっても、成立するのは最初の 1 セットだけ
    expect(a.sets).toBe(1)
    expect(a.workedMin).toBe(25)
    // もう一度見ても増えない（同じ計算を繰り返すだけ）
    expect(tick(a.running, cfg, T0 + 48 * 60 * MIN).sets).toBe(1)
  })

  it('止まったあと「いまから続ける」で作業を開き直す', () => {
    const stopped = tick(start(block, T0), cfg, T0 + 180 * MIN).running
    const back = resume(stopped, T0 + 180 * MIN)
    expect(openPhase(back)?.kind).toBe('work')
    // 離れていた 155 分は実績に入らない
    expect(workedMin(back, T0 + 185 * MIN)).toBe(30)
  })
})

describe('セットの数え方', () => {
  it('最後までまわった作業だけ数える', () => {
    const r = start(block, T0)
    // 25 分やりきった → 1 セット
    const done = tick(r, cfg, T0 + 25 * MIN).running
    expect(completedSets(done, cfg)).toBe(1)
  })

  it('途中で切った作業は、実績には入るがセットにはしない', () => {
    const r = start(block, T0)
    const cut = closeNow(r, T0 + 12 * MIN)
    expect(workedMin(cut, T0 + 12 * MIN)).toBe(12)
    expect(completedSets(cut, cfg)).toBe(0)
  })

  it('休憩は実績に入らない', () => {
    const r = start(block, T0)
    const t = tick(r, cfg, T0 + 28 * MIN)
    // 25 分の作業 + 3 分の休憩 → 実績は 25 分
    expect(t.workedMin).toBe(25)
  })
})

describe('skip', () => {
  it('作業中に押すと休憩へ切り替わる', () => {
    const r = start(block, T0)
    const next = skip(r, T0 + 12 * MIN)
    expect(next.phases[0].endedAt).toBe(iso(T0 + 12 * MIN))
    expect(openPhase(next)?.kind).toBe('break')
    // やりきっていないのでセットにはならない
    expect(completedSets(next, cfg)).toBe(0)
  })

  it('休憩中に押すと次の作業へ進む', () => {
    const inBreak = tick(start(block, T0), cfg, T0 + 26 * MIN).running
    const next = skip(inBreak, T0 + 27 * MIN)
    expect(openPhase(next)?.kind).toBe('work')
    expect(completedSets(next, cfg)).toBe(1)
  })

  it('止まっているときに押すと、作業として開き直す', () => {
    const stopped = tick(start(block, T0), cfg, T0 + 180 * MIN).running
    expect(openPhase(skip(stopped, T0 + 180 * MIN))?.kind).toBe('work')
  })
})

describe('設定を変えたとき', () => {
  it('長さの設定を変えても、すでに閉じた区間の実績は動かない', () => {
    const r = start(block, T0)
    const done = tick(r, cfg, T0 + 25 * MIN).running
    // あとから 50 分設定に変えた
    const wide: PomodoroConfig = { workMin: 50, breakMin: 10 }
    expect(workedMin(done, T0 + 25 * MIN)).toBe(25)
    // ただし「やりきった」の基準は変わるので、セットには数えなくなる
    expect(completedSets(done, wide)).toBe(0)
  })
})

describe('formatRemain', () => {
  it('mm:ss で出す', () => {
    expect(formatRemain(25 * MIN)).toBe('25:00')
    expect(formatRemain(65_000)).toBe('1:05')
    expect(formatRemain(0)).toBe('0:00')
    // マイナスにはしない
    expect(formatRemain(-5000)).toBe('0:00')
  })
})

describe('その日のセット数', () => {
  const D = '2026-09-08'

  it('終えた記録を足す', () => {
    expect(setsOn(D, [{ date: D, pomodoros: 2 }, { date: D, pomodoros: 1 }])).toBe(3)
  })

  it('別の日は数えない', () => {
    expect(setsOn(D, [{ date: '2026-09-07', pomodoros: 5 }, { date: D, pomodoros: 1 }])).toBe(1)
  })

  it('手で付けた記録は 0 として数える', () => {
    // タイマーを使っていないので、セットという単位が無い
    expect(setsOn(D, [{ date: D }, { date: D, pomodoros: 2 }])).toBe(2)
  })

  it('走っている最中のぶんも足す', () => {
    // 終わるまで 0 のままだと「3セットやったのに今日0セット」と出てしまう
    const r = tick(start(block, T0, D), cfg, T0 + 25 * MIN).running
    expect(setsOn(D, [{ date: D, pomodoros: 2 }], r, cfg)).toBe(3)
  })

  it('走っているものが別の日のものなら足さない', () => {
    const r = tick(start(block, T0, '2026-09-07'), cfg, T0 + 25 * MIN).running
    expect(setsOn(D, [{ date: D, pomodoros: 2 }], r, cfg)).toBe(2)
  })
})

describe('その日に測った時間', () => {
  const D = '2026-09-08'

  it('タイマーで測った記録だけ集める', () => {
    const min = measuredMinOn(
      D,
      [
        { date: D, actualMin: 30, pomodoros: 1 },
        // 手で付けた記録。測っていないので入れない
        { date: D, actualMin: 90 },
      ],
      [{ date: D, minutes: 25, pomodoros: 1 }],
    )
    expect(min).toBe(55)
  })

  it('走っている最中のぶんも足す', () => {
    const r = start(block, T0, D)
    expect(measuredMinOn(D, [], [], r, T0 + 10 * MIN)).toBe(10)
  })
})

describe('canRun', () => {
  it('結びつけ先があるタスクと学習は測る', () => {
    expect(canRun({ kind: 'task', taskId: 'tk1' })).toBe(true)
    expect(canRun({ kind: 'study', nodeId: 'nd1' })).toBe(true)
  })

  it('よてい帳の趣味・やることから足したコマは測らない', () => {
    // 種類は「タスク」だが taskId を持たない。正本があちらにあるので
    // 実績のログが作られず、測っても何も残らない。
    // 押せるのに残らないほうが分かりにくいので、そもそも出さない
    expect(canRun({ kind: 'task', title: '読書' } as never)).toBe(false)
    expect(canRun({ kind: 'study' } as never)).toBe(false)
  })

  it('筋トレは測らない。記録は筋トレログの担当で、二重入力になる', () => {
    expect(canRun({ kind: 'workout' } as never)).toBe(false)
  })

  it('休憩・予備・動かせない予定は測らない', () => {
    expect(canRun({ kind: 'break' } as never)).toBe(false)
    expect(canRun({ kind: 'buffer' } as never)).toBe(false)
    expect(canRun({ kind: 'fixed' } as never)).toBe(false)
  })
})

describe('走るのは1件だけ', () => {
  it('id が固定なので、upsert すると必ず置き換わる', () => {
    const a: Running = start(block, T0)
    const b: Running = start({ ...block, id: 'blk2', title: '代数学1B' }, T0 + MIN)
    expect(a.id).toBe('running')
    expect(b.id).toBe(a.id)
  })
})
