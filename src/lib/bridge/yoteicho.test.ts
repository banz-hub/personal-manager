import { describe, expect, it } from 'vitest'
import { fromMinutes } from '../date'
import { coursesOn, eventsOn, findSlots, parseManualSlots, type FixedItem, type SlotOptions } from './yoteicho'

const OPTIONS: SlotOptions = {
  dayStart: '08:00',
  dayEnd: '23:00',
  minSlotMin: 20,
  travelAllowanceMin: 60,
}

// よてい帳の実データに合わせた値 (東京理科大 野田キャンパス / 明光義塾)
const PERIODS = [
  { period: 1, start: '09:00', end: '10:30' },
  { period: 2, start: '10:40', end: '12:10' },
  { period: 3, start: '13:00', end: '14:30' },
  { period: 4, start: '14:40', end: '16:10' },
  { period: 5, start: '16:20', end: '17:50' },
]

const PLACES = [
  { id: 'p_univ', name: '東京理科大学 野田キャンパス', station: '運河', walkMinutes: 5 },
  { id: 'p_job', name: '明光義塾 ひたち野うしく西口駅前教室', station: 'ひたち野うしく', walkMinutes: 3 },
]

function item(patch: Partial<FixedItem> & { start: string; end: string }): FixedItem {
  const [sh, sm] = patch.start.split(':').map(Number)
  const [eh, em] = patch.end.split(':').map(Number)
  return {
    id: patch.start,
    title: '予定',
    kind: 'event',
    ...patch,
    // start / end から必ず作り直す
    startMin: sh * 60 + sm,
    endMin: eh * 60 + em,
  }
}

describe('授業の展開', () => {
  const course = {
    id: 'c1',
    name: '複素解析学B',
    day: 1, // 月曜
    period: 2,
    placeId: 'p_univ',
    startDate: '2026-09-11',
    endDate: '2027-01-31',
    skipDates: ['2026-09-21'],
  }

  it('曜日と学期が合う日だけ展開する', () => {
    // 2026-09-14 は月曜で学期内
    const out = coursesOn('2026-09-14', [course], PERIODS, PLACES)
    expect(out).toHaveLength(1)
    expect(out[0].start).toBe('10:40')
    expect(out[0].end).toBe('12:10')
    expect(out[0].placeName).toBe('東京理科大学 野田キャンパス')
  })

  it('学期が始まる前は出ない', () => {
    expect(coursesOn('2026-09-07', [course], PERIODS, PLACES)).toHaveLength(0)
  })

  it('曜日が違えば出ない', () => {
    expect(coursesOn('2026-09-15', [course], PERIODS, PLACES)).toHaveLength(0)
  })

  it('休講の日は出ない', () => {
    expect(coursesOn('2026-09-21', [course], PERIODS, PLACES)).toHaveLength(0)
  })
})

describe('予定の読み取り', () => {
  it('タイトルが空のバイトはカテゴリ名で出す', () => {
    const out = eventsOn(
      '2026-09-08',
      [
        {
          id: 'e1',
          title: '',
          category: 'baito',
          date: '2026-09-08',
          start: '17:55',
          end: '21:30',
          placeId: 'p_job',
          needsTravel: true,
        },
      ],
      PLACES,
    )
    expect(out[0].title).toBe('バイト')
    expect(out[0].placeName).toBe('明光義塾 ひたち野うしく西口駅前教室')
  })
})

describe('空き時間の切り出し', () => {
  it('予定の前後と間から空き時間を出す', () => {
    const slots = findSlots([item({ start: '13:00', end: '15:00', placeName: '自宅' })], {
      ...OPTIONS,
      travelAllowanceMin: 0,
    })
    expect(slots.map((s) => `${fromMinutes(s.startMin)}-${fromMinutes(s.endMin)}`)).toEqual([
      '08:00-13:00',
      '15:00-23:00',
    ])
  })

  it('場所が変わるときは移動のぶんを先に引く', () => {
    const slots = findSlots(
      [
        item({ start: '10:40', end: '12:10', placeName: '大学' }),
        item({ start: '17:55', end: '21:30', placeName: 'バイト先' }),
      ],
      OPTIONS,
    )
    const between = slots.find((s) => s.startMin === 12 * 60 + 10)
    expect(between).toBeDefined()
    // 17:55 の 60 分前 = 16:55 で切られる
    expect(fromMinutes(between!.endMin)).toBe('16:55')
  })

  it('同じ場所が続くなら移動を引かない', () => {
    const slots = findSlots(
      [
        item({ start: '10:40', end: '12:10', placeName: '大学' }),
        item({ start: '14:40', end: '16:10', placeName: '大学' }),
      ],
      OPTIONS,
    )
    const between = slots.find((s) => s.startMin === 12 * 60 + 10)
    expect(fromMinutes(between!.endMin)).toBe('14:40')
  })

  it('重なった予定はひとつにまとめる', () => {
    const slots = findSlots(
      [
        item({ start: '13:00', end: '15:00', placeName: 'A' }),
        item({ start: '14:00', end: '17:00', placeName: 'A' }),
      ],
      { ...OPTIONS, travelAllowanceMin: 0 },
    )
    expect(slots).toHaveLength(2)
    expect(fromMinutes(slots[1].startMin)).toBe('17:00')
  })

  it('短すぎる隙間は空き時間にしない', () => {
    const slots = findSlots(
      [
        item({ start: '13:00', end: '15:00', placeName: 'A' }),
        item({ start: '15:10', end: '17:00', placeName: 'A' }),
      ],
      { ...OPTIONS, travelAllowanceMin: 0 },
    )
    expect(slots.some((s) => s.startMin === 15 * 60)).toBe(false)
  })

  it('予定が無い日は一日まるごと空く', () => {
    const slots = findSlots([], OPTIONS)
    expect(slots).toHaveLength(1)
    expect(fromMinutes(slots[0].startMin)).toBe('08:00')
    expect(fromMinutes(slots[0].endMin)).toBe('23:00')
  })

  it('どこの隙間かが分かる名前がつく', () => {
    const slots = findSlots([item({ start: '10:40', end: '12:10', title: '複素解析学B', placeName: '大学' })], OPTIONS)
    expect(slots[1].label).toBe('複素解析学Bのあと')
  })
})

describe('空き時間の手入力', () => {
  it('19時〜23時 のような書き方を読める', () => {
    expect(parseManualSlots('19時〜23時')).toEqual([
      { startMin: 1140, endMin: 1380, label: '19:00〜23:00' },
    ])
  })

  it('複数の時間帯を読める', () => {
    const out = parseManualSlots('13:00-15:00 と 19:30〜22:00')
    expect(out).toHaveLength(2)
    expect(out[1].startMin).toBe(19 * 60 + 30)
  })

  it('終わりが始まりより前のものは捨てる', () => {
    expect(parseManualSlots('22:00〜19:00')).toHaveLength(0)
  })
})
