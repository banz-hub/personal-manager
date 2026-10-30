/**
 * Google カレンダーから書き出した .ics を、予定に取り込む。`ics.ts` の逆向き。
 *
 * **Google の API は呼ばない。**理由は書き出しと同じで、鍵を隠す場所が無いため。
 * 本人が書き出したファイルを読むだけなので、データが外へ出ることもない。
 *
 * 3 段に分けてある。
 *   1. `parseIcs`   … ファイルを 1 件ずつの VEVENT にする
 *   2. `occurrences` … 繰り返しを開いて、日付の付いた 1 回ずつにする
 *   3. `planImport` … いまの予定と突き合わせ、足す・直す・そのままを決める（まだ保存しない）
 * 保存の前に画面で中身を見せるため、3 は結果を返すだけにしてある。
 *
 * **Google の色は .ics に入ってこない。**なので種類は題名と場所から当てる。
 * 外した種類は自分で直せる（`guess.ts` と同じ考え方）。
 *
 * **取り込みは足す・直すだけで、消さない。**Google で消した予定はファイルに無いだけで、
 * 「消された」のか「範囲の外」なのかを区別できないため。
 */

import type { EventCategory, EventItem, Job, Place, Trip } from '../types'
import { selectionFor, shiftLabelsOf, shiftTitle, isAutoShiftTitle } from './classSlots'
import { addDays, parseDate, toDateKey, toMinutes, toTimeKey } from './date'
import { deviceTimeZone } from './ics'
import { guessCategory, normalize } from './guess'
import { newId } from './id'

// ---------- 1. 読む ----------

interface IcsTime {
  value: string
  tzid?: string
}

export interface VEvent {
  uid: string
  summary: string
  description: string
  location: string
  status: string
  created: string
  start: IcsTime
  end?: IcsTime
  /** PT1H のような長さ。DTEND の代わりに書かれることがある */
  duration?: string
  rrule?: string
  exdates: IcsTime[]
  recurrenceId?: IcsTime
}

/** 折り返された行を 1 行に戻す（行頭の空白 1 つが「前の行の続き」の印） */
function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function unescapeText(text: string): string {
  return text.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

/** 「DTSTART;TZID=Asia/Tokyo:2026…」を名前・付帯情報・値に分ける */
function splitLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  // 付帯情報の値は " で囲まれていることがあり、その中の : は区切りではない
  let quoted = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (line[i] === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon < 0) return null
  const [name, ...rest] = line.slice(0, colon).split(';')
  const params: Record<string, string> = {}
  for (const p of rest) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/"/g, '')
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) }
}

export function parseIcs(text: string): VEvent[] {
  const out: VEvent[] = []
  let current: VEvent | null = null
  // VEVENT の中の VALARM にも DESCRIPTION があるので、そこは読み飛ばす
  let nested = 0

  for (const line of unfold(text)) {
    const p = splitLine(line)
    if (!p) continue
    if (p.name === 'BEGIN') {
      if (p.value === 'VEVENT') {
        current = {
          uid: '',
          summary: '',
          description: '',
          location: '',
          status: '',
          created: '',
          start: { value: '' },
          exdates: [],
        }
      } else if (current) nested += 1
      continue
    }
    if (p.name === 'END') {
      if (p.value === 'VEVENT') {
        if (current?.start.value) out.push(current)
        current = null
      } else if (current) nested -= 1
      continue
    }
    if (!current || nested > 0) continue

    const time: IcsTime = { value: p.value, tzid: p.params.TZID }
    switch (p.name) {
      case 'UID':
        current.uid = p.value
        break
      case 'SUMMARY':
        current.summary = unescapeText(p.value).trim()
        break
      case 'DESCRIPTION':
        current.description = unescapeText(p.value).trim()
        break
      case 'LOCATION':
        current.location = unescapeText(p.value).trim()
        break
      case 'STATUS':
        current.status = p.value.toUpperCase()
        break
      case 'CREATED':
        current.created = p.value
        break
      case 'DTSTART':
        current.start = time
        break
      case 'DTEND':
        current.end = time
        break
      case 'DURATION':
        current.duration = p.value
        break
      case 'RRULE':
        current.rrule = p.value
        break
      case 'EXDATE':
        for (const value of p.value.split(',')) current.exdates.push({ value, tzid: p.params.TZID })
        break
      case 'RECURRENCE-ID':
        current.recurrenceId = time
        break
    }
  }
  return out
}

// ---------- 時刻 ----------

