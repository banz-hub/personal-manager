/**
 * 「今やる」タイマー。25 分やって 5 分休む、を 1 セットとして数える。
 *
 * ここが解いている問題は、**実績が一件も貯まらないこと。**
 * これまでは終わってから「何分かかったか」を思い出して打ち込む形だった。
 * 思い出しで書いた数字は当てにならないうえ、打つのが面倒なので結局書かない。
 * 見積もり補正 (estimate.ts)・ふりかえり (review.ts)・週次 (weekly.ts) は
 * どれもその記録を燃料にしているので、燃料が入らないと全部動かない。
 *
 * だから**押すのは「今やる」と「終わり」の 2 つだけ**にして、分数は測って出す。
 * 睡眠の記録が「寝る・起きた」の 2 つで済んでいるのと同じ考え方。
 *
 * ## 時刻を数えない
 *
 * 経過を 1 秒ずつ足していく作りにはしていない。iPhone は画面を消すか
 * アプリを裏に回すと JavaScript を止めるので、数えている側は止まったぶん遅れる。
 * ここでは**押した時刻だけを残して、見るたびに今との差を計算する。**
 * 30 分ぶん止まっていても、復帰した瞬間に正しい値になる。
 *
 * ## 見ていない間を作業にしない
 *
 * その裏返しで、「25 分たったので自動で休憩に入り、5 分たったので次の作業に入り…」を
 * 復帰時にまとめて進めると、**寝ている間に 6 セットやったことになる。**
 * なので進めるのは **1 区間まで**。次の区間まで終わっている＝長く離れていた、
 * とみなして止め、続けるかどうかを本人に聞く (`awayMs`)。
 * 推測で実績を作らない、というのはこのアプリ全体で守っていること。
 */

import type { BlockKind, Phase, PlanBlock, Running } from '../types'
import { todayKey, toMinutes } from './date'

export interface PomodoroConfig {
  /** 作業 1 本の長さ (分) */
  workMin: number
  /** 休憩の長さ (分) */
  breakMin: number
}

/** 区間の予定の長さ (ミリ秒) */
export function lengthMs(kind: Phase['kind'], cfg: PomodoroConfig): number {
  return (kind === 'work' ? cfg.workMin : cfg.breakMin) * 60_000
}

function at(iso: string): number {
  return new Date(iso).getTime()
}

/** 開いている区間 (閉じていないもの)。無ければ null */
export function openPhase(running: Running): Phase | null {
  const last = running.phases[running.phases.length - 1]
  return last && !last.endedAt ? last : null
}

/** 押したときに作る。最初の区間は必ず作業 */
export function start(block: PlanBlock, nowMs: number, date = todayKey()): Running {
  return {
    id: 'running',
    blockId: block.id,
    date,
    title: block.title,
    kind: block.kind,
    taskId: block.taskId,
    nodeId: block.nodeId,
    plannedMin: toMinutes(block.end) - toMinutes(block.start),
    phases: [{ kind: 'work', startedAt: new Date(nowMs).toISOString() }],
  }
}

/** 開いている区間を今この瞬間で閉じる。開いていなければそのまま */
export function closeNow(running: Running, nowMs: number): Running {
  const open = openPhase(running)
  if (!open) return running
  return {
    ...running,
    phases: [
      ...running.phases.slice(0, -1),
      { ...open, endedAt: new Date(nowMs).toISOString() },
    ],
  }
}

/**
 * いまの区間を切り上げて、反対の種類をすぐ始める。
 * 休憩を待たずに次へ行きたいとき・作業を早めに切りたいときの 1 ボタン。
 */
export function skip(running: Running, nowMs: number): Running {
  const open = openPhase(running)
  if (!open) return resume(running, nowMs)
  const closed = closeNow(running, nowMs)
  const next: Phase['kind'] = open.kind === 'work' ? 'break' : 'work'
  return { ...closed, phases: [...closed.phases, { kind: next, startedAt: new Date(nowMs).toISOString() }] }
}

/** 離れていて止まっていたものを、いまから作業として再開する */
export function resume(running: Running, nowMs: number): Running {
  if (openPhase(running)) return running
  return {
    ...running,
    phases: [...running.phases, { kind: 'work', startedAt: new Date(nowMs).toISOString() }],
  }
}

