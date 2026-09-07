import { describe, expect, it } from 'vitest'
import type { PlanBlock } from '../../types'
import {
  blockToEvent,
  isPmEvent,
  planWriteBack,
  verify,
  type YEventLike,
} from './yoteicho-write'

const DATE = '2026-09-08'

function block(patch: Partial<PlanBlock> & { id: string; title: string }): PlanBlock {
  return { start: '19:00', end: '20:00', kind: 'task', ...patch }
}

/** 手で入れた予定 (source が無い) */
function mine(patch: Partial<YEventLike> & { id: string }): YEventLike {
  return {
    title: 'バイト',
    category: 'baito',
    date: DATE,
    start: '17:55',
    end: '21:30',
    needsTravel: true,
    ...patch,
  }
}

/** 司令塔が前に作った予定 */
function pm(patch: Partial<YEventLike> & { id: string }): YEventLike {
  return { ...mine(patch), source: 'pm', category: 'other', ...patch }
}

describe('司令塔が作ったものの見分け', () => {
  it('source が pm のものだけを自分のものとみなす', () => {
    expect(isPmEvent(pm({ id: 'pm_1' }))).toBe(true)
    expect(isPmEvent(mine({ id: 'e1' }))).toBe(false)
    expect(isPmEvent({ ...mine({ id: 'e2' }), source: 'other-app' })).toBe(false)
  })
})

describe('コマをイベントに変える', () => {
  it('印と元のコマの id を必ず付ける', () => {
    const e = blockToEvent(block({ id: 'b1', title: '数学課題' }), DATE)
    expect(e.source).toBe('pm')
    expect(e.pmBlockId).toBe('b1')
    expect(e.id).toBe('pm_b1')
    expect(e.date).toBe(DATE)
  })

  it('場所を知らないので、移動ありにはしない', () => {
    // 移動ありにすると、よてい帳の出発時刻の計算が狂う
    expect(blockToEvent(block({ id: 'b1', title: 'A' }), DATE).needsTravel).toBe(false)
  })
})

describe('何を書くかの計画', () => {
  it('休憩と予備は送らない', () => {
    const blocks = [
      block({ id: 'a', title: '数学', kind: 'task' }),
      block({ id: 'b', title: '休憩', kind: 'break' }),
      block({ id: 'c', title: '予備', kind: 'buffer' }),
      block({ id: 'd', title: '開集合', kind: 'study' }),
      block({ id: 'e', title: '筋トレ', kind: 'workout' }),
    ]
    const p = planWriteBack([], blocks, DATE)
    expect(p.create.map((e) => e.title)).toEqual(['数学', '開集合', '筋トレ'])
  })

  it('手で入れた予定は触らないものとして数える', () => {
    const existing = [mine({ id: 'e1' }), mine({ id: 'e2' })]
    const p = planWriteBack(existing, [block({ id: 'a', title: 'A' })], DATE)
    expect(p.untouched).toBe(2)
    expect(p.remove).toHaveLength(0)
  })

  it('前に自分が作って、もう予定に無いものは消す対象になる', () => {
    const existing = [pm({ id: 'pm_old', title: '古い予定' }), mine({ id: 'e1' })]
    const p = planWriteBack(existing, [block({ id: 'new', title: '新しい' })], DATE)
    expect(p.remove.map((e) => e.id)).toEqual(['pm_old'])
    expect(p.create.map((e) => e.id)).toEqual(['pm_new'])
  })

  it('別の日に自分が作ったものには触らない', () => {
    const existing = [pm({ id: 'pm_other', date: '2026-09-09' })]
    const p = planWriteBack(existing, [block({ id: 'a', title: 'A' })], DATE)
    expect(p.remove).toHaveLength(0)
  })

  it('同じコマを作り直しても、消しては作らない', () => {
    const existing = [pm({ id: 'pm_a', title: '数学' })]
    const p = planWriteBack(existing, [block({ id: 'a', title: '数学' })], DATE)
    expect(p.remove).toHaveLength(0)
    expect(p.create.map((e) => e.id)).toEqual(['pm_a'])
  })

  it('書くものが何も無ければ、そう分かる', () => {
    expect(planWriteBack([mine({ id: 'e1' })], [], DATE).empty).toBe(true)
  })
})

describe('検算（最後の砦）', () => {
  it('手で入れた予定がすべて残っていれば通す', () => {
    const before = [mine({ id: 'e1' }), pm({ id: 'pm_a' })]
    const next = [mine({ id: 'e1' }), pm({ id: 'pm_b' })]
    expect(verify(before, next).ok).toBe(true)
  })

  it('手で入れた予定が1件でも消えていたら止める', () => {
    const before = [mine({ id: 'e1', title: 'バイト' }), mine({ id: 'e2' })]
    const next = [mine({ id: 'e1' })]
    const r = verify(before, next)

    expect(r.ok).toBe(false)
    expect(r.message).toContain('中止')
    expect(r.message).toContain('1件')
  })

  it('司令塔が作ったものは消えていても止めない', () => {
    const before = [mine({ id: 'e1' }), pm({ id: 'pm_a' })]
    expect(verify(before, [mine({ id: 'e1' })]).ok).toBe(true)
  })

  it('id が重複していたら止める', () => {
    const before = [mine({ id: 'e1' })]
    const next = [mine({ id: 'e1' }), mine({ id: 'e1' })]
    expect(verify(before, next).ok).toBe(false)
  })

  it('全部消そうとしても、手で入れた予定があれば止まる', () => {
    const before = [mine({ id: 'e1' }), mine({ id: 'e2' }), pm({ id: 'pm_a' })]
    expect(verify(before, []).ok).toBe(false)
  })

  it('もともと空なら、何を書いても通る', () => {
    expect(verify([], [pm({ id: 'pm_a' })]).ok).toBe(true)
  })
})

describe('組み立て直しの結果', () => {
  it('手で入れた予定・別の日の予定・新しい予定がすべて残る', () => {
    const before = [
      mine({ id: 'e1', title: 'バイト' }),
      mine({ id: 'e2', date: '2026-09-10', title: '面接' }),
      pm({ id: 'pm_old', title: '古い' }),
    ]
    const blocks = [block({ id: 'a', title: '数学' })]
    const p = planWriteBack(before, blocks, DATE)

    const removeIds = new Set(p.remove.map((e) => e.id))
    const createIds = new Set(p.create.map((e) => e.id))
    const next = [
      ...before.filter((e) => !removeIds.has(e.id) && !createIds.has(e.id)),
      ...p.create,
    ]

    expect(verify(before, next).ok).toBe(true)
    expect(next.map((e) => e.id).sort()).toEqual(['e1', 'e2', 'pm_a'])
  })
})