const isAllDay = (t: IcsTime) => /^\d{8}$/.test(t.value)

function dateOf(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function partsOf(value: string): [number, number, number, number, number, number] {
  return [
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
    Number(value.slice(9, 11)),
    Number(value.slice(11, 13)),
    Number(value.slice(13, 15)),
  ]
}

/** その時間帯の「壁の時計」が指す瞬間 */
function wallClockIn(tzid: string, value: string): Date {
  const utc = Date.UTC(...partsOf(value))
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tzid,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  const p = Object.fromEntries(f.formatToParts(new Date(utc)).map((x) => [x.type, Number(x.value)]))
  const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return new Date(utc - (shown - utc))
}

/**
 * .ics の時刻を、この端末の時計に直す。
 * Google の書き出しは単発の予定を **UTC（末尾 Z）** で書くので、ここを素通しすると 9 時間ずれる。
 */
export function toLocal(t: IcsTime): Date {
  const [y, mo, d, h, mi, s] = partsOf(t.value)
  if (t.value.endsWith('Z')) return new Date(Date.UTC(y, mo, d, h, mi, s))
  if (t.tzid && t.tzid !== deviceTimeZone()) {
    try {
      return wallClockIn(t.tzid, t.value)
    } catch {
      // 知らない時間帯は、書かれた時刻のまま受け取る
    }
  }
  return new Date(y, mo, d, h, mi, s)
}

function dateKeyOf(t: IcsTime): string {
  return isAllDay(t) ? dateOf(t.value) : toDateKey(toLocal(t))
}

function durationMs(text: string): number {
  const m = text.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!m) return 0
  const [w, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0))
  return ((w * 7 + d) * 24 * 60 + h * 60 + mi) * 60_000 + s * 1000
}

// ---------- 2. 繰り返しを開く ----------

