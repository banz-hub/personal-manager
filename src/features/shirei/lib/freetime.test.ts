/**
 * よてい帳の「やること・趣味」を、エージェントの空き時間に当てるところ。
 *
 * 並べ方はよてい帳の担当なので、ここで見るのは
 * 「渡し方が正しいか」と「二重に引いていないか」だけ。
 */

import { describe, expect, it } from 'vitest'
import { slotToGap, suggestForSlots } from './freetime'
import type { FreeSlot } from './scheduler'
import type { Interest, Todo } from '../../yotei/types'

const todos: Todo[] = [
  { id: 'a', title: 'ITパスポート', minutes: 60, spots: ['home', 'campus'], priority: 2 },
  { id: 'b', title: '公務員試験勉強', minutes: 90, spots: ['home'], priority: 3 },
  { id: 'c', title: '駅で受け取り', minutes: 15, spots: ['transit'], priority: 1 },
]
const interests: Interest[] = [{ id: 'i1', name: '読書', minMinutes: 30, spots: ['anywhere'] }]

const slot = (patch: Partial<FreeSlot>): FreeSlot => ({
  startMin: 9 * 60,
  endMin: 12 * 60,
  ...patch,
})

describe('slotToGap', () => {
  it('移動のぶんを二重に引かない', () => {
    // エージェントの findSlots が先に引いた結果を渡すので、ここでは 0
    const g = slotToGap(slot({ startMin: 600, endMin: 700 }))
    expect(g.travelReserved).toBe(0)
    expect(g.minutes).toBe(100)
    expect(g.start).toBe('10:00')
    expect(g.end).toBe('11:40')
  })

  it('場所が分からない空き時間は「どこでも」として扱う', () => {
    // 手で入れた空き時間には場所の手がかりが無い。
    // ここで home などに決め打つと、家でしかできないことを外出中に勧めてしまう
    expect(slotToGap(slot({})).spot).toBe('anywhere')
  })

  it('場所があればそのまま渡す', () => {
    expect(slotToGap(slot({ spot: 'campus', placeLabel: '大学' })).spot).toBe('campus')
  })
})

describe('suggestForSlots', () => {
  it('自宅の空き時間には自宅でできることが出る', () => {
    const [first] = suggestForSlots({
      slots: [slot({ spot: 'home', placeLabel: '自宅' })],
      todos,
      interests,
      today: '2026-09-08',
    })
    const titles = first.suggestions.map((s) => s.title)
    expect(titles).toContain('公務員試験勉強')
    expect(titles).not.toContain('駅で受け取り')
  })

  it('空き時間より長いものは出さない', () => {
    const [first] = suggestForSlots({
      slots: [slot({ startMin: 600, endMin: 630, spot: 'home' })],
      todos,
      interests,
      today: '2026-09-08',
    })
    // 30分の空きに 60分・90分のやることは入らない
    const titles = first.suggestions.map((s) => s.title)
    expect(titles).toContain('読書')
    expect(titles).not.toContain('ITパスポート')
    expect(titles).not.toContain('公務員試験勉強')
  })

  it('中身の無い埋め草は落とす', () => {
    const out = suggestForSlots({
      slots: [slot({ startMin: 600, endMin: 610, spot: 'campus' })],
      todos,
      interests: [],
      today: '2026-09-08',
    })
    // 10分の空きに入るものは無い。よてい帳はここで
    // 「短い用事を片づける」を出すが、この画面では中身が無いので落とす
    expect(out).toEqual([])
  })

  it('済ませたやることは出さない', () => {
    const [first] = suggestForSlots({
      slots: [slot({ spot: 'home' })],
      todos: todos.map((t) => ({ ...t, doneAt: '2026-09-08' })),
      interests,
      today: '2026-09-08',
    })
    expect(first.suggestions.map((s) => s.source)).not.toContain('todo')
  })

  it('空き時間ごとに分けて返す', () => {
    const out = suggestForSlots({
      slots: [
        slot({ startMin: 540, endMin: 660, spot: 'home' }),
        slot({ startMin: 780, endMin: 900, spot: 'campus' }),
      ],
      todos,
      interests,
      today: '2026-09-08',
    })
    expect(out).toHaveLength(2)
    // 大学では自宅限定のものが出ない
    expect(out[1].suggestions.map((s) => s.title)).not.toContain('公務員試験勉強')
  })
})

describe('二重に出さない', () => {
  it('筋トレログが今日の筋トレを出している日は、趣味の筋トレを重ねない', () => {
    const slots = [slot({ spot: 'home' })]
    const gym: Interest[] = [{ id: 'g', name: '筋トレ', minMinutes: 50, spots: ['home'] }]

    const without = suggestForSlots({ slots, todos: [], interests: gym, today: '2026-09-08' })
    expect(without[0].suggestions.map((s) => s.title)).toContain('筋トレ')

    const withPlan = suggestForSlots({
      slots,
      todos: [],
      interests: gym,
      today: '2026-09-08',
      alreadyShown: ['筋トレ'],
    })
    expect(withPlan.map((x) => x.suggestions.map((s) => s.title)).flat()).not.toContain('筋トレ')
  })

  it('休む日は趣味として出てくる', () => {
    // 筋トレログが今日を「休養」と言えば alreadyShown に入らない。
    // 消えっぱなしにならないことを見る
    const out = suggestForSlots({
      slots: [slot({ spot: 'home' })],
      todos: [],
      interests: [{ id: 'g', name: '筋トレ', minMinutes: 50, spots: ['home'] }],
      today: '2026-09-08',
      alreadyShown: ['複素解析学B'],
    })
    expect(out[0].suggestions.map((s) => s.title)).toContain('筋トレ')
  })
})
