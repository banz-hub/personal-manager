/**
 * 終電から「その場所を何時に出ればよいか」を出すところ。
 *
 * ここを間違えると終電を逃す。0 時台の扱いと、後ろの区間から
 * さかのぼる計算の 2 つが要点。
 */

import { describe, expect, it } from 'vitest'
import type { RouteLeg } from '../types'
import type { RoutePlan } from './routes'
import { formatLateNight, hasAnyLastTrain, lastTrainFor } from './lastTrain'

function leg(from: string, to: string, minutes: number, last?: Partial<RouteLeg>): RouteLeg {
  return {
    id: `${from}-${to}`,
    from,
    to,
    minutes,
    fareYen: 200,
    transfers: 0,
    ...last,
  }
}

function plan(stations: string[], legs: RouteLeg[]): RoutePlan {
  return {
    stations,
    legs,
    minutes: legs.reduce((a, l) => a + l.minutes, 0),
    fareYen: legs.reduce((a, l) => a + l.fareYen, 0),
    transfers: 0,
    label: '最速',
  }
}

describe('0 時台の表示', () => {
  it('24 時を過ぎたものは「翌」を付ける', () => {
    expect(formatLateNight(23 * 60 + 40)).toBe('23:40')
    expect(formatLateNight(1440 + 30)).toBe('翌00:30')
  })
})

describe('出発地を出る最終時刻', () => {
  it('区間が 1 つなら、その終電がそのまま答え', () => {
    const legs = [leg('柏', '我孫子', 10, { lastTrainFrom: '23:50' })]
    const got = lastTrainFor(plan(['柏', '我孫子'], legs))
    expect(got?.boardBy).toBe('23:50')
    expect(got?.leaveBy).toBe('23:50')
  })

  it('駅までの徒歩を引く', () => {
    const legs = [leg('柏', '我孫子', 10, { lastTrainFrom: '23:50' })]
    const got = lastTrainFor(plan(['柏', '我孫子'], legs), 12)
    expect(got?.boardBy).toBe('23:50')
    expect(got?.leaveBy).toBe('23:38')
  })

  it('0 時台の終電は翌日として扱う', () => {
    const legs = [leg('柏', '我孫子', 10, { lastTrainFrom: '00:20' })]
    const got = lastTrainFor(plan(['柏', '我孫子'], legs))
    expect(got?.boardByMinutes).toBe(1440 + 20)
    expect(got?.boardBy).toBe('翌00:20')
  })

  it('進む向きに合った終電を使う', () => {
    // 柏 → 我孫子 の向きなので lastTrainFrom を見る
    const legs = [leg('柏', '我孫子', 10, { lastTrainFrom: '23:50', lastTrainTo: '22:00' })]
    expect(lastTrainFor(plan(['柏', '我孫子'], legs))?.boardBy).toBe('23:50')

    // 逆向きに通るときは lastTrainTo
    expect(lastTrainFor(plan(['我孫子', '柏'], legs))?.boardBy).toBe('22:00')
  })
})

describe('乗り継ぐとき', () => {
  /**
   * 柏 →(20分) 北千住 →(15分) 大手町。
   * 2 本目の終電が 23:30 なら、1 本目は 23:30 - 20 - 5(乗り継ぎ) = 23:05 までに乗る。
   */
  const legs = [
    leg('柏', '北千住', 20, { lastTrainFrom: '23:55' }),
    leg('北千住', '大手町', 15, { lastTrainFrom: '23:30' }),
  ]
  const route = plan(['柏', '北千住', '大手町'], legs)

  it('後ろの区間に間に合うところまでしか遅らせない', () => {
    const got = lastTrainFor(route)
    expect(got?.boardBy).toBe('23:05')
  })

  it('効いている区間が分かる', () => {
    const got = lastTrainFor(route)
    // 自分の終電がそのまま制約になっているのは 2 本目
    expect(got?.binding?.from).toBe('北千住')
  })

  it('前の区間の終電のほうが早ければ、そちらが効く', () => {
    const early = [
      leg('柏', '北千住', 20, { lastTrainFrom: '22:00' }),
      leg('北千住', '大手町', 15, { lastTrainFrom: '23:30' }),
    ]
    const got = lastTrainFor(plan(['柏', '北千住', '大手町'], early))
    expect(got?.boardBy).toBe('22:00')
    expect(got?.binding?.from).toBe('柏')
  })
})

describe('終電が分からないとき', () => {
  it('未登録の区間が 1 つでもあれば答えを出さない', () => {
    const legs = [
      leg('柏', '北千住', 20, { lastTrainFrom: '23:55' }),
      leg('北千住', '大手町', 15),
    ]
    expect(lastTrainFor(plan(['柏', '北千住', '大手町'], legs))).toBeNull()
  })

  it('区間が無ければ答えを出さない', () => {
    expect(lastTrainFor(plan([], []))).toBeNull()
  })

  it('1 つでも登録があるかを答えられる', () => {
    expect(hasAnyLastTrain([leg('柏', '我孫子', 10)])).toBe(false)
    expect(hasAnyLastTrain([leg('柏', '我孫子', 10, { lastTrainFrom: '23:50' })])).toBe(true)
  })
})
