import { describe, expect, it } from 'vitest'
import type { EventItem, Job } from '../types'
import { DEFAULT_CLASS_SLOTS } from './classSlots'
import { applyEvents, occurrences, parseIcs, planImport } from './icsImport'
import { buildIcs } from './ics'
import { isZip, readIcsFromZip } from './zip'

const Z = { id: 'slot-z', label: 'Z', start: '12:10', end: '13:40' }

const JOB = {
  id: 'j1',
  name: '明光義塾',
  payType: 'perClass',
  hourlyYen: 0,
  nightRate: 1,
  nightStart: '22:00',
  nightEnd: '05:00',
  closingDay: 31,
  payDay: 25,
  payMonthOffset: 1,
  transportPaid: false,
  transportPerDayYen: 0,
  classSlots: [...DEFAULT_CLASS_SLOTS, Z],
} as Job

const WHERE = '明光義塾 ひたち野うしく西口駅前教室（ひたち野うしく）'

const ev = (patch: Partial<EventItem>): EventItem => ({
  id: 'e1',
  title: '',
  category: 'private',
  date: '2026-11-04',
  start: '10:00',
  end: '11:00',
  needsTravel: false,
  ...patch,
})

/** Google の書き出しと同じ形で 1 件書く。単発は UTC（末尾 Z） */
const vevent = (lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n')
const ics = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n')

const shift = (uid: string, title: string, start: string, end: string) =>
  vevent([`UID:${uid}`, `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${title}`, `LOCATION:${WHERE}`])

const plan = (text: string, events: EventItem[] = [], from = '2026-10-30') =>
  planImport({ text: [text], from, events, trips: [], jobs: [JOB], places: [] })

describe('.ics を読む', () => {
  it('UTC の時刻を日本時間に直す（Google は単発の予定を Z で書く）', () => {
    const [o] = occurrences(
      parseIcs(ics(shift('a', 'BCD', '20261104T072000Z', '20261104T123000Z'))),
      '2026-10-30',
    ).list
    expect(o).toMatchObject({ date: '2026-11-04', start: '16:20', end: '21:30' })
  })

  it('折り返しと記号を元に戻す', () => {
    const text = ics(
      vevent([
        'UID:a',
        'DTSTART:20261104T020000Z',
        'DTEND:20261104T030000Z',
        'SUMMARY:説明会\\, 東京',
        'DESCRIPTION:1行目\\n2行',
        ' 目',
      ]),
    )
    const [v] = parseIcs(text)
    expect(v.summary).toBe('説明会, 東京')
    expect(v.description).toBe('1行目\n2行目')
  })

  it('通知の中の説明を、予定の説明と取り違えない', () => {
    const text = ics(
      vevent([
        'UID:a',
        'DTSTART:20261104T020000Z',
        'DESCRIPTION:本物',
        'BEGIN:VALARM',
        'DESCRIPTION:通知',
        'END:VALARM',
      ]),
    )
    expect(parseIcs(text)[0].description).toBe('本物')
  })

  it('取り消された予定は入れない', () => {
    const text = ics(vevent(['UID:a', 'DTSTART:20261104T020000Z', 'STATUS:CANCELLED']))
    expect(occurrences(parseIcs(text), '2026-10-30').list).toEqual([])
  })

  it('別の時間帯で書かれた予定も、日本の時計に直す', () => {
    const text = ics(
      vevent([
        'UID:a',
        'DTSTART;TZID=America/New_York:20261104T100000',
        'DTEND;TZID=America/New_York:20261104T110000',
      ]),
    )
    expect(occurrences(parseIcs(text), '2026-10-30').list[0]).toMatchObject({
      date: '2026-11-05',
      start: '00:00',
    })
  })

  it('このアプリが書き出したものも読める', () => {
    const text = buildIcs([ev({ id: 'x', title: '面接', category: 'jobhunt' })])
    const out = plan(text, [ev({ id: 'x', title: '面接', category: 'jobhunt' })])
    expect(out.add).toEqual([])
    expect(out.same).toBe(1)
  })
})

describe('繰り返しを開く', () => {
  const weekly = (rule: string, extra: string[] = []) =>
    ics(
      vevent([
        'UID:r',
        'DTSTART;TZID=Asia/Tokyo:20261102T100000',
        'DTEND;TZID=Asia/Tokyo:20261102T110000',
        `RRULE:${rule}`,
        'SUMMARY:ゼミ',
        ...extra,
      ]),
    )
  const dates = (text: string, from = '2026-10-30') =>
    occurrences(parseIcs(text), from).list.map((o) => o.date)

  it('回数と曜日のとおりに並べる', () => {
    expect(dates(weekly('FREQ=WEEKLY;COUNT=3;BYDAY=MO,WE'))).toEqual([
      '2026-11-02',
      '2026-11-04',
      '2026-11-09',
    ])
  })

  it('開始より前の回も回数に数える', () => {
    expect(dates(weekly('FREQ=WEEKLY;COUNT=3'), '2026-11-08')).toEqual(['2026-11-09', '2026-11-16'])
  })

  it('隔週と、終わりの日', () => {
    expect(dates(weekly('FREQ=WEEKLY;INTERVAL=2;UNTIL=20261201T000000Z'))).toEqual([
      '2026-11-02',
      '2026-11-16',
      '2026-11-30',
    ])
  })

  it('毎月第2月曜', () => {
    expect(dates(weekly('FREQ=MONTHLY;COUNT=2;BYDAY=2MO'), '2026-11-01')).toEqual([
      '2026-11-09',
      '2026-12-14',
    ])
  })

  it('除いた回を出さない', () => {
    const text = weekly('FREQ=WEEKLY;COUNT=2', ['EXDATE;TZID=Asia/Tokyo:20261109T100000'])
    expect(dates(text)).toEqual(['2026-11-02'])
  })

  it('1回だけ変えた回は、変えたほうを出す', () => {
    const text = ics(
      weekly('FREQ=WEEKLY;COUNT=2'),
      vevent([
        'UID:r',
        'RECURRENCE-ID;TZID=Asia/Tokyo:20261109T100000',
        'DTSTART;TZID=Asia/Tokyo:20261110T150000',
        'DTEND;TZID=Asia/Tokyo:20261110T160000',
        'SUMMARY:ゼミ（振替）',
      ]),
    )
    const list = occurrences(parseIcs(text), '2026-10-30').list
    expect(list.map((o) => `${o.date} ${o.title}`).sort()).toEqual([
      '2026-11-02 ゼミ',
      '2026-11-10 ゼミ（振替）',
    ])
  })

  it('読めない決まりは黙って落とさず、題名を返す', () => {
    const out = occurrences(parseIcs(weekly('FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO')), '2026-10-30')
    expect(out.list).toEqual([])
    expect(out.unreadable).toEqual(['ゼミ'])
  })

  it('終わりのない繰り返しも1年で止める', () => {
    expect(dates(weekly('FREQ=DAILY')).length).toBeLessThanOrEqual(367)
  })
})

describe('バイトの予定として入れる', () => {
  it('コマの題名から、給与に要るコマと仕事を入れる', () => {
    const [e] = plan(ics(shift('a', 'BCD', '20261104T072000Z', '20261104T123000Z'))).add
    expect(e).toMatchObject({ title: 'BCD', category: 'baito', jobId: 'j1', classCount: 3 })
    expect(e.classSlotIds).toEqual(['slot-b', 'slot-c', 'slot-d'])
  })

  it('コマの無い「バイト」は、時刻からコマを逆算する（11/7 の 10:25〜14:00 は YZ）', () => {
    const [e] = plan(ics(shift('a', 'バイト', '20261107T012500Z', '20261107T050000Z'))).add
    expect(e).toMatchObject({ title: 'YZ', classCount: 2 })
  })

  it('コマに当てはまらない時刻は、名前のまま入れる（11/21 の 20:00〜21:30）', () => {
    const [e] = plan(ics(shift('a', 'バイト', '20261121T110000Z', '20261121T123000Z'))).add
    expect(e).toMatchObject({ title: 'バイト', category: 'baito', jobId: 'j1' })
    expect(e.classSlotIds).toBeUndefined()
  })

  it('場所が書かれていなくても、題名がコマならバイトとみなす', () => {
    const text = ics(
      vevent(['UID:a', 'DTSTART:20261104T072000Z', 'DTEND:20261104T123000Z', 'SUMMARY:BCD']),
    )
    expect(plan(text).add[0].category).toBe('baito')
  })

  it('題名がコマの字でも、仕事が無ければバイトにしない', () => {
    const text = ics(vevent(['UID:a', 'DTSTART:20261104T072000Z', 'SUMMARY:A']))
    const out = planImport({ text: [text], from: '2026-10-30', events: [], trips: [], jobs: [], places: [] })
    expect(out.add[0].category).toBe('other')
  })
})

describe('手元の予定と突き合わせる', () => {
  const inApp = ev({
    id: 'mine',
    title: 'C',
    category: 'baito',
    date: '2026-11-17',
    start: '17:55',
    end: '19:55',
    jobId: 'j1',
    classSlotIds: ['slot-c'],
    classCount: 1,
    placeId: 'p1',
    needsTravel: true,
  })

  it('同じ日に重なるバイトは、Google の内容で上書きする（給与を二重にしない）', () => {
    const out = plan(ics(shift('g', 'BC', '20261117T072000Z', '20261117T105500Z')), [inApp])
    expect(out.add).toEqual([])
    expect(out.update).toHaveLength(1)
    expect(out.update[0].after).toMatchObject({
      id: 'mine',
      title: 'BC',
      start: '16:20',
      end: '19:55',
      classCount: 2,
      placeId: 'p1',
    })
  })

  it('同じ内容なら何も変えない', () => {
    const text = ics(shift('g', 'C', '20261117T085500Z', '20261117T105500Z'))
    const out = plan(text, [inApp])
    expect(out.add).toEqual([])
    expect(out.update).toEqual([])
    expect(out.same).toBe(1)
  })

  it('同じ日で同じ名前なら、時刻が動いていても同じ予定とみなす', () => {
    const mine = ev({ title: '面接', category: 'jobhunt', date: '2026-11-04', start: '10:00', end: '11:00' })
    const text = ics(
      vevent(['UID:g', 'DTSTART:20261104T050000Z', 'DTEND:20261104T060000Z', 'SUMMARY:面接']),
    )
    expect(plan(text, [mine]).update[0].after).toMatchObject({ start: '14:00', category: 'jobhunt' })
  })

  it('内容が違えば別の予定として足す（12/3 の産総研の 2 件）', () => {
    const mine = ev({ title: '産総研　WEB説明会', date: '2026-12-03', start: '15:30', end: '18:00' })
    const text = ics(
      vevent([
        'UID:g',
        'DTSTART:20261203T063000Z',
        'DTEND:20261203T090000Z',
        'SUMMARY:産総研　独自説明会（Zoom）',
      ]),
    )
    expect(plan(text, [mine]).add).toHaveLength(1)
  })

  it('取り込み直しても増えない。Google で時刻を変えたら追いかける', () => {
    const first = plan(ics(shift('g', 'BCD', '20261104T072000Z', '20261104T123000Z')))
    const events = applyEvents([], first)
    const again = plan(ics(shift('g', 'BCD', '20261104T072000Z', '20261104T123000Z')), events)
    expect(again.add).toEqual([])
    expect(again.same).toBe(1)

    const moved = plan(ics(shift('g', 'BC', '20261105T072000Z', '20261105T105500Z')), events)
    expect(moved.add).toEqual([])
    expect(moved.update[0].after).toMatchObject({ date: '2026-11-05', title: 'BC' })
  })

  it('同じ内容が 2 件あれば、あとから作ったほうのメモを残す', () => {
    const one = (uid: string, created: string, memo: string) =>
      vevent([
        `UID:${uid}`,
        `CREATED:${created}`,
        'DTSTART:20261104T020000Z',
        'DTEND:20261104T030000Z',
        'SUMMARY:面接',
        `DESCRIPTION:${memo}`,
      ])
    const out = plan(ics(one('new', '20261029T000000Z', '新'), one('old', '20261001T000000Z', '旧')))
    expect(out.add).toHaveLength(1)
    expect(out.add[0].memo).toBe('新')
  })

  it('指定した日より前は入れない', () => {
    expect(plan(ics(shift('g', 'C', '20261001T085500Z', '20261001T105500Z'))).add).toEqual([])
  })

  it('手元の予定を消さない', () => {
    const out = plan(ics(), [inApp])
    expect(applyEvents([inApp], out)).toEqual([inApp])
  })
})

describe('終日の予定', () => {
  const allDay = (title: string, from: string, to: string) =>
    vevent([`UID:${title}`, `DTSTART;VALUE=DATE:${from}`, `DTEND;VALUE=DATE:${to}`, `SUMMARY:${title}`])

  it('日をまたぐものは旅行として入れる。終わりの日は含む日に直す', () => {
    const out = plan(ics(allDay('京都', '20261120', '20261123')))
    expect(out.trips[0]).toMatchObject({ name: '京都', startDate: '2026-11-20', endDate: '2026-11-22' })
  })

  it('1日だけのものは入れず、題名を返す（時刻の無い予定を置く場所が無いため）', () => {
    const out = plan(ics(allDay('誕生日', '20261207', '20261208')))
    expect(out.add).toEqual([])
    expect(out.skippedAllDay.map((o) => o.title)).toEqual(['誕生日'])
  })

  it('同じ旅行が入っていれば足さない', () => {
    const out = planImport({
      text: [ics(allDay('京都', '20261120', '20261123'))],
      from: '2026-10-30',
      events: [],
      trips: [{ id: 't', name: '京都', startDate: '2026-11-20', endDate: '2026-11-22' }],
      jobs: [],
      places: [],
    })
    expect(out.trips).toEqual([])
    expect(out.same).toBe(1)
  })
})

describe('zip', () => {
  /** 1 ファイルだけの zip を組み立てる */
  async function zipOf(name: string, text: string, deflate: boolean): Promise<Uint8Array> {
    const raw = new TextEncoder().encode(text)
    const body = deflate
      ? new Uint8Array(
          await new Response(
            new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw')),
          ).arrayBuffer(),
        )
      : raw
    const nameBytes = new TextEncoder().encode(name)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(8, deflate ? 8 : 0, true)
    local.setUint16(26, nameBytes.length, true)
    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(10, deflate ? 8 : 0, true)
    dir.setUint32(20, body.length, true)
    dir.setUint16(28, nameBytes.length, true)
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, 0x06054b50, true)
    end.setUint16(10, 1, true)
    end.setUint32(16, 30 + nameBytes.length + body.length, true)
    return new Uint8Array(
      await new Blob([local.buffer, nameBytes, body as BlobPart, dir.buffer, nameBytes, end.buffer]).arrayBuffer(),
    )
  }

  it.each([
    ['圧縮あり', true],
    ['圧縮なし', false],
  ])('%sの zip から .ics を取り出す', async (_, deflate) => {
    const bytes = await zipOf('banz0926@gmail.com.ics', 'BEGIN:VCALENDAR', deflate)
    expect(isZip(bytes)).toBe(true)
    expect(await readIcsFromZip(bytes)).toEqual([
      { name: 'banz0926@gmail.com.ics', text: 'BEGIN:VCALENDAR' },
    ])
  })

  it('.ics 以外は読まない', async () => {
    expect(await readIcsFromZip(await zipOf('memo.txt', 'x', false))).toEqual([])
  })

  it('zip でなければ、そう分かる', async () => {
    expect(isZip(new TextEncoder().encode('BEGIN:VCALENDAR'))).toBe(false)
    await expect(readIcsFromZip(new Uint8Array(30))).rejects.toThrow('読めませんでした')
  })
})
