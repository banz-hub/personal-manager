import { describe, expect, it } from 'vitest'
import type { DayPlan, PlanBlock } from '../types'
import type { Schedulable } from './scheduler'
import {
  hasOverlap,
  insertBlock,
  nudgeBlock,
  removeBlock,
  resizeBlock,
  setBlockStart,
  unplaced,
  whyCannotStart,
  NUDGE_MIN,
} from './planedit'

const DATE = '2026-09-08'

function block(patch: Partial<PlanBlock> & { id: string }): PlanBlock {
  return { start: '19:00', end: '20:00', kind: 'task', title: patch.id, ...patch }
}

function plan(blocks: PlanBlock[]): DayPlan {
  return {
    id: DATE,
    date: DATE,
    blocks,
    generatedAt: '',
    freeMin: 600,
    fillRatio: 0.5,
    notes: [],
  }
}

function item(patch: Partial<Schedulable> & { refId: string }): Schedulable {
  return {
    kind: 'task',
    title: patch.refId,
    todayMin: 30,
    reason: '',
    critical: false,
    counted: true,
    ...patch,
  }
}

describe('重なりの検出', () => {
  it('隣り合っていても、重なっていなければよい', () => {
    expect(
      hasOverlap([block({ id: 'a', start: '19:00', end: '20:00' }), block({ id: 'b', start: '20:00', end: '21:00' })]),
    ).toBe(false)
  })

  it('1分でも重なれば検出する', () => {
    expect(
      hasOverlap([block({ id: 'a', start: '19:00', end: '20:00' }), block({ id: 'b', start: '19:59', end: '21:00' })]),
    ).toBe(true)
  })
})

describe('コマを消す', () => {
  it('消せる', () => {
    const p = removeBlock(plan([block({ id: 'a' }), block({ id: 'b', start: '20:00', end: '21:00' })]), 'a')
    expect(p.blocks.map((b) => b.id)).toEqual(['b'])
  })

  it('完了済みは消さない。実績が消えてしまうため', () => {
    const p = plan([block({ id: 'a', doneAt: 'x' })])
    expect(removeBlock(p, 'a').blocks).toHaveLength(1)
  })
})

describe('コマをずらす', () => {
  it('前後に動かせる', () => {
    const p = nudgeBlock(plan([block({ id: 'a', start: '19:00', end: '20:00' })]), 'a', NUDGE_MIN)
    expect(p.blocks[0].start).toBe('19:15')
    expect(p.blocks[0].end).toBe('20:15')
  })

  it('長さは変わらない', () => {
    const p = nudgeBlock(plan([block({ id: 'a', start: '19:00', end: '19:30' })]), 'a', -NUDGE_MIN)
    expect(p.blocks[0].start).toBe('18:45')
    expect(p.blocks[0].end).toBe('19:15')
  })

  it('ほかと重なるなら動かさない', () => {
    const before = plan([
      block({ id: 'a', start: '19:00', end: '20:00' }),
      block({ id: 'b', start: '20:00', end: '21:00' }),
    ])
    const after = nudgeBlock(before, 'a', NUDGE_MIN)
    expect(after.blocks.find((b) => b.id === 'a')!.start).toBe('19:00')
  })

  it('0時より前には出さない', () => {
    const p = plan([block({ id: 'a', start: '00:00', end: '01:00' })])
    expect(nudgeBlock(p, 'a', -NUDGE_MIN).blocks[0].start).toBe('00:00')
  })

  it('24時を超えない', () => {
    const p = plan([block({ id: 'a', start: '23:00', end: '23:59' })])
    expect(nudgeBlock(p, 'a', NUDGE_MIN).blocks[0].start).toBe('23:00')
  })

  it('完了済みは動かさない', () => {
    const p = plan([block({ id: 'a', doneAt: 'x' })])
    expect(nudgeBlock(p, 'a', NUDGE_MIN).blocks[0].start).toBe('19:00')
  })
})

describe('コマの長さを変える', () => {
  it('伸ばせる・縮められる', () => {
    const p = plan([block({ id: 'a', start: '19:00', end: '20:00' })])
    expect(resizeBlock(p, 'a', 15).blocks[0].end).toBe('20:15')
    expect(resizeBlock(p, 'a', -15).blocks[0].end).toBe('19:45')
  })

  it('5分より短くはしない', () => {
    const p = plan([block({ id: 'a', start: '19:00', end: '19:05' })])
    expect(resizeBlock(p, 'a', -15).blocks[0].end).toBe('19:05')
  })

  it('ほかと重なるほどは伸ばさない', () => {
    const p = plan([
      block({ id: 'a', start: '19:00', end: '20:00' }),
      block({ id: 'b', start: '20:00', end: '21:00' }),
    ])
    expect(resizeBlock(p, 'a', 15).blocks.find((b) => b.id === 'a')!.end).toBe('20:00')
  })
})