/** 1 回ぶんの予定。繰り返しでも日付ごとに別のものとして扱う */
export interface Occurrence {
  /** 取り込み直したときに同じものだと分かるための名前 */
  key: string
  uid: string
  title: string
  memo: string
  location: string
  created: string
  /** YYYY-MM-DD */
  date: string
  /** 終日の予定なら null */
  start: string | null
  end: string | null
  /** 終わる日。終日なら含む日 */
  endDate: string
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** どこまで先の繰り返しを開くか。終わりのない繰り返しが無限に並ばないように */
const REPEAT_DAYS = 366
/** 開始日からの走査の上限。何年も前に始まった毎日の予定でも止まるように */
const MAX_SCAN_DAYS = 366 * 30

function parseRule(rule: string): Record<string, string> {
  return Object.fromEntries(
    rule.split(';').map((p) => {
      const eq = p.indexOf('=')
      return [p.slice(0, eq).toUpperCase(), p.slice(eq + 1)]
    }),
  )
}

/** 月の第 n 週の曜日か（-1 は最後の週）。「毎月第2月曜」の判定 */
function isNthWeekday(date: Date, code: string): boolean {
  const m = code.match(/^(-?\d)?([A-Z]{2})$/)
  if (!m || WEEKDAYS[date.getDay()] !== m[2]) return false
  if (!m[1]) return true
  const n = Number(m[1])
  if (n > 0) return Math.ceil(date.getDate() / 7) === n
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return Math.ceil((last - date.getDate() + 1) / 7) === -n
}

/** 読めない繰り返しなら null。黙って 1 回だけ入れると、予定が消えたように見えるため */
function ruleMatcher(rule: Record<string, string>, first: Date): ((d: Date) => boolean) | null {
  const interval = Math.max(1, Number(rule.INTERVAL ?? 1))
  const byDay = rule.BYDAY?.split(',')
  const diffDays = (d: Date) => Math.round((d.getTime() - first.getTime()) / 86_400_000)
  const diffMonths = (d: Date) =>
    (d.getFullYear() - first.getFullYear()) * 12 + d.getMonth() - first.getMonth()

  // 開いている中で使っていない条件が付いていたら、読めないものとして扱う
  const known = ['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST', 'BYMONTHDAY', 'BYMONTH']
  if (Object.keys(rule).some((k) => !known.includes(k))) return null

  switch (rule.FREQ) {
    case 'DAILY':
      return (d) => diffDays(d) % interval === 0
    case 'WEEKLY': {
      const days = byDay ?? [WEEKDAYS[first.getDay()]]
      // 週は月曜はじまり（Google の既定）。間隔が 2 週以上のときに効く
      const monday = (first.getDay() + 6) % 7
      return (d) =>
        days.includes(WEEKDAYS[d.getDay()]) &&
        Math.floor((diffDays(d) + monday) / 7) % interval === 0
    }
    case 'MONTHLY': {
      if (byDay) return (d) => diffMonths(d) % interval === 0 && byDay.some((c) => isNthWeekday(d, c))
      const day = Number(rule.BYMONTHDAY ?? first.getDate())
      return (d) => diffMonths(d) % interval === 0 && d.getDate() === day
    }
    case 'YEARLY':
      return (d) =>
        diffMonths(d) % (12 * interval) === 0 && d.getDate() === first.getDate()
    default:
      return null
  }
}

export interface Expanded {
  list: Occurrence[]
  /** 繰り返しの決まりが読めなかった予定の題名 */
  unreadable: string[]
}

function oneOf(v: VEvent, date: string, key: string): Occurrence {
  const allDay = isAllDay(v.start)
  const title = v.summary
  const base = { key, uid: v.uid, title, memo: v.description, location: v.location, created: v.created }
  if (allDay) {
    const span = v.end ? dateOf(v.end.value) : addDays(dateOf(v.start.value), 1)
    const days = Math.max(
      1,
      Math.round((parseDate(span).getTime() - parseDate(dateOf(v.start.value)).getTime()) / 86_400_000),
    )
    // 終わりの日は「含まない」決まりなので 1 日戻す
    return { ...base, date, start: null, end: null, endDate: addDays(date, days - 1) }
  }
  const startAt = toLocal(v.start)
  const ms = v.end
    ? toLocal(v.end).getTime() - startAt.getTime()
    : v.duration
      ? durationMs(v.duration)
      : 0
  const startClock = new Date(parseDate(date))
  startClock.setHours(startAt.getHours(), startAt.getMinutes())
  const endAt = new Date(startClock.getTime() + ms)
  return {
    ...base,
    date,
    start: toTimeKey(startClock),
    end: toTimeKey(endAt),
    endDate: toDateKey(endAt),
  }
}

/** ファイル全部を、from 以降の 1 回ずつに開く */
export function occurrences(events: VEvent[], from: string): Expanded {
  const until = addDays(from, REPEAT_DAYS)
  const list: Occurrence[] = []
  const unreadable: string[] = []

  // 繰り返しのうち 1 回だけ変えた・消したものは、別の VEVENT として届く
  const changed = new Set(
    events.filter((v) => v.recurrenceId).map((v) => `${v.uid}#${dateKeyOf(v.recurrenceId as IcsTime)}`),
  )

  for (const v of events) {
    const cancelled = v.status === 'CANCELLED'

    if (v.recurrenceId) {
      const key = `${v.uid}#${dateKeyOf(v.recurrenceId)}`
      const date = dateKeyOf(v.start)
      if (!cancelled && date >= from) list.push(oneOf(v, date, key))
      continue
    }
    if (cancelled) continue

    const first = dateKeyOf(v.start)
    if (!v.rrule) {
      const o = oneOf(v, first, v.uid)
      if (o.endDate >= from) list.push(o)
      continue
    }

    const rule = parseRule(v.rrule)
    const firstDate = parseDate(first)
    const match = ruleMatcher(rule, firstDate)
    if (!match) {
      unreadable.push(v.summary)
      continue
    }
    const skip = new Set(v.exdates.map(dateKeyOf))
    const last = rule.UNTIL ? dateKeyOf({ value: rule.UNTIL }) : until
    const limit = Number(rule.COUNT ?? Infinity)
    let done = 0
    for (let i = 0, d = first; i < MAX_SCAN_DAYS && d <= until && d <= last && done < limit; i++) {
      if (match(parseDate(d))) {
        done += 1
        const key = `${v.uid}#${d}`
        if (d >= from && !skip.has(d) && !changed.has(key)) list.push(oneOf(v, d, key))
      }
      d = addDays(d, 1)
    }
  }
  return { list, unreadable }
}

// ---------- 3. 予定にする ----------

/** 同じ日のものを同じ内容か比べるための題名。古い「バイト BCD」も「BCD」と同じに見る */
function sameTitle(title: string): string {
  return normalize(shiftLabelsOf(title) ?? title)
}

function jobOfLocation(location: string, jobs: Job[]): Job | undefined {
  const where = normalize(location)
  return where ? jobs.find((j) => where.includes(normalize(j.name))) : undefined
}

/** 題名がコマの並びなら、そのコマを返す（「BCD」「朝・夜勤」） */
function slotsOfTitle(title: string, job: Job): string[] {
  const t = shiftLabelsOf(title) ?? title.trim()
  const slots = job.classSlots ?? []
  if (!t || !isAutoShiftTitle(t, job)) return []
  const parts = t.includes('・') ? t.split('・') : [...t]
  return slots.filter((s) => parts.includes(s.label.trim())).map((s) => s.id)
}

/**
 * 時刻からコマを逆算する。続きのコマの並びで在校時間が一致するものを探す。
 * 「バイト 10:25〜14:00」のように、コマを選ばずに入った予定を給与に数えるため。
 */
function slotsOfTime(job: Job, start: string, end: string): string[] {
  const sorted = [...(job.classSlots ?? [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i; j < sorted.length; j++) {
      const ids = sorted.slice(i, j + 1).map((s) => s.id)
      const picked = selectionFor(job, ids)
      if (picked?.start === start && picked.end === end) return ids
    }
  }
  return []
}

interface ShiftFields {
  jobId: string
  classSlotIds?: string[]
  classCount?: number
}

/** バイトの予定なら、どの仕事のどのコマかを決める。バイトでなければ null */
function shiftOf(o: Occurrence, jobs: Job[]): { fields: ShiftFields; title: string } | null {
  const start = o.start ?? ''
  const end = o.end ?? ''
  const byPlace = jobOfLocation(o.location, jobs)
  const candidates = byPlace ? [byPlace] : jobs

  for (const job of candidates) {
    const fromTitle = slotsOfTitle(o.title, job)
    const isShift = byPlace != null || fromTitle.length > 0 || /^バイト(\s|　|$)/.test(o.title.trim())
    if (!isShift) continue
    const ids = fromTitle.length > 0 ? fromTitle : slotsOfTime(job, start, end)
    if (ids.length > 0) {
      return {
        fields: { jobId: job.id, classSlotIds: ids, classCount: ids.length },
        // 自分で付けた名前（「明光 テスト対策」）はコマが分かっても書き換えない
        title: isAutoShiftTitle(o.title, job) ? shiftTitle(job, ids) : o.title,
      }
    }
    return { fields: { jobId: job.id }, title: o.title }
  }
  return null
}

function placeOf(location: string, places: Place[]): Place | undefined {
  const where = normalize(location)
  return where
    ? places.find((p) => where.includes(normalize(p.name)) || (p.station && where.includes(normalize(p.station))))
    : undefined
}

function categoryOf(o: Occurrence, jobs: Job[]): EventCategory {
  return (
    guessCategory({ title: `${o.title} ${o.location}`, jobNames: jobs.map((j) => j.name) })?.category ??
    'other'
  )
}

/** 新しく足す予定。場所が分からなければメモに残し、移動の逆算はしない */
function toEvent(o: Occurrence, jobs: Job[], places: Place[]): EventItem {
  const shift = shiftOf(o, jobs)
  const job = shift ? jobs.find((j) => j.id === shift.fields.jobId) : undefined
  const place = placeOf(o.location, places) ?? places.find((p) => p.id === job?.placeId)
  const memo = [o.location && !place ? `場所: ${o.location}` : '', o.memo].filter(Boolean).join('\n')
  return {
    id: newId('ev'),
    title: shift?.title ?? o.title,
    category: shift ? 'baito' : categoryOf(o, jobs),
    date: o.date,
    start: o.start as string,
    end: o.end as string,
    needsTravel: place != null,
    ...(place ? { placeId: place.id } : {}),
    ...(memo ? { memo } : {}),
    ...(shift?.fields ?? {}),
    sourceUid: o.key,
  }
}

/** Google で書き換えられた中身を、手元の予定に重ねる。手元にしか無い項目（場所の登録など）は残す */
function merged(e: EventItem, o: Occurrence, jobs: Job[]): EventItem {
  const shift = e.category === 'baito' ? shiftOf({ ...o, location: o.location || (jobs.find((j) => j.id === e.jobId)?.name ?? '') }, jobs) : null
  const next: EventItem = {
    ...e,
    title: shift?.title ?? o.title,
    date: o.date,
    start: o.start as string,
    end: o.end as string,
    sourceUid: o.key,
  }
  if (shift) Object.assign(next, { classSlotIds: undefined, classCount: undefined }, shift.fields)
  if (o.memo) next.memo = o.memo
  return next
}

const differs = (a: EventItem, b: EventItem) =>
  a.title !== b.title ||
  a.date !== b.date ||
  a.start !== b.start ||
  a.end !== b.end ||
  (a.memo ?? '') !== (b.memo ?? '') ||
  (a.classSlotIds ?? []).join() !== (b.classSlotIds ?? []).join()

const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) =>
  toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end)

