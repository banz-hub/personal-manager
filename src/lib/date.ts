/** 日付と時刻の小物。よてい帳と同じ考え方でそろえてある (文字列で持ち、分に直して計算する)。 */

const P2 = (n: number) => String(n).padStart(2, '0')

/** Date → YYYY-MM-DD。ローカル時間で切る (UTC にするとズレる) */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${P2(d.getMonth() + 1)}-${P2(d.getDate())}`
}

export function todayKey(now: Date = new Date()): string {
  return dateKey(now)
}

/** YYYY-MM-DD → Date (その日の 0 時) */
export function parseDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(key: string, days: number): string {
  const d = parseDate(key)
  d.setDate(d.getDate() + days)
  return dateKey(d)
}

/** a から b までの日数 (b - a)。同じ日なら 0 */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000)
}

/** HH:MM → 0 時からの分 */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** 分 → HH:MM。24 時を超えた分も 24:30 のようにそのまま出す */
export function fromMinutes(min: number): string {
  const m = Math.max(0, Math.round(min))
  return `${P2(Math.floor(m / 60))}:${P2(m % 60)}`
}

export function nowMinutes(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes()
}

/** 60 → 「1時間」、90 → 「1時間30分」、45 → 「45分」 */
export function formatDuration(min: number): string {
  const m = Math.round(min)
  if (m < 60) return `${m}分`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}時間` : `${h}時間${rest}分`
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

/** 2026-09-07 → 「9月7日(月)」 */
export function formatDate(key: string): string {
  const d = parseDate(key)
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]})`
}

export function weekdayLabel(key: string): string {
  return WEEK[parseDate(key).getDay()]
}

/**
 * 締切を「その日の何分時点か」に直す。
 * 時刻の指定が無い締切は 23:59 とみなす (「金曜まで」は金曜いっぱい、という感覚に合わせる)。
 */
export function dueMinutes(dueTime?: string): number {
  return dueTime ? toMinutes(dueTime) : 23 * 60 + 59
}

/**
 * 締切まで何分残っているか。締切なしは null。
 * 過ぎていれば負の数になる。
 */
export function minutesUntilDue(
  today: string,
  now: number,
  dueDate?: string,
  dueTime?: string,
): number | null {
  if (!dueDate) return null
  return daysBetween(today, dueDate) * 1440 + dueMinutes(dueTime) - now
}
