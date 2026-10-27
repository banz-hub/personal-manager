import { describe, expect, it } from 'vitest'
import type { Job } from '../types'
import { DEFAULT_CLASS_SLOTS, isAutoShiftTitle, selectionFor, shiftTitle, slotLabels } from './classSlots'

const JOB: Job = {
  id: 'j1',
  name: '明光義塾',
  payType: 'perClass',
  hourlyYen: 0,
  nightRate: 1,
  classSlots: DEFAULT_CLASS_SLOTS,
} as Job

const idsOf = (...labels: string[]) =>
  DEFAULT_CLASS_SLOTS.filter((s) => labels.includes(s.label)).map((s) => s.id)

describe('コマから予定の名前を作る', () => {
  it('1文字の呼び名はつなげる', () => {
    expect(shiftTitle(JOB, idsOf('B', 'C', 'D'))).toBe('バイト BCD')
    expect(shiftTitle(JOB, idsOf('X'))).toBe('バイト X')
  })

  it('選んだ順ではなく、時刻の早い順に並べる', () => {
    expect(shiftTitle(JOB, idsOf('D', 'B', 'C'))).toBe('バイト BCD')
  })

  it('長い呼び名は点で区切る', () => {
    const job = {
      ...JOB,
      classSlots: [
        { id: 'a', label: '朝', start: '09:00', end: '12:00' },
        { id: 'b', label: '夜勤', start: '18:00', end: '22:00' },
      ],
    } as Job
    expect(slotLabels(selectionFor(job, ['a', 'b'])!.slots)).toBe('朝・夜勤')
  })

  it('コマを選んでいなければ空（種類の名前がそのまま出る）', () => {
    expect(shiftTitle(JOB, [])).toBe('')
  })
})

describe('自分で書いた名前は書き換えない', () => {
  it('空と「バイト…」だけ自動とみなす', () => {
    expect(isAutoShiftTitle('')).toBe(true)
    expect(isAutoShiftTitle('バイト')).toBe(true)
    expect(isAutoShiftTitle('バイト BCD')).toBe(true)
    expect(isAutoShiftTitle('明光 テスト対策')).toBe(false)
    expect(isAutoShiftTitle('バイトの面接')).toBe(false)
  })
})
