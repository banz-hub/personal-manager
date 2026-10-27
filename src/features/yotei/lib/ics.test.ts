import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventItem } from '../types'
import {
  buildIcs,
  deliverIcs,
  esc,
  eventsToExport,
  fold,
  titleOf,
  tripsToExport,
  utcOffset,
} from './ics'

const ev = (patch: Partial<EventItem> & { id: string }): EventItem => ({
  title: '',
  category: 'baito',
  date: '2026-10-16',
  start: '17:55',
  end: '21:30',
  needsTravel: false,
  ...patch,
})

const NOW = new Date('2026-10-16T00:00:00Z')

describe('出す予定を選ぶ', () => {
  it('日付の指定より前のものと、時刻の無いものは出さない', () => {
    const list = eventsToExport(
      [
        ev({ id: 'old', date: '2026-10-01' }),
        ev({ id: 'broken', date: '2026-10-20', start: '', end: '' }),
        ev({ id: 'keep', date: '2026-10-20' }),
      ],
      '2026-10-16',
    )
    expect(list.map((e) => e.id)).toEqual(['keep'])
  })

  it('題名が空なら種類の名前にする', () => {
    expect(titleOf(ev({ id: 'a' }))).toBe('バイト')
    expect(titleOf(ev({ id: 'a', title: '歯医者', category: 'private' }))).toBe('歯医者')
  })
})

