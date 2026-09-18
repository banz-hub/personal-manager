/**
 * 睡眠の記録。
 *
 * 日をまたぐこと、二度寝を同じ晩として数えること、
 * 二重に押しても壊れないこと、の 3 つが要点。
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings, type SleepLog } from '../types'
import {
  advise,
  isAsleep,
  rate,
  recordSleep,
  sleepAgain,
  startSleep,
  summarize,
  trend,
  wakeUp,
} from './sleep'

const S: Settings = { ...DEFAULT_SETTINGS, targetSleepMin: 450, targetBedtime: '23:30' }

/** ローカル時刻で Date を作る。記録は端末の時計で押すため */
const at = (s: string) => new Date(s)

describe('ボタンを押す', () => {
  it('寝る → 起きる で 1 晩ぶんになる', () => {
    let logs: SleepLog[] = []
    logs = startSleep(logs, at('2026-09-07T23:30:00'))
    expect(logs).toHaveLength(1)
    expect(isAsleep(logs[0])).toBe(true)

    logs = wakeUp(logs, at('2026-09-08T07:00:00'))
    expect(isAsleep(logs[0])).toBe(false)
    // 起きた日で数える
    expect(logs[0].date).toBe('2026-09-08')

    const s = summarize(logs, '2026-09-08', S)
    expect(s.minutes).toBe(7 * 60 + 30)
    expect(s.bedAt).toBe('23:30')
    expect(s.wakeAt).toBe('07:00')
  })

  it('日をまたがない仮眠でも、起きた日で数える', () => {
    let logs = startSleep([], at('2026-09-08T13:00:00'))
    logs = wakeUp(logs, at('2026-09-08T14:00:00'))
    expect(logs[0].date).toBe('2026-09-08')
    expect(summarize(logs, '2026-09-08', S).minutes).toBe(60)
  })

  it('寝るを二重に押しても増えない', () => {
    let logs = startSleep([], at('2026-09-07T23:30:00'))
    logs = startSleep(logs, at('2026-09-07T23:31:00'))
    expect(logs).toHaveLength(1)
    expect(logs[0].spans).toHaveLength(1)
  })

  it('寝ていないのに起きたを押しても何も起きない', () => {
    const logs = wakeUp([], at('2026-09-08T07:00:00'))
    expect(logs).toEqual([])
  })
})

describe('二度寝', () => {
  it('同じ晩の続きとして数える', () => {
    let logs = startSleep([], at('2026-09-07T23:30:00'))
    logs = wakeUp(logs, at('2026-09-08T06:00:00'))
    logs = sleepAgain(logs, at('2026-09-08T06:10:00'))
    logs = wakeUp(logs, at('2026-09-08T07:30:00'))

    // 記録は 1 晩のまま
    expect(logs).toHaveLength(1)

    const s = summarize(logs, '2026-09-08', S)
    // 6h30m + 1h20m。起きていた 10 分は入らない
    expect(s.minutes).toBe(6 * 60 + 30 + 80)
    expect(s.snoozeCount).toBe(1)
    expect(s.snoozeMinutes).toBe(80)
    expect(s.bedAt).toBe('23:30')
    expect(s.wakeAt).toBe('07:30')
  })

  it('起きてから長く経っていたら、新しい晩として始める', () => {
    let logs = startSleep([], at('2026-09-07T23:30:00'))
    logs = wakeUp(logs, at('2026-09-08T07:00:00'))
    // 4 時間後に押した。これは前の晩の続きではない
    logs = sleepAgain(logs, at('2026-09-08T11:00:00'))
    expect(logs).toHaveLength(2)
  })

  it('寝ている最中に押しても増えない', () => {
    let logs = startSleep([], at('2026-09-07T23:30:00'))
    logs = sleepAgain(logs, at('2026-09-07T23:40:00'))
    expect(logs[0].spans).toHaveLength(1)
  })
})

describe('評価', () => {
  it('目標どおりで一度も起きなければ良い', () => {
    expect(rate(450, 0, S)).toBe('good')
  })

  it('90分以上足りなければ足りていない', () => {
    expect(rate(350, 0, S)).toBe('short')
  })

  it('長さが足りていても、3回以上起きていれば細切れ', () => {
    expect(rate(480, 3, S)).toBe('broken')
  })

  it('少し足りない・少し起きたはまずまず', () => {
    expect(rate(440, 1, S)).toBe('fair')
  })
})

describe('直近の傾向', () => {
  const night = (date: string, from: string, to: string): SleepLog => ({
    id: date,
    date,
    spans: [{ from: new Date(from).toISOString(), to: new Date(to).toISOString() }],
  })

  it('平均と、寝る時刻のばらつきを出す', () => {
    const logs = [
      night('2026-09-06', '2026-09-05T23:00:00', '2026-09-06T06:00:00'),
      night('2026-09-07', '2026-09-07T01:00:00', '2026-09-07T07:00:00'),
      night('2026-09-08', '2026-09-07T23:00:00', '2026-09-08T07:00:00'),
    ]
    const t = trend(logs, '2026-09-08', S)
    expect(t.days).toBe(3)
    expect(t.averageMin).toBe(Math.round((420 + 360 + 480) / 3))
    // 23:00 と 翌1:00 の差は 2 時間。23 時間ではない
    expect(t.bedtimeSpreadMin).toBe(120)
  })

  it('記録が無ければ 0 を返す', () => {
    expect(trend([], '2026-09-08', S).days).toBe(0)
  })
})