/** ファイルの 1 回ぶんが、手元のどの予定にあたるか */
function findExisting(o: Occurrence, events: EventItem[], jobs: Job[]): EventItem | undefined {
  // 前に取り込んだものと、このアプリから書き出したもの。時刻が変わっていても追える
  const byKey = events.find(
    (e) => e.sourceUid === o.key || `yotei-${e.id}@banz-hub.github.io` === o.uid,
  )
  if (byKey) return byKey

  const sameDay = events.filter((e) => e.date === o.date)
  const title = sameTitle(o.title)
  const named = sameDay.find((e) => sameTitle(e.title) === title)
  if (named) return named

  // 名前が変わっていても、同じ日に重なるバイトは同じ勤務。別物として足すと給与が二重になる
  // （11/17 は「C 17:55〜」のあとに Google 側だけ「BC 16:20〜」へ変わっていた）
  if (shiftOf(o, jobs)) {
    return sameDay.find(
      (e) => e.category === 'baito' && overlaps(e, { start: o.start as string, end: o.end as string }),
    )
  }
  return undefined
}

export interface ImportPlan {
  add: EventItem[]
  update: Array<{ before: EventItem; after: EventItem }>
  /** すでに同じものがあった件数 */
  same: number
  /** 手元に中身の変更は無いが、次回のために印だけ付けるもの */
  marked: EventItem[]
  /** 日をまたいで続く終日の予定。旅行として入れる */
  trips: Trip[]
  /** 入れなかったもの。理由ごとに題名を出す */
  skippedAllDay: Occurrence[]
  unreadable: string[]
}

