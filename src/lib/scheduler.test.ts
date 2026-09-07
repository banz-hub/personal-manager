import { describe, expect, it } from 'vitest'
import type { Settings, Task } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { toMinutes } from './date'
import { rankTasks } from './priority'
import { generatePlan, subtractBusy, usableSlots, workMinutes, type FreeSlot } from './scheduler'

const TODAY = '2026-09-07'

function task(patch: Partial<Task> & { id: string; title: string }): Task {
  return {
    area: 'other',
    status: 'todo',
    estimateMin: 60,
    importance: 2,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...patch,
  }
}

function slot(start: string, end: string, label?: string): FreeSlot {
  return { startMin: toMinutes(start), endMin: toMinutes(end), label }
}

function plan(tasks: Task[], slots: FreeSlot[], now = toMinutes('18:00'), s?: Partial<Settings>) {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...s }
  const ranked = rankTasks({
    tasks,
    logs: [],
    today: TODAY,
    now,
    availableMin: slots.reduce((sum, x) => sum + (x.endMin - x.startMin), 0),
  })
  return generatePlan({ slots, ranked, settings, today: TODAY, now })
}

describe('使える空き時間の切り出し', () => {
  it('もう過ぎた時間は切り落とす', () => {
    const out = usableSlots([slot('18:00', '22:00')], toMinutes('20:00'), 20)
    expect(out[0].startMin).toBe(toMinutes('20:00'))
  })

  it('短すぎる隙間は捨てる', () => {
    const out = usableSlots([slot('18:00', '18:10'), slot('19:00', '20:00')], 0, 20)
    expect(out).toHaveLength(1)
    expect(out[0].startMin).toBe(toMinutes('19:00'))
  })

  it('完全に過ぎた空き時間は残らない', () => {
    expect(usableSlots([slot('09:00', '12:00')], toMinutes('18:00'), 20)).toHaveLength(0)
  })
})

