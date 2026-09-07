/**
 * 時刻表から便を選ぶところ。
 *
 * 785 件の手入力の時刻がここを通る。日をまたぐ便と、乗り継ぎの 2 つが
 * とくに間違えやすいので、そこを厚めに見ている。
 */

import { describe, expect, it } from 'vitest'
import type { TrainRun } from '../types'
import { chooseRuns, hasStopFor, lastRunBetween, runsOnDate, stopTime } from './timetable'

function run(id: string, stops: Array<[string, string]>, extra: Partial<TrainRun> = {}): TrainRun {
  return {
    id,
    line: '常磐線 上り',
    serviceDays: 'all',
    stops: stops.map(([station, time]) => ({ station, time })),
    ...extra,
  }
}

// 2026-09-08 は火曜、2026-09-12 は土曜
const TUE = '2026-09-08'
const SAT = '2026-09-12'

describe('その日に走る便か', () => {
  it('平日だけの便は土曜には出ない', () => {
    const r = run('a', [['柏', '08:00']], { serviceDays: 'weekday' })
    expect(runsOnDate(r, TUE)).toBe(true)
    expect(runsOnDate(r, SAT)).toBe(false)
  })

  it('土休日だけの便は平日には出ない', () => {
    const r = run('a', [['柏', '08:00']], { serviceDays: 'holiday' })
    expect(runsOnDate(r, TUE)).toBe(false)
    expect(runsOnDate(r, SAT)).toBe(true)
  })

  it('毎日走る便はどちらでも出る', () => {
    const r = run('a', [['柏', '08:00']])
    expect(runsOnDate(r, TUE)).toBe(true)
    expect(runsOnDate(r, SAT)).toBe(true)
  })
})

describe('駅の時刻を引く', () => {
  const r = run('a', [
    ['柏', '08:00'],
    ['松戸', '08:12'],
  ])

  it('停まる駅の時刻が出る', () => {
    expect(stopTime(r, '松戸')).toBe('08:12')
  })

  it('停まらない駅は出ない', () => {
    expect(stopTime(r, '我孫子')).toBeUndefined()
  })

  it('「駅」が付いていても同じ駅とみなす', () => {
    expect(stopTime(r, '松戸駅')).toBe('08:12')
  })
})

describe('間に合う便を選ぶ', () => {
  const runs = [
    run('r1', [
      ['柏', '07:30'],
      ['北千住', '07:55'],
    ]),
    run('r2', [
      ['柏', '08:00'],
      ['北千住', '08:25'],
    ]),
    run('r3', [
      ['柏', '08:20'],
      ['北千住', '08:45'],
    ]),
  ]

  const base = {
    runs,
    dateKey: TUE,
    from: '柏',
    alightOptions: [{ station: '北千住', extraMinutes: 10 }],
  }

  it('遅く出られる順に並ぶ', () => {
    const got = chooseRuns({ ...base, arriveBy: '09:00' })
    expect(got.map((c) => c.departAt)).toEqual(['08:20', '08:00', '07:30'])
  })

  it('間に合わない便は落ちる', () => {
    // 08:45 着 + 徒歩10分 = 08:55。08:50 には間に合わない
    const got = chooseRuns({ ...base, arriveBy: '08:50' })
    expect(got.map((c) => c.departAt)).toEqual(['08:00', '07:30'])
  })

  it('目的地に着く時刻は、降車時刻に降りたあとの時間を足したもの', () => {
    const [first] = chooseRuns({ ...base, arriveBy: '09:00' })
    expect(first.arriveAt).toBe('08:45')
    expect(first.finalMinutes).toBe(8 * 60 + 45 + 10)
    // 09:00 まで 5 分余る
    expect(first.slackMinutes).toBe(5)
  })

  it('乗る駅に停まらない便は選ばない', () => {
    const got = chooseRuns({ ...base, from: '我孫子', arriveBy: '09:00' })
    expect(got).toEqual([])
  })

  it('降りる駅が乗る駅より手前の便は選ばない', () => {
    // 向きが逆の便。北千住から柏へ向かうので、柏で乗って北千住では降りられない
    const backward = [
      run('b1', [
        ['北千住', '08:00'],
        ['柏', '08:25'],
      ]),
    ]
    expect(chooseRuns({ ...base, runs: backward, arriveBy: '09:00' })).toEqual([])
  })

  it('その日に走らない便は選ばない', () => {
    const holidayOnly = runs.map((r) => ({ ...r, serviceDays: 'holiday' as const }))
    expect(chooseRuns({ ...base, runs: holidayOnly, arriveBy: '09:00' })).toEqual([])
  })

  it('本数を絞れる', () => {
    expect(chooseRuns({ ...base, arriveBy: '09:00', limit: 2 })).toHaveLength(2)
  })
})