interface PlanInput {
  text: string[]
  from: string
  events: EventItem[]
  trips: Trip[]
  jobs: Job[]
  places: Place[]
}

/** 同じ内容が 2 件あったら、あとから作られたほうだけ残す（本人の決めごと） */
function latestOnly(list: Occurrence[]): Occurrence[] {
  const byContent = new Map<string, Occurrence>()
  const ordered = [...list].sort((a, b) => a.created.localeCompare(b.created))
  for (const o of ordered) {
    byContent.set(`${o.date}|${o.start}|${o.end}|${sameTitle(o.title)}`, o)
  }
  return [...byContent.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''),
  )
}

export function planImport(input: PlanInput): ImportPlan {
  const { from, events, trips, jobs, places } = input
  const expanded = input.text.map((t) => occurrences(parseIcs(t), from))
  const plan: ImportPlan = {
    add: [],
    update: [],
    same: 0,
    marked: [],
    trips: [],
    skippedAllDay: [],
    unreadable: expanded.flatMap((x) => x.unreadable),
  }

  const taken = new Set<string>()
  for (const o of latestOnly(expanded.flatMap((x) => x.list))) {
    // 日をまたぐ時刻つきの予定（夜勤など）は 1 日の予定に入る。24 時間を超えるものだけ終日扱い
    const long = o.start != null && o.endDate > addDays(o.date, 1)
    if (o.start == null || long) {
      if (o.endDate > o.date) {
        if (!trips.some((t) => t.name === o.title && t.startDate === o.date)) {
          plan.trips.push({ id: newId('trip'), name: o.title, startDate: o.date, endDate: o.endDate, memo: o.memo || undefined })
        } else plan.same += 1
      } else plan.skippedAllDay.push(o)
      continue
    }

    const found = findExisting(o, events.filter((e) => !taken.has(e.id)), jobs)
    if (!found) {
      plan.add.push(toEvent(o, jobs, places))
      continue
    }
    taken.add(found.id)
    const after = merged(found, o, jobs)
    if (differs(found, after)) plan.update.push({ before: found, after })
    else {
      plan.same += 1
      if (found.sourceUid !== o.key) plan.marked.push(after)
    }
  }
  return plan
}

/** 計画を予定の一覧に当てる */
export function applyEvents(events: EventItem[], plan: ImportPlan): EventItem[] {
  const changed = new Map([...plan.update.map((u) => u.after), ...plan.marked].map((e) => [e.id, e]))
  return [...events.map((e) => changed.get(e.id) ?? e), ...plan.add]
}