describe('コマを足す', () => {
  it('空いている早い時間に入る', () => {
    const p = insertBlock(plan([block({ id: 'a', start: '19:00', end: '20:00' })]), item({ refId: 't' }), '18:00', '23:00')!
    const added = p.blocks.find((b) => b.taskId === 't')!
    expect(added.start).toBe('18:00')
    expect(added.end).toBe('18:30')
  })

  it('前が埋まっていれば後ろに入る', () => {
    const p = insertBlock(
      plan([block({ id: 'a', start: '18:00', end: '19:00' })]),
      item({ refId: 't' }),
      '18:00',
      '23:00',
    )!
    expect(p.blocks.find((b) => b.taskId === 't')!.start).toBe('19:00')
  })

  it('学習ならノードとして紐づく', () => {
    const p = insertBlock(plan([]), item({ refId: 'n', kind: 'study' }), '18:00', '23:00')!
    const added = p.blocks[0]
    expect(added.nodeId).toBe('n')
    expect(added.taskId).toBeUndefined()
  })

  it('入る場所が無ければ足さない', () => {
    const p = plan([block({ id: 'a', start: '18:00', end: '23:00' })])
    expect(insertBlock(p, item({ refId: 't' }), '18:00', '23:00')).toBeNull()
  })

  it('足したあとも重ならない', () => {
    const p = insertBlock(
      plan([block({ id: 'a', start: '18:30', end: '19:00' })]),
      item({ refId: 't', todayMin: 60 }),
      '18:00',
      '23:00',
    )!
    expect(hasOverlap(p.blocks)).toBe(false)
  })
})

describe('まだ入っていないもの', () => {
  it('予定に無いものだけ返す', () => {
    const p = plan([block({ id: 'a', taskId: 't1' }), block({ id: 'b', kind: 'study', nodeId: 'n1' })])
    const items = [item({ refId: 't1' }), item({ refId: 't2' }), item({ refId: 'n1', kind: 'study' })]
    expect(unplaced(p, items).map((i) => i.refId)).toEqual(['t2'])
  })
})

describe('開始時刻を直接決める', () => {
  const base = () =>
    plan([
      block({ id: 'a', start: '19:00', end: '20:00' }),
      block({ id: 'b', start: '21:00', end: '22:00' }),
    ])

  it('空いている時刻へ動かせる', () => {
    const p = setBlockStart(base(), 'a', '09:00')
    const a = p.blocks.find((x) => x.id === 'a')!
    expect(a.start).toBe('09:00')
    expect(a.end).toBe('10:00')
  })

  it('長さは変わらない', () => {
    const p = setBlockStart(plan([block({ id: 'a', start: '19:00', end: '19:30' })]), 'a', '08:00')
    expect(p.blocks[0].end).toBe('08:30')
  })

  it('ほかと重なる時刻には置かない', () => {
    const p = setBlockStart(base(), 'a', '21:30')
    expect(p.blocks.find((x) => x.id === 'a')!.start).toBe('19:00')
  })

  it('日をまたぐ時刻には置かない', () => {
    const p = setBlockStart(plan([block({ id: 'a', start: '19:00', end: '20:00' })]), 'a', '23:30')
    expect(p.blocks[0].start).toBe('19:00')
  })

  it('完了済みは動かさない', () => {
    const p = plan([block({ id: 'a', doneAt: 'x' })])
    expect(setBlockStart(p, 'a', '09:00').blocks[0].start).toBe('19:00')
  })

  it('置けないときは理由が分かる', () => {
    expect(whyCannotStart(base(), 'a', '21:30')).toContain('重なります')
    expect(whyCannotStart(base(), 'a', '23:30')).toContain('日をまたぐ')
    expect(whyCannotStart(base(), 'a', '09:00')).toBeNull()
  })

  it('完了済みなら、そう言う', () => {
    const p = plan([block({ id: 'a', doneAt: 'x' })])
    expect(whyCannotStart(p, 'a', '09:00')).toContain('完了したコマ')
  })
})
