import { describe, expect, it } from 'vitest'
import { recordSleep } from './sleep'
import { clampToDay, freeGaps, longest, mergeSpans, sleepOn, totalMin } from './timeline'

const h = (hh: number, mm = 0) => hh * 60 + mm

describe('空き時間', () => {
  it('予定の隙間を 0 時〜24 時で出す', () => {
    const gaps = freeGaps([
      { startMin: h(9), endMin: h(10, 30) },
      { startMin: h(13), endMin: h(14) },
    ])
    expect(gaps).toEqual([
      { startMin: 0, endMin: h(9) },
      { startMin: h(10, 30), endMin: h(13) },
      { startMin: h(14), endMin: h(24) },
    ])
  })

  it('重なった予定はまとめ、15 分未満の隙間は数えない', () => {
    const gaps = freeGaps([
      { startMin: h(9), endMin: h(11) },
      { startMin: h(10), endMin: h(12) },
      { startMin: h(12, 10), endMin: h(24) },
      { startMin: 0, endMin: h(8) },
    ])
    expect(gaps).toEqual([{ startMin: h(8), endMin: h(9) }])
  })

  it('日をまたぐ予定は 24:00 で切る', () => {
    expect(clampToDay({ startMin: h(22), endMin: h(0, 30) })).toEqual({ startMin: h(22), endMin: h(24) })
  })

  it('合計と、いちばん長い空き', () => {
    const gaps = [
      { startMin: h(8), endMin: h(9) },
      { startMin: h(14), endMin: h(17) },
    ]
    expect(totalMin(gaps)).toBe(240)
    expect(longest(gaps)).toEqual({ startMin: h(14), endMin: h(17) })
    expect(longest([])).toBeUndefined()
  })

  it('隣り合う区間はつなげる', () => {
    expect(
      mergeSpans([
        { startMin: 0, endMin: 60 },
        { startMin: 60, endMin: 90 },
      ]),
    ).toEqual([{ startMin: 0, endMin: 90 }])
  })
})

describe('その日にかかる睡眠', () => {
  it('前の晩のぶんは 0 時から、その夜のぶんは 24 時まで', () => {
    let logs = recordSleep([], '2026-09-18', '23:30', '07:00')!
    logs = recordSleep(logs, '2026-09-19', '23:00', '06:30')!
    expect(sleepOn(logs, '2026-09-18')).toEqual([
      { startMin: 0, endMin: h(7) },
      { startMin: h(23), endMin: h(24) },
    ])
  })

  it('寝ている最中の記録は入れない', () => {
    const logs = [{ id: 'x', date: '2026-09-19', spans: [{ from: new Date(2026, 8, 18, 23).toISOString() }] }]
    expect(sleepOn(logs, '2026-09-18')).toEqual([])
  })
})