describe('助言', () => {
  it('記録から言えることだけを返す', () => {
    let logs = startSleep([], at('2026-09-08T02:00:00'))
    logs = wakeUp(logs, at('2026-09-08T07:00:00'))
    const s = summarize(logs, '2026-09-08', S)
    const out = advise(s, trend(logs, '2026-09-08', S), S)
    expect(out.join()).toContain('目標より')
  })

  it('目標どおりなら、崩さないようにとだけ言う', () => {
    let logs = startSleep([], at('2026-09-07T23:00:00'))
    logs = wakeUp(logs, at('2026-09-08T07:00:00'))
    const s = summarize(logs, '2026-09-08', S)
    const out = advise(s, trend(logs, '2026-09-08', S), S)
    expect(out).toEqual(['目標どおり眠れています。この形を崩さないでください。'])
  })

  it('記録が無ければ何も言わない', () => {
    const s = summarize([], '2026-09-08', S)
    expect(advise(s, trend([], '2026-09-08', S), S)).toEqual([])
  })
})

describe('同じ日に記録が 2 つあるとき', () => {
  const night: SleepLog = {
    id: 'night',
    date: '2026-09-08',
    spans: [
      { from: new Date('2026-09-07T23:00:00').toISOString(), to: new Date('2026-09-08T07:00:00').toISOString() },
    ],
  }
  const nap: SleepLog = {
    id: 'nap',
    date: '2026-09-08',
    spans: [
      { from: new Date('2026-09-08T14:00:00').toISOString(), to: new Date('2026-09-08T14:40:00').toISOString() },
    ],
  }

  it('長いほうを、その日の睡眠として出す', () => {
    // 昼寝が先に入っていても、夜のほうを選ぶ
    expect(summarize([nap, night], '2026-09-08', S).minutes).toBe(480)
    expect(summarize([night, nap], '2026-09-08', S).minutes).toBe(480)
  })

  it('いま寝ている最中のものがあれば、そちらを出す', () => {
    const now: SleepLog = {
      id: 'now',
      date: '2026-09-08',
      spans: [{ from: new Date('2026-09-08T14:00:00').toISOString() }],
    }
    expect(summarize([night, now], '2026-09-08', S).ongoing).toBe(true)
  })

  it('傾向では 1 日として数える', () => {
    expect(trend([night, nap], '2026-09-08', S).days).toBe(1)
  })
})

describe('押し間違い', () => {
  it('寝る → すぐ起きた は記録に残さない', () => {
    let logs = startSleep([], at('2026-09-08T08:00:00'))
    logs = wakeUp(logs, at('2026-09-08T08:01:00'))
    expect(logs).toEqual([])
  })

  it('前の記録は消さない', () => {
    let logs = startSleep([], at('2026-09-07T23:00:00'))
    logs = wakeUp(logs, at('2026-09-08T07:00:00'))
    logs = startSleep(logs, at('2026-09-08T08:00:00'))
    logs = wakeUp(logs, at('2026-09-08T08:01:00'))
    expect(logs).toHaveLength(1)
    expect(summarize(logs, '2026-09-08', S).minutes).toBe(480)
  })
})

describe('助言と評価が食い違わない', () => {
  it('長さは足りていて二度寝した日は、そのことを言う', () => {
    let logs = startSleep([], at('2026-09-07T23:10:00'))
    logs = wakeUp(logs, at('2026-09-08T06:00:00'))
    logs = sleepAgain(logs, at('2026-09-08T06:15:00'))
    logs = wakeUp(logs, at('2026-09-08T07:40:00'))

    const s = summarize(logs, '2026-09-08', S)
    expect(s.rating).toBe('fair')
    const out = advise(s, trend(logs, '2026-09-08', S), S)
    // 「まずまず」なのに「目標どおり」とは言わない
    expect(out.join()).not.toContain('目標どおり')
    expect(out.join()).toContain('途中で1回起きています')
  })
})

describe('手で入れる', () => {
  it('寝た時刻が起きた時刻より遅ければ、前の晩に寝たことになる', () => {
    const logs = recordSleep([], '2026-09-08', '23:30', '07:00')!
    const s = summarize(logs, '2026-09-08', S)
    expect(s.minutes).toBe(450)
    expect(s.bedAt).toBe('23:30')
    expect(s.wakeAt).toBe('07:00')
    expect(new Date(logs[0].spans[0].from).getDate()).toBe(7)
  })

  it('日付が変わってから寝たときは当日のまま', () => {
    const logs = recordSleep([], '2026-09-08', '01:00', '08:00')!
    expect(summarize(logs, '2026-09-08', S).minutes).toBe(420)
    expect(new Date(logs[0].spans[0].from).getDate()).toBe(8)
  })

  it('同じ日に入れ直すと置き換わる。増えない', () => {
    let logs = recordSleep([], '2026-09-08', '23:00', '06:00')!
    logs = recordSleep(logs, '2026-09-08', '00:00', '07:00')!
    expect(logs).toHaveLength(1)
    expect(summarize(logs, '2026-09-08', S).bedAt).toBe('00:00')
  })

  it('別の日の記録には触らない', () => {
    let logs = recordSleep([], '2026-09-07', '23:00', '06:00')!
    logs = recordSleep(logs, '2026-09-08', '23:00', '06:00')!
    expect(logs.map((l) => l.date).sort()).toEqual(['2026-09-07', '2026-09-08'])
  })

  it('ありえない長さは保存しない', () => {
    // 同じ時刻は「24 時間寝た」になるので長すぎとして弾く
    expect(recordSleep([], '2026-09-08', '07:00', '07:00')).toBeNull()
    expect(recordSleep([], '2026-09-08', '07:00', '07:03')).toBeNull()
    expect(recordSleep([], '2026-09-08', '18:00', '12:00')).toBeNull()
  })
})