describe('.ics を組み立てる', () => {
  it('入力したとおりの時刻に、時間帯を添えて書く', () => {
    const text = buildIcs([ev({ id: 'e1', title: '面接', category: 'jobhunt', start: '11:00', end: '12:00' })], {
      now: NOW,
      timeZone: 'Asia/Tokyo',
    })
    expect(text).toContain('UID:yotei-e1@banz-hub.github.io')
    // 11:00 と書いたら 11:00。UTC に直して書かない（読み込んだ先で 9 時間ずれるため）
    expect(text).toContain('DTSTART;TZID=Asia/Tokyo:20261016T110000')
    expect(text).toContain('DTEND;TZID=Asia/Tokyo:20261016T120000')
    expect(text).not.toContain('DTSTART:20261016T020000Z')
    expect(text).toContain('SUMMARY:面接')
    expect(text).toContain('CATEGORIES:就活')
    expect(text.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(text.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
  })

  it('時間帯の説明を付ける。これが無いと読む側が時刻を決められない', () => {
    const text = buildIcs([ev({ id: 'e1' })], { now: NOW, timeZone: 'Asia/Tokyo' })
    expect(text).toContain('X-WR-TIMEZONE:Asia/Tokyo')
    expect(text).toContain('BEGIN:VTIMEZONE')
    expect(text).toContain('TZID:Asia/Tokyo')
    expect(text).toContain('TZOFFSETTO:+0900')
    expect(utcOffset(NOW)).toBe('+0900')
  })

  it('日をまたぐ予定は、終わりを次の日にする', () => {
    const text = buildIcs([ev({ id: 'n', start: '22:00', end: '00:30' })], {
      now: NOW,
      timeZone: 'Asia/Tokyo',
    })
    expect(text).toContain('DTSTART;TZID=Asia/Tokyo:20261016T220000')
    expect(text).toContain('DTEND;TZID=Asia/Tokyo:20261017T003000')
  })

  it('場所とメモを書く。無ければ行を作らない', () => {
    const withPlace = buildIcs([ev({ id: 'p', station: 'ひたち野うしく', memo: '持ち物あり' })], { now: NOW, timeZone: 'Asia/Tokyo' })
    expect(withPlace).toContain('LOCATION:ひたち野うしく')
    expect(withPlace).toContain('DESCRIPTION:持ち物あり')
    expect(buildIcs([ev({ id: 'p' })], { now: NOW, timeZone: 'Asia/Tokyo' })).not.toContain('LOCATION:')
  })

  it('記号は壊れないように書き換える', () => {
    expect(esc('A;B,C\\D\nE')).toBe('A\\;B\\,C\\\\D\\nE')
  })

  it('長い行は 75 バイトで折り返し、続きの行は空白で始める', () => {
    const line = `SUMMARY:${'あ'.repeat(60)}`
    const folded = fold(line).split('\r\n')
    expect(folded.length).toBeGreaterThan(1)
    expect(folded.every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true)
    expect(folded.slice(1).every((l) => l.startsWith(' '))).toBe(true)
    // 折り返しても中身は変わらない
    expect(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(line)
  })
})

describe('旅行', () => {
  const trip = { id: 't1', name: '沖縄（サンプル）', startDate: '2026-10-20', endDate: '2026-10-22' }

  it('終日の予定として、終わりの日の次の日まで書く', () => {
    const text = buildIcs([], { trips: [trip], now: NOW })
    expect(text).toContain('UID:yotei-trip-t1@banz-hub.github.io')
    expect(text).toContain('DTSTART;VALUE=DATE:20261020')
    // 終日の予定は終わりの日を含まないので、22日までの旅行は23日と書く
    expect(text).toContain('DTEND;VALUE=DATE:20261023')
    expect(text).toContain('SUMMARY:沖縄（サンプル）')
    expect(text).toContain('CATEGORIES:旅行')
  })

  it('終わった旅行は「今日から先」に出さない', () => {
    expect(tripsToExport([trip], '2026-10-16').map((t) => t.id)).toEqual(['t1'])
    // 旅行の最中（開始は過ぎたが終わっていない）は出す
    expect(tripsToExport([trip], '2026-10-21').map((t) => t.id)).toEqual(['t1'])
    expect(tripsToExport([trip], '2026-10-23')).toEqual([])
  })
})

describe('通知', () => {
  it('1週間前・3日前・1日前・30分前を入れる', () => {
    const text = buildIcs([ev({ id: 'e1', title: '説明会', category: 'jobhunt' })], {
      now: NOW,
      timeZone: 'Asia/Tokyo',
    })
    expect(text).toContain('TRIGGER:-P1W')
    expect(text).toContain('TRIGGER:-P3D')
    expect(text).toContain('TRIGGER:-P1D')
    expect(text).toContain('TRIGGER:-PT30M')
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(4)
    expect(text).toContain('DESCRIPTION:1週間前 - 説明会')
  })

  it('旅行（終日）には30分前を入れない', () => {
    const text = buildIcs([], {
      trips: [{ id: 't1', name: '沖縄', startDate: '2026-10-20', endDate: '2026-10-22' }],
      now: NOW,
    })
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(3)
    expect(text).not.toContain('TRIGGER:-PT30M')
  })
})

describe('書き出したファイルの渡し方', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** File を使える端末のふり。中身は名前と種類だけ見る */
  class FakeFile {
    name: string
    type: string
    constructor(_parts: unknown[], name: string, opts: { type: string }) {
      this.name = name
      this.type = opts.type
    }
  }

  it('共有できる端末では共有メニューに渡す（iPhone）', async () => {
    const shared: Array<{ name: string; type: string }> = []
    vi.stubGlobal('File', FakeFile)
    vi.stubGlobal('navigator', {
      canShare: () => true,
      share: async (d: { files: Array<{ name: string; type: string }> }) => {
        shared.push({ name: d.files[0].name, type: d.files[0].type })
      },
    })
    expect(await deliverIcs('yotei.ics', 'BEGIN:VCALENDAR')).toBe('shared')
    expect(shared).toEqual([{ name: 'yotei.ics', type: 'text/calendar' }])
  })

  it('共有をやめたときは、代わりに保存し直したりしない', async () => {
    vi.stubGlobal('File', FakeFile)
    vi.stubGlobal('navigator', {
      canShare: () => true,
      share: async () => {
        const e = new Error('cancel')
        e.name = 'AbortError'
        throw e
      },
    })
    expect(await deliverIcs('yotei.ics', 'x')).toBe('cancelled')
  })

  it('共有できない端末では保存に回す', async () => {
    const clicked: string[] = []
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('File', undefined)
    vi.stubGlobal('Blob', class {})
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })
    vi.stubGlobal('window', { setTimeout: () => 0 })
    vi.stubGlobal('document', {
      createElement: () => ({
        click: () => clicked.push('click'),
        remove: () => {},
        set href(_v: string) {},
        set download(_v: string) {},
      }),
      body: { appendChild: () => {} },
    })
    expect(await deliverIcs('yotei.ics', 'x')).toBe('downloaded')
    expect(clicked).toEqual(['click'])
  })

  it('どちらもできない端末では、できたことにしない', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('File', undefined)
    vi.stubGlobal('document', undefined)
    expect(await deliverIcs('yotei.ics', 'x')).toBe('failed')
  })
})