describe('詰め込みすぎない', () => {
  it('空き時間の8割までしか作業を入れない', () => {
    // 4時間 = 240分の空き。上限は192分
    const tasks = [
      task({ id: 'a', title: 'A', estimateMin: 90, dueDate: TODAY }),
      task({ id: 'b', title: 'B', estimateMin: 90, dueDate: '2026-09-08' }),
      task({ id: 'c', title: 'C', estimateMin: 90, dueDate: '2026-09-09' }),
      task({ id: 'd', title: 'D', estimateMin: 90, dueDate: '2026-09-10' }),
    ]
    const p = plan(tasks, [slot('18:00', '22:00')])

    expect(workMinutes(p)).toBeLessThanOrEqual(192)
    expect(p.fillRatio).toBeLessThanOrEqual(0.8)
  })

  it('余った時間はバッファとして残る', () => {
    const p = plan([task({ id: 'a', title: 'A', estimateMin: 60 })], [slot('18:00', '22:00')])
    const buffer = p.blocks.filter((b) => b.kind === 'buffer')
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('入りきらないときは理由を残す', () => {
    const tasks = [
      task({ id: 'a', title: 'A', estimateMin: 120, dueDate: TODAY }),
      task({ id: 'b', title: 'B', estimateMin: 120, dueDate: TODAY }),
      task({ id: 'c', title: 'C', estimateMin: 120, dueDate: TODAY }),
    ]
    const p = plan(tasks, [slot('18:00', '22:00')])
    expect(p.notes.join()).toContain('崩れない範囲')
  })
})

describe('休憩', () => {
  it('続けて作業する時間が上限を超えたら休憩が入る', () => {
    const tasks = [
      task({ id: 'a', title: 'A', estimateMin: 60, dueDate: TODAY }),
      task({ id: 'b', title: 'B', estimateMin: 45, dueDate: '2026-09-08' }),
      task({ id: 'c', title: 'C', estimateMin: 30, dueDate: '2026-09-09' }),
    ]
    const p = plan(tasks, [slot('18:00', '23:00')])
    expect(p.blocks.filter((b) => b.kind === 'break').length).toBeGreaterThan(0)
  })

  it('休憩の直後は作業から再開する', () => {
    const tasks = [
      task({ id: 'a', title: 'A', estimateMin: 60, dueDate: TODAY }),
      task({ id: 'b', title: 'B', estimateMin: 45, dueDate: '2026-09-08' }),
    ]
    const p = plan(tasks, [slot('18:00', '23:00')])
    const i = p.blocks.findIndex((b) => b.kind === 'break')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(p.blocks[i + 1].kind).toBe('task')
  })
})

describe('並びと時刻', () => {
  it('優先順位の高いタスクが先の時間に入る', () => {
    const tasks = [
      task({ id: 'later', title: 'あとで', importance: 1, dueDate: '2026-09-20' }),
      task({ id: 'now', title: 'いま', importance: 3, dueDate: TODAY }),
    ]
    const p = plan(tasks, [slot('18:00', '22:00')])
    const taskBlocks = p.blocks.filter((b) => b.kind === 'task')
    expect(taskBlocks[0].taskId).toBe('now')
  })

  it('ブロックが時刻順に並び、重ならない', () => {
    const tasks = [
      task({ id: 'a', title: 'A', estimateMin: 60, dueDate: TODAY }),
      task({ id: 'b', title: 'B', estimateMin: 45, dueDate: '2026-09-08' }),
      task({ id: 'c', title: 'C', estimateMin: 30, dueDate: '2026-09-09' }),
    ]
    const p = plan(tasks, [slot('18:00', '22:00'), slot('22:30', '23:30')])
    for (let i = 1; i < p.blocks.length; i++) {
      expect(toMinutes(p.blocks[i].start)).toBeGreaterThanOrEqual(toMinutes(p.blocks[i - 1].end))
    }
  })

  it('今より前の時間には置かない', () => {
    const p = plan([task({ id: 'a', title: 'A' })], [slot('18:00', '23:00')], toMinutes('20:30'))
    for (const b of p.blocks) {
      expect(toMinutes(b.start)).toBeGreaterThanOrEqual(toMinutes('20:30'))
    }
  })
})

describe('締切時刻を守る', () => {
  it('今日19時締切のタスクは19時までに終わるように置く', () => {
    const tasks = [
      task({ id: 'hard', title: '19時締切', estimateMin: 30, dueDate: TODAY, dueTime: '19:00' }),
      task({ id: 'soft', title: '締切なし', estimateMin: 60 }),
    ]
    const p = plan(tasks, [slot('18:00', '23:00')])
    const hard = p.blocks.find((b) => b.taskId === 'hard')
    expect(hard).toBeDefined()
    expect(toMinutes(hard!.end)).toBeLessThanOrEqual(toMinutes('19:00'))
  })

  it('間に合わない締切のタスクは置かず、理由を残す', () => {
    const tasks = [
      task({ id: 'late', title: '間に合わない', estimateMin: 120, dueDate: TODAY, dueTime: '19:00' }),
    ]
    const p = plan(tasks, [slot('18:00', '23:00')])
    expect(p.blocks.find((b) => b.taskId === 'late')).toBeUndefined()
    expect(p.notes.join()).toContain('入りませんでした')
  })
})

describe('空き時間が無いとき', () => {
  it('予定を作らず、その理由を返す', () => {
    const p = plan([task({ id: 'a', title: 'A' })], [])
    expect(p.blocks).toHaveLength(0)
    expect(p.notes.join()).toContain('空き時間がありません')
  })
})

describe('すべてのブロックに理由がつく', () => {
  it('作業・休憩・予備のどれにも理由が入る', () => {
    const tasks = [
      task({ id: 'a', title: 'A', estimateMin: 60, dueDate: TODAY }),
      task({ id: 'b', title: 'B', estimateMin: 45, dueDate: '2026-09-08' }),
    ]
    const p = plan(tasks, [slot('18:00', '23:00')])
    expect(p.blocks.length).toBeGreaterThan(0)
    for (const b of p.blocks) expect(b.reason).toBeTruthy()
  })
})

describe('埋まっている時間を差し引く', () => {
  it('空き時間の真ん中が埋まっていれば2つに割れる', () => {
    const out = subtractBusy([slot('18:00', '23:00')], [{ from: toMinutes('19:00'), to: toMinutes('20:00') }])
    expect(out.map((s) => `${s.startMin}-${s.endMin}`)).toEqual([
      `${toMinutes('18:00')}-${toMinutes('19:00')}`,
      `${toMinutes('20:00')}-${toMinutes('23:00')}`,
    ])
  })

  it('丸ごと埋まっていれば消える', () => {
    expect(subtractBusy([slot('18:00', '19:00')], [{ from: toMinutes('17:00'), to: toMinutes('20:00') }])).toEqual([])
  })

  it('重ならない予定は影響しない', () => {
    const out = subtractBusy([slot('18:00', '19:00')], [{ from: toMinutes('20:00'), to: toMinutes('21:00') }])
    expect(out).toHaveLength(1)
  })

  it('作り直しても完了済みの時間に別のタスクを重ねない', () => {
    const tasks = [
      task({ id: 'a', title: 'A', estimateMin: 60, dueDate: TODAY }),
      task({ id: 'b', title: 'B', estimateMin: 60, dueDate: '2026-09-08' }),
    ]
    const free = subtractBusy([slot('18:00', '23:00')], [{ from: toMinutes('18:00'), to: toMinutes('19:00') }])
    const p = plan(tasks, free)
    for (const b of p.blocks) {
      expect(toMinutes(b.start)).toBeGreaterThanOrEqual(toMinutes('19:00'))
    }
  })
})
