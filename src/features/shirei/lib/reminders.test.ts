import { describe, expect, it } from 'vitest'
import type { DayPlan, Task } from '../types'
import { buildPlanIcs, buildReminders, dueNow } from './reminders'

const DATE = '2026-09-08'

function plan(blocks: Array<Partial<DayPlan['blocks'][number]> & { id: string }>): DayPlan {
  return {
    id: DATE,
    date: DATE,
    blocks: blocks.map((b) => ({
      start: '19:00',
      end: '20:00',
      kind: 'task' as const,
      title: b.id,
      ...b,
    })),
    generatedAt: '',
    freeMin: 300,
    fillRatio: 0.6,
    notes: [],
  }
}

function task(patch: Partial<Task> & { id: string; title: string }): Task {
  return {
    area: 'other',
    status: 'todo',
    estimateMin: 60,
    importance: 2,
    createdAt: '',
    ...patch,
  }
}

describe('何を知らせるか', () => {
  it('予定のコマの開始を、指定した分だけ前に知らせる', () => {
    const r = buildReminders({
      date: DATE,
      plan: plan([{ id: 'a', title: '数学課題', start: '19:00', end: '20:00' }]),
      tasks: [],
      beforeMin: 10,
    })
    expect(r).toHaveLength(1)
    expect(r[0].at.getHours()).toBe(18)
    expect(r[0].at.getMinutes()).toBe(50)
    expect(r[0].title).toContain('19:00 から 数学課題')
    expect(r[0].body).toContain('1時間')
  })

  it('終わったコマは知らせない', () => {
    const r = buildReminders({
      date: DATE,
      plan: plan([{ id: 'a', doneAt: 'x' }]),
      tasks: [],
      beforeMin: 10,
    })
    expect(r).toHaveLength(0)
  })

  it('休憩と予備は知らせない', () => {
    const r = buildReminders({
      date: DATE,
      plan: plan([
        { id: 'a', kind: 'break' },
        { id: 'b', kind: 'buffer' },
      ]),
      tasks: [],
      beforeMin: 10,
    })
    expect(r).toHaveLength(0)
  })

  it('今日が締切のタスクは、締切より前に知らせる', () => {
    const r = buildReminders({
      date: DATE,
      tasks: [task({ id: 't', title: 'ES提出', dueDate: DATE, dueTime: '23:59' })],
      beforeMin: 10,
    })
    // 前倒しは最低30分
    expect(r[0].at.getHours()).toBe(23)
    expect(r[0].at.getMinutes()).toBe(29)
    expect(r[0].title).toContain('まもなく締切')
  })

  it('締切の時刻が無いタスクは知らせない', () => {
    const r = buildReminders({
      date: DATE,
      tasks: [task({ id: 't', title: 'A', dueDate: DATE })],
      beforeMin: 10,
    })
    expect(r).toHaveLength(0)
  })

  it('別の日が締切のタスクは知らせない', () => {
    const r = buildReminders({
      date: DATE,
      tasks: [task({ id: 't', title: 'A', dueDate: '2026-09-10', dueTime: '12:00' })],
      beforeMin: 10,
    })
    expect(r).toHaveLength(0)
  })

  it('完了したタスクは知らせない', () => {
    const r = buildReminders({
      date: DATE,
      tasks: [task({ id: 't', title: 'A', status: 'done', dueDate: DATE, dueTime: '12:00' })],
      beforeMin: 10,
    })
    expect(r).toHaveLength(0)
  })

  it('時刻の早い順に並ぶ', () => {
    const r = buildReminders({
      date: DATE,
      plan: plan([
        { id: 'late', start: '21:00', end: '22:00' },
        { id: 'early', start: '09:00', end: '10:00' },
      ]),
      tasks: [],
      beforeMin: 0,
    })
    expect(r.map((x) => x.key)).toEqual(['blk-early', 'blk-late'])
  })
})

describe('いま鳴らすもの', () => {
  it('直近1分以内に来たものだけを拾う', () => {
    const now = new Date(2026, 8, 8, 19, 0, 30)
    const reminders = buildReminders({
      date: DATE,
      plan: plan([
        { id: 'now', start: '19:00', end: '20:00' },
        { id: 'later', start: '21:00', end: '22:00' },
      ]),
      tasks: [],
      beforeMin: 0,
    })
    expect(dueNow(reminders, now).map((r) => r.key)).toEqual(['blk-now'])
  })

  it('まだ来ていないものは拾わない', () => {
    const now = new Date(2026, 8, 8, 12, 0, 0)
    const reminders = buildReminders({
      date: DATE,
      plan: plan([{ id: 'a', start: '19:00', end: '20:00' }]),
      tasks: [],
      beforeMin: 0,
    })
    expect(dueNow(reminders, now)).toHaveLength(0)
  })
})

describe('端末のカレンダーに入れる (.ics)', () => {
  const ics = () =>
    buildPlanIcs(
      plan([
        { id: 'a', title: '数学課題', start: '19:00', end: '20:00', reason: '今日が締切' },
        { id: 'b', title: '休憩', kind: 'break', start: '20:00', end: '20:10' },
      ]),
      DATE,
      10,
    )

  it('カレンダーの形になっている', () => {
    const t = ics()
    expect(t.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(t.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    // .ics は CRLF 区切り
    expect(t).toContain('\r\n')
  })

  it('作業のコマだけが入り、休憩は入らない', () => {
    const t = ics()
    expect(t).toContain('SUMMARY:数学課題')
    expect(t).not.toContain('SUMMARY:休憩')
  })

  it('アラームが付く。ここが「閉じていても鳴る」の要', () => {
    const t = ics()
    expect(t).toContain('BEGIN:VALARM')
    expect(t).toContain('TRIGGER:-PT10M')
    expect(t).toContain('ACTION:DISPLAY')
  })

  it('開始と終了の時刻が入る', () => {
    const t = ics()
    expect(t).toContain('DTSTART:20260908T190000')
    expect(t).toContain('DTEND:20260908T200000')
  })

  it('記号を含むタイトルでも壊れない', () => {
    const t = buildPlanIcs(
      plan([{ id: 'a', title: 'A社; ES, 提出\n急ぎ' }]),
      DATE,
      0,
    )
    expect(t).toContain('SUMMARY:A社\\; ES\\, 提出\\n急ぎ')
  })
})