/** その日の実績 (分)。**作業の区間だけ。休憩は入れない** */
export function workedMin(running: Running, nowMs: number): number {
  let ms = 0
  for (const p of running.phases) {
    if (p.kind !== 'work') continue
    ms += (p.endedAt ? at(p.endedAt) : nowMs) - at(p.startedAt)
  }
  return Math.max(0, Math.round(ms / 60_000))
}

/**
 * やりきったセット数。
 *
 * **最後までまわった作業の区間だけ**数える。途中で切ったものは、
 * 実績の分数には入るがセットにはしない。
 * 分数は「実際にどれだけやったか」、セットは「集中を最後まで保てたか」で、
 * 別のことを見ている数字なので、混ぜない。
 */
export function completedSets(running: Running, cfg: PomodoroConfig): number {
  const full = lengthMs('work', cfg)
  return running.phases.filter(
    (p) => p.kind === 'work' && p.endedAt && at(p.endedAt) - at(p.startedAt) >= full - 1000,
  ).length
}

export interface Tick {
  /** 進めたあとの状態。`changed` が true のときだけ保存すればよい */
  running: Running
  changed: boolean
  /** いま走っている区間。離れていて止まっているときは null */
  open: Phase | null
  /** 円をどこまで塗るか (0〜1)。止まっているときは 1 */
  progress: number
  /** 残り (ミリ秒)。止まっているときは 0 */
  remainMs: number
  /**
   * 区間が終わってから経った時間 (ミリ秒)。
   * 0 より大きい＝長く離れていたので、続けるか終わるかを聞く。
   */
  awayMs: number
  /** 実績 (分)。作業のぶんだけ */
  workedMin: number
  /** やりきったセット数 */
  sets: number
  /** この tick で区間が終わったか。通知を出すのはこのときだけ */
  finished: Phase['kind'] | null
}

/**
 * いまの状態を出す。ついでに、終わっている区間があれば閉じて次を開く。
 *
 * 進めるのは **1 区間まで**。次の区間の終わりも過ぎているときは開かない
 * (見ていない間に何セットも進めてしまわないため)。
 */
export function tick(running: Running, cfg: PomodoroConfig, nowMs: number): Tick {
  let next = running
  let changed = false
  let finished: Phase['kind'] | null = null

  const open = openPhase(running)
  if (open) {
    const endMs = at(open.startedAt) + lengthMs(open.kind, cfg)
    if (nowMs >= endMs) {
      // 気づいた時刻ではなく、**終わっていた時刻**で閉じる
      const closed: Phase = { ...open, endedAt: new Date(endMs).toISOString() }
      const phases = [...running.phases.slice(0, -1), closed]
      const nextKind: Phase['kind'] = open.kind === 'work' ? 'break' : 'work'
      // 次の区間の終わりまで過ぎているなら、そこは開かない
      if (nowMs < endMs + lengthMs(nextKind, cfg)) {
        phases.push({ kind: nextKind, startedAt: closed.endedAt as string })
      }
      next = { ...running, phases }
      changed = true
      finished = open.kind
    }
  }

  const nowOpen = openPhase(next)
  if (!nowOpen) {
    const last = next.phases[next.phases.length - 1]
    return {
      running: next,
      changed,
      open: null,
      progress: 1,
      remainMs: 0,
      awayMs: last?.endedAt ? Math.max(0, nowMs - at(last.endedAt)) : 0,
      workedMin: workedMin(next, nowMs),
      sets: completedSets(next, cfg),
      finished,
    }
  }

  const total = lengthMs(nowOpen.kind, cfg)
  const spent = Math.min(total, Math.max(0, nowMs - at(nowOpen.startedAt)))
  return {
    running: next,
    changed,
    open: nowOpen,
    progress: total === 0 ? 1 : spent / total,
    remainMs: total - spent,
    awayMs: 0,
    workedMin: workedMin(next, nowMs),
    sets: completedSets(next, cfg),
    finished,
  }
}

/** 残りを mm:ss で。1 時間を超えることは無い前提 */
export function formatRemain(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 区間が終わったときに出す知らせ */
export function finishedMessage(kind: Phase['kind'], cfg: PomodoroConfig): { title: string; body: string } {
  return kind === 'work'
    ? { title: '1 セット終わりました', body: `${cfg.breakMin}分の休憩に入ります。画面から目を離してください` }
    : { title: '休憩が終わりました', body: `次の${cfg.workMin}分を始めます` }
}

/** タイマーを出してよいコマか。休憩・予備・筋トレは対象外 */
export function canRun(kind: BlockKind): boolean {
  return kind === 'task' || kind === 'study'
}
