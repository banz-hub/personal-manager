import { describe, expect, it } from 'vitest'
import type { EventItem } from '../types'
import { buildIcs, esc, eventsToExport, fold, titleOf } from './ics'

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
  it('UTC の時刻と、読み込み直しても増えない UID を書く', () => {
    const text = buildIcs([ev({ id: 'e1', title: '面接', category: 'jobhunt', start: '11:00', end: '12:00' })], {
      now: NOW,
    })
    expect(text).toContain('UID:yotei-e1@banz-hub.github.io')
    // 端末は JST。11:00 JST は 02:00 UTC
    expect(text).toContain('DTSTART:20261016T020000Z')
    expect(text).toContain('DTEND:20261016T030000Z')
    expect(text).toContain('SUMMARY:面接')
    expect(text).toContain('CATEGORIES:就活')
    expect(text.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(text.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
  })

  it('日をまたぐ予定は、終わりを次の日にする', () => {
    const text = buildIcs([ev({ id: 'n', start: '22:00', end: '00:30' })], { now: NOW })
    expect(text).toContain('DTSTART:20261016T130000Z')
    expect(text).toContain('DTEND:20261016T153000Z')
  })

  it('場所とメモを書く。無ければ行を作らない', () => {
    const withPlace = buildIcs([ev({ id: 'p', station: 'ひたち野うしく', memo: '持ち物あり' })], { now: NOW })
    expect(withPlace).toContain('LOCATION:ひたち野うしく')
    expect(withPlace).toContain('DESCRIPTION:持ち物あり')
    expect(buildIcs([ev({ id: 'p' })], { now: NOW })).not.toContain('LOCATION:')
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
