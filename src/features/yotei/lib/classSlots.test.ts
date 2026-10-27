import { describe, expect, it } from 'vitest'
import type { Job } from '../types'
import {
  DEFAULT_CLASS_SLOTS,
  isAutoShiftTitle,
  selectionFor,
  shiftLabelsOf,
  shiftTitle,
  slotLabels,
} from './classSlots'

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
  it('コマだけを名前にする（バイトかどうかは色で分かる）', () => {
    expect(shiftTitle(JOB, idsOf('B', 'C', 'D'))).toBe('BCD')
    expect(shiftTitle(JOB, idsOf('X'))).toBe('X')
    // 以前の「バイト BCD」には戻さない
    expect(shiftTitle(JOB, idsOf('B', 'C', 'D'))).not.toContain('バイト')
  })

  it('選んだ順ではなく、時刻の早い順に並べる', () => {
    expect(shiftTitle(JOB, idsOf('D', 'B', 'C'))).toBe('BCD')
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
  it('空と「バイト…」は自動とみなす', () => {
    expect(isAutoShiftTitle('')).toBe(true)
    expect(isAutoShiftTitle('バイト')).toBe(true)
    expect(isAutoShiftTitle('バイト BCD')).toBe(true)
    expect(isAutoShiftTitle('明光 テスト対策')).toBe(false)
    expect(isAutoShiftTitle('バイトの面接')).toBe(false)
  })

  it('コマの呼び名だけの名前も自動とみなす（選び直したら書き換わる）', () => {
    expect(isAutoShiftTitle('BCD', JOB)).toBe(true)
    expect(isAutoShiftTitle('X', JOB)).toBe(true)
    // コマにない字が混ざっていれば自分で書いたもの
    expect(isAutoShiftTitle('BC補講', JOB)).toBe(false)
    // コマの一覧を渡さなければ判断しない（書き換えない側に倒す）
    expect(isAutoShiftTitle('BCD')).toBe(false)
  })

  it('長い呼び名は点で区切ったものも自動とみなす', () => {
    const job = {
      ...JOB,
      classSlots: [
        { id: 'a', label: '朝', start: '09:00', end: '12:00' },
        { id: 'b', label: '夜勤', start: '18:00', end: '22:00' },
      ],
    } as Job
    expect(isAutoShiftTitle('朝・夜勤', job)).toBe(true)
    expect(isAutoShiftTitle('朝・保護者面談', job)).toBe(false)
  })
})

describe('古い名前を今の書き方に揃える', () => {
  it('「バイト BCD」からコマだけを取り出す', () => {
    expect(shiftLabelsOf('バイト BCD')).toBe('BCD')
    expect(shiftLabelsOf('バイト　朝・夜勤')).toBe('朝・夜勤')
  })

  it('コマの付いていないものと、自分で書いた名前は触らない', () => {
    expect(shiftLabelsOf('バイト')).toBe(null)
    expect(shiftLabelsOf('BCD')).toBe(null)
    expect(shiftLabelsOf('明光 テスト対策')).toBe(null)
  })
})
