/**
 * 「今日やること」のリスト。
 *
 * タスクの一覧（全部）から選んだものを、その日のリストとして出す。
 * 何時にやるかは決めない。**時間の割り当てはしない**のが、このリストの約束。
 *
 * どの日のリストに入っているかは `Task.pinnedDate` 1 つで持つ。
 * 別の表を作らないのは、タスクを消したときにリストだけ残る、
 * といった食い違いが起きないようにするため。1 つのタスクが載る日は 1 日だけ。
 */

import type { Task, TaskLog } from '../types'
import { addDays } from './date'
import { newId } from './id'
import { nextOccurrence } from './repeat'

export function isOpen(t: Task): boolean {
  return t.status === 'todo' || t.status === 'doing'
}

/**
 * その日のリストで済みになっているか。
 * 学習のタスクは何日も続くので、タスクの状態ではなく「その日のぶん済み」の印で見る。
 */
export function doneOn(t: Task, date: string): boolean {
  if (t.study && isOpen(t)) return t.checkedOn === date
  return !isOpen(t)
}

/** その日のリスト。まだのものが上、済んだものは下へ。それぞれ入れた順 */
export function listOn(tasks: Task[], date: string): Task[] {
  return tasks
    .filter((t) => t.pinnedDate === date && t.status !== 'dropped')
    .sort((a, b) => {
      const ad = doneOn(a, date) ? 1 : 0
      const bd = doneOn(b, date) ? 1 : 0
      if (ad !== bd) return ad - bd
      return a.createdAt.localeCompare(b.createdAt)
    })
}

/**
 * リストに入れられる候補。まだ終わっていなくて、その日のリストに入っていないもの。
 *
 * 締切が近いものほど上に出す。締切の無いものは作った順で下に並べる。
 * 別の日のリストに入っているものも出す（選べば、こちらの日へ移る）。
 */
export function candidates(tasks: Task[], date: string): Task[] {
  return tasks
    .filter((t) => isOpen(t) && t.pinnedDate !== date)
    .sort((a, b) => {
      const ad = a.dueDate ?? '9999-99-99'
      const bd = b.dueDate ?? '9999-99-99'
      if (ad !== bd) return ad.localeCompare(bd)
      return a.createdAt.localeCompare(b.createdAt)
    })
}

/** その場で書いて、そのままその日のリストに入れる */
export function quickTask(title: string, date: string, nowIso: string): Task {
  return {
    id: newId('task'),
    title: title.trim(),
    area: 'other',
    status: 'todo',
    estimateMin: 30,
    importance: 2,
    createdAt: nowIso,
    pinnedDate: date,
  }
}

/**
 * チェックを付ける・外す。
 *
 * 繰り返しのタスクは、チェックを付けたときに次の回を作る。
 * ただし同じ次の回がもうあれば作らない。付けて・外して・また付けると、
 * そのたびに次の回が増えてしまうため。
 */
export function toggleDone(tasks: Task[], id: string, date: string, nowIso: string): Task[] {
  const task = tasks.find((t) => t.id === id)
  if (!task) return tasks

  // 学習はタスクを終わらせず、その日のぶん済みの印だけ付け外しする
  if (task.study && isOpen(task)) {
    const next: Task =
      task.checkedOn === date
        ? { ...task, checkedOn: undefined }
        : { ...task, checkedOn: date, lastWorkedOn: date }
    return tasks.map((t) => (t.id === id ? next : t))
  }

  if (!isOpen(task)) {
    const reopened: Task = {
      ...task,
      status: task.startedAt ? 'doing' : 'todo',
      doneAt: undefined,
    }
    return tasks.map((t) => (t.id === id ? reopened : t))
  }

  const done: Task = { ...task, status: 'done', doneAt: nowIso, lastWorkedOn: date }
  const next = nextOccurrence(done, date, nowIso)
  const updated = tasks.map((t) => (t.id === id ? done : t))
  if (!next) return updated

  const already = tasks.some(
    (t) =>
      t.id !== id &&
      isOpen(t) &&
      t.title === next.title &&
      t.dueDate === next.dueDate &&
      JSON.stringify(t.repeat) === JSON.stringify(next.repeat),
  )
  // 次の回は、その日になったら選び直す。勝手に先の日のリストへは入れない
  return already ? updated : [...updated, { ...next, pinnedDate: undefined }]
}

export interface CarryResult {
  tasks: Task[]
  /** 送ったタスクの id */
  carried: string[]
}

/**
 * その日に終わらなかったものを、次の日のリストへ送る。
 * 締切は動かさない。送った回数だけ数えておく。
 */
export function carryToNextDay(tasks: Task[], date: string): CarryResult {
  const nextDay = addDays(date, 1)
  const carried: string[] = []
  const next = tasks.map((t) => {
    if (t.pinnedDate !== date || doneOn(t, date)) return t
    carried.push(t.id)
    return {
      ...t,
      pinnedDate: nextDay,
      deferCount: (t.deferCount ?? 0) + 1,
      deferredOn: date,
    }
  })
  return { tasks: next, carried }
}

/**
 * タイマーで測った時間を残す。**チェックは付けない。**
 *
 * 測り終えた = 終わった、とは限らない（25 分やって続きは明日、はよくある）。
 * 終わったかどうかはチェックで本人が決める。ここは時間の記録だけ。
 */
export function logTimer(
  task: Task,
  minutes: number,
  sets: number,
  plannedMin: number,
  date: string,
  nowIso: string,
): { task: Task; log: TaskLog } {
  return {
    task: {
      ...task,
      status: task.status === 'todo' ? 'doing' : task.status,
      startedAt: task.startedAt ?? nowIso,
      lastWorkedOn: date,
    },
    log: {
      id: newId('log'),
      taskId: task.id,
      date,
      area: task.area,
      plannedMin,
      actualMin: minutes,
      ...(sets > 0 ? { pomodoros: sets } : {}),
      createdAt: nowIso,
    },
  }
}

/**
 * 前の日までのリストに入れたまま終わっていないもの。
 * 送り忘れた晩があっても、次に開いた日に拾えるようにする。
 */
export function leftovers(tasks: Task[], date: string): Task[] {
  return tasks.filter(
    (t) => t.pinnedDate != null && t.pinnedDate < date && !doneOn(t, t.pinnedDate),
  )
}

/** 前の日までの残りを、その日のリストへまとめて移す */
export function pullLeftovers(tasks: Task[], date: string): CarryResult {
  const carried: string[] = []
  const next = tasks.map((t) => {
    if (t.pinnedDate == null || t.pinnedDate >= date || doneOn(t, t.pinnedDate)) return t
    carried.push(t.id)
    return { ...t, pinnedDate: date, deferCount: (t.deferCount ?? 0) + 1, deferredOn: t.pinnedDate }
  })
  return { tasks: next, carried }
}
