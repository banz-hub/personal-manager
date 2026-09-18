import { describe, expect, it } from 'vitest'
import type { Task } from '../types'
import {
  candidates,
  carryToNextDay,
  leftovers,
  listOn,
  logTimer,
  pullLeftovers,
  quickTask,
  toggleDone,
} from './daylist'

const NOW = '2026-09-18T09:00:00.000Z'
const D = '2026-09-18'

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    area: 'other',
    status: 'todo',
    estimateMin: 30,
    importance: 2,
    createdAt: `2026-09-01T00:00:0${id.length}.000Z`,
    ...patch,
  }
}

describe('その日のリスト', () => {
  it('その日に入れたものだけ。済んだものは下', () => {
    const tasks = [
      task('a', { pinnedDate: D, status: 'done' }),
      task('b', { pinnedDate: D }),
      task('c', { pinnedDate: '2026-09-19' }),
      task('d'),
      task('e', { pinnedDate: D, status: 'dropped' }),
    ]
    expect(listOn(tasks, D).map((t) => t.id)).toEqual(['b', 'a'])
  })

  it('候補は未完了で、その日に入っていないもの。締切の近い順', () => {
    const tasks = [
      task('none'),
      task('late', { dueDate: '2026-09-30' }),
      task('soon', { dueDate: '2026-09-19' }),
      task('in', { pinnedDate: D }),
      task('done', { status: 'done' }),
      task('other-day', { pinnedDate: '2026-09-17' }),
    ]
    expect(candidates(tasks, D).map((t) => t.id)).toEqual(['soon', 'late', 'none', 'other-day'])
  })

  it('その場で書いたものは、その日に入る', () => {
    const t = quickTask('  レポート  ', D, NOW)
    expect(t.title).toBe('レポート')
    expect(t.pinnedDate).toBe(D)
    expect(t.status).toBe('todo')
  })
})

describe('チェック', () => {
  it('付けると完了、外すと戻る', () => {
    let tasks = [task('a', { pinnedDate: D })]
    tasks = toggleDone(tasks, 'a', D, NOW)
    expect(tasks[0].status).toBe('done')
    expect(tasks[0].doneAt).toBe(NOW)
    tasks = toggleDone(tasks, 'a', D, NOW)
    expect(tasks[0].status).toBe('todo')
    expect(tasks[0].doneAt).toBeUndefined()
  })

  it('繰り返しは次の回を作る。付け直しても増えない', () => {
    let tasks = [task('a', { pinnedDate: D, repeat: { kind: 'daily' }, dueDate: D })]
    tasks = toggleDone(tasks, 'a', D, NOW)
    expect(tasks).toHaveLength(2)
    expect(tasks[1].dueDate).toBe('2026-09-19')
    // 次の回は勝手にリストへ入れない
    expect(tasks[1].pinnedDate).toBeUndefined()

    tasks = toggleDone(tasks, 'a', D, NOW)
    tasks = toggleDone(tasks, 'a', D, NOW)
    expect(tasks).toHaveLength(2)
  })
})

describe('次の日へ送る', () => {
  it('終わっていないものだけ送り、送った回数を数える', () => {
    const tasks = [
      task('open', { pinnedDate: D }),
      task('done', { pinnedDate: D, status: 'done' }),
      task('other', { pinnedDate: '2026-09-17' }),
    ]
    const r = carryToNextDay(tasks, D)
    expect(r.carried).toEqual(['open'])
    const open = r.tasks.find((t) => t.id === 'open')!
    expect(open.pinnedDate).toBe('2026-09-19')
    expect(open.deferCount).toBe(1)
    expect(r.tasks.find((t) => t.id === 'done')!.pinnedDate).toBe(D)
    expect(r.tasks.find((t) => t.id === 'other')!.pinnedDate).toBe('2026-09-17')
  })
})

describe('タイマーの記録', () => {
  it('時間とセットを残すが、完了にはしない', () => {
    const { task: t, log } = logTimer(task('a'), 50, 2, 30, D, NOW)
    expect(t.status).toBe('doing')
    expect(log).toMatchObject({ taskId: 'a', actualMin: 50, plannedMin: 30, pomodoros: 2, date: D })
  })

  it('1 セットに届かなかったときはセットを付けない', () => {
    const { log } = logTimer(task('a'), 10, 0, 30, D, NOW)
    expect(log.pomodoros).toBeUndefined()
  })
})

describe('前の日までの残り', () => {
  it('過去の日に入れたまま終わっていないものを、その日へ移す', () => {
    const tasks = [
      task('old', { pinnedDate: '2026-09-15' }),
      task('old-done', { pinnedDate: '2026-09-15', status: 'done' }),
      task('today', { pinnedDate: D }),
      task('future', { pinnedDate: '2026-09-20' }),
    ]
    expect(leftovers(tasks, D).map((t) => t.id)).toEqual(['old'])
    const r = pullLeftovers(tasks, D)
    expect(r.carried).toEqual(['old'])
    expect(listOn(r.tasks, D).map((t) => t.id).sort()).toEqual(['old', 'today'])
  })
})
