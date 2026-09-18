import { describe, expect, it } from 'vitest'
import { hourRange, layoutDay, mondayOf, weekDays } from './week'

const s = (startMin: number, endMin: number, id = `${startMin}`) => ({ id, startMin, endMin })

describe('週の区切り', () => {
  it('月曜はじまり。日曜は前の週の終わり', () => {
    expect(mondayOf('2026-09-18')).toBe('2026-09-14') // 金
    expect(mondayOf('2026-09-14')).toBe('2026-09-14') // 月
    expect(mondayOf('2026-09-20')).toBe('2026-09-14') // 日
    expect(weekDays('2026-09-14')).toHaveLength(7)
    expect(weekDays('2026-09-14')[6]).toBe('2026-09-20')
  })
})

describe('縦の時間の幅', () => {
  it('予定が無ければ 8 時〜 22 時', () => {
    expect(hourRange([])).toEqual([8, 22])
  })
  it('朝早い予定・夜遅い予定に合わせて広げる', () => {
    expect(hourRange([s(6 * 60 + 30, 7 * 60), s(22 * 60, 23 * 60 + 10)])).toEqual([6, 24])
  })
})

describe('重なった予定', () => {
  it('重ならなければ 1 列', () => {
    const r = layoutDay([s(540, 600), s(600, 660)])
    expect(r.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 1],
      [0, 1],
    ])
  })

  it('重なったら横に並べる。つながった組は同じ列数', () => {
    const r = layoutDay([s(540, 660, 'a'), s(600, 720, 'b'), s(690, 750, 'c'), s(900, 960, 'd')])
    const by = Object.fromEntries(r.map((p) => [p.item.id, [p.lane, p.lanes]]))
    expect(by.a).toEqual([0, 2])
    expect(by.b).toEqual([1, 2])
    // a が終わった列に c が入る
    expect(by.c).toEqual([0, 2])
    expect(by.d).toEqual([0, 1])
  })
})
