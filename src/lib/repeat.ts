/**
 * 繰り返しのタスク。
 *
 * 「毎週月曜の課題」のように、終わってもまた出てくるもの。
 * 継続タスク (recurring) とは別物で、あちらは 1 つのものを毎日すこしずつ進める。
 * こちらは **終わったら次の回を作る**。
 */

import type { Task, TaskRepeat } from '../types'
import { addDays, parseDate, dateKey } from './date'
import { newId } from './id'

export const REPEAT_LABELS: Record<TaskRepeat['kind'], string> = {
  daily: '毎日',
  weekly: '毎週',
  monthly: '毎月',
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

export function repeatLabel(repeat: TaskRepeat): string {
  if (repeat.kind === 'daily') return '毎日'
  if (repeat.kind === 'monthly') return `毎月${repeat.dayOfMonth ?? 1}日`
  const days = (repeat.days ?? []).map((d) => WEEK[d]).join('・')
  return days ? `毎週${days}` : '毎週'
}

/**
 * その日より後で、次に当てはまる日を返す。
 * 当てはまる日が見つからないとき (曜日を 1 つも選んでいないなど) は null。
 */
export function nextDate(repeat: TaskRepeat, from: string): string | null {
  if (repeat.kind === 'daily') return addDays(from, 1)

  if (repeat.kind === 'weekly') {
    const days = repeat.days ?? []
    if (days.length === 0) return null
    // 翌日から 7 日ぶん見れば、必ずどれかに当たる
    for (let i = 1; i <= 7; i++) {
      const d = addDays(from, i)
      if (days.includes(parseDate(d).getDay())) return d
    }
    return null
  }

  // monthly。指定した日が無い月 (2月30日など) は、その月の最終日に寄せる
  const target = Math.min(31, Math.max(1, repeat.dayOfMonth ?? 1))
  const base = parseDate(from)
  // 同じ月の後半に当たることもあるので、今月から見る
  for (let i = 0; i <= 12; i++) {
    const y = base.getFullYear()
    const m = base.getMonth() + i
    const lastDay = new Date(y, m + 1, 0).getDate()
    const day = Math.min(target, lastDay)
    const candidate = dateKey(new Date(y, m, day))
    if (candidate > from) return candidate
  }
  return null
}

/**
 * 繰り返しのタスクを終えたとき、次の回を作る。
 * 実績 (先送り回数など) は引き継がない。次の回は新しく始まる。
 */
export function nextOccurrence(task: Task, doneOn: string, now: string): Task | null {
  if (!task.repeat) return null
  const base = task.dueDate ?? doneOn
  const next = nextDate(task.repeat, base > doneOn ? base : doneOn)
  if (!next) return null

  return {
    ...task,
    id: newId('task'),
    status: 'todo',
    dueDate: next,
    startedAt: undefined,
    doneAt: undefined,
    deferCount: undefined,
    deferredOn: undefined,
    lastWorkedOn: undefined,
    createdAt: now,
  }
}

/** その日が繰り返しの当日か */
export function occursOn(repeat: TaskRepeat, date: string): boolean {
  if (repeat.kind === 'daily') return true
  if (repeat.kind === 'weekly') return (repeat.days ?? []).includes(parseDate(date).getDay())
  const d = parseDate(date)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return d.getDate() === Math.min(repeat.dayOfMonth ?? 1, lastDay)
}
