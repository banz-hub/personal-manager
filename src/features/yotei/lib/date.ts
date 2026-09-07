/** 日付と時刻の小物。日付は端末のローカル時間で 'YYYY-MM-DD'、時刻は 'HH:MM' で扱う。 */

export const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

const p2 = (n: number) => String(n).padStart(2, '0')

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

export function toTimeKey(d: Date): string {
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

export function todayKey(): string {
  return toDateKey(new Date())
}

/** 'YYYY-MM-DD' を端末のローカル時間の Date にする (UTC 解釈を避ける) */
export function parseDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** 'HH:MM' を 0時からの分に */
export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/** 分を 'HH:MM' に。24時をまたいだら翌日側に折り返す */
export function fromMinutes(min: number): string {
  const wrapped = ((min % 1440) + 1440) % 1440
  return `${p2(Math.floor(wrapped / 60))}:${p2(wrapped % 60)}`
}

/** 日付と時刻から Date を作る */
export function at(dateKey: string, time: string): Date {
  const d = parseDate(dateKey)
  d.setHours(0, toMinutes(time), 0, 0)
  return d
}

export function addDays(key: string, days: number): string {
  const d = parseDate(key)
  d.setDate(d.getDate() + days)
  return toDateKey(d)
}

export function addMonths(key: string, months: number): string {
  const d = parseDate(key)
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  return toDateKey(d)
}

/** その月の 1 日 */
export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate()
}

/** 'YYYY-MM' */
export function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7)
}

export function yearKey(dateKey: string): string {
  return dateKey.slice(0, 4)
}

export function formatDate(key: string, withDay = true): string {
  const d = parseDate(key)
  const base = `${d.getMonth() + 1}月${d.getDate()}日`
  return withDay ? `${base}(${DAY_LABELS[d.getDay()]})` : base
}

export function formatMonth(ym: string): string {
  const [y, m] = ym.split('-')
  return `${y}年${Number(m)}月`
}

/** 分を「1時間30分」の形に */
export function formatDuration(min: number): string {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest}分`
  if (rest === 0) return `${h}時間`
  return `${h}時間${rest}分`
}

export function formatYen(yen: number): string {
  return `${Math.round(yen).toLocaleString('ja-JP')}円`
}

/** dateKey が [from, to] の範囲に入っているか (両端を含む) */
export function inRange(dateKey: string, from: string, to: string): boolean {
  return dateKey >= from && dateKey <= to
}

/** 2つの時間帯 [aStart, aEnd) と [bStart, bEnd) が重なる分数 (分単位) */
export function overlapMinutes(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}