describe('日をまたぐ便', () => {
  /**
   * 23:50 発 → 00:03 着。分に直すと 3 になるので、そのままでは
   * 「13 分かかる」ではなく「早朝に着く」と読めてしまう。
   */
  const runs = [
    run('n1', [
      ['柏', '23:50'],
      ['我孫子', '00:03'],
    ]),
  ]

  it('翌日の到着として扱う', () => {
    const [choice] = chooseRuns({
      runs,
      dateKey: TUE,
      from: '柏',
      alightOptions: [{ station: '我孫子', extraMinutes: 0 }],
      arriveBy: '24:30',
    })
    expect(choice).toBeDefined()
    // 00:03 = 24 時間 + 3 分
    expect(choice.arriveMinutes).toBe(1440 + 3)
    expect(choice.arriveMinutes - choice.departMinutes).toBe(13)
  })
})

describe('乗り継ぐ', () => {
  const runs = [
    // 1 本目: 柏 → 北千住
    run('a1', [
      ['柏', '08:00'],
      ['北千住', '08:25'],
    ]),
    // 2 本目: 北千住 → 大手町。乗り継ぎに 5 分かかるので 08:28 発には乗れない
    run('b1', [['北千住', '08:28'], ['大手町', '08:50']], { line: '千代田線' }),
    run('b2', [['北千住', '08:35'], ['大手町', '08:57']], { line: '千代田線' }),
  ]

  it('乗り継ぎ時間を待てる便につなぐ', () => {
    const [choice] = chooseRuns({
      runs,
      dateKey: TUE,
      from: '柏',
      alightOptions: [{ station: '北千住', extraMinutes: 0 }],
      arriveBy: '09:10',
      chain: { at: '北千住', to: '大手町', transferMinutes: 5, tailMinutes: 8 },
    })
    expect(choice).toBeDefined()
    expect(choice.connection?.departAt).toBe('08:35')
    expect(choice.connection?.waitMinutes).toBe(10)
    // 08:57 着 + 徒歩 8 分
    expect(choice.finalMinutes).toBe(8 * 60 + 57 + 8)
  })
})

describe('その駅の時刻表があるか', () => {
  const runs = [run('a', [['柏', '08:00']], { serviceDays: 'weekday' })]

  it('平日だけの便しか無い駅は、土曜には無いと答える', () => {
    expect(hasStopFor(runs, '柏', TUE)).toBe(true)
    expect(hasStopFor(runs, '柏', SAT)).toBe(false)
  })
})

describe('終電の便', () => {
  const runs = [
    run('l1', [
      ['柏', '22:00'],
      ['我孫子', '22:10'],
    ]),
    run('l2', [
      ['柏', '23:40'],
      ['我孫子', '23:50'],
    ]),
    // 我孫子に停まらないので、終電にはならない
    run('l3', [
      ['柏', '23:55'],
      ['取手', '24:10'],
    ]),
  ]

  it('その区間を通るいちばん遅い便を返す', () => {
    const got = lastRunBetween(runs, TUE, '柏', '我孫子')
    expect(got?.departAt).toBe('23:40')
  })
})
