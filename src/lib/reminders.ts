/**
 * 通知。
 *
 * ブラウザだけで完結するアプリなので、通知の確実さには限界がある。
 * **アプリを閉じていても確実に鳴らす方法は、ブラウザだけでは無い。**
 * Web Push を使うには通知を配る側のサーバーが要るが、このアプリはサーバーを持たない。
 *
 * そこで、効く順に 3 段構えにしてある。
 *   1. 端末のカレンダーへ入れる (.ics) — 端末側のアラームなので、
 *      アプリを閉じていても、電源が入っていれば確実に鳴る。iPhone ではこれが本命
 *   2. 通知トリガー (TimestampTrigger) — 対応ブラウザ (Android の Chrome など) なら
 *      アプリを閉じていても鳴る。iOS Safari は非対応
 *   3. アプリを開いている間のタイマー — どの環境でも動く保険。画面の中にも出す
 *
 * iPhone は「ホーム画面に追加」して起動した状態でないと、そもそも通知が使えない。
 */

import type { DayPlan, Task } from '../types'
import { formatDuration, parseDate, toMinutes } from './date'

export interface NotificationSupport {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  /** アプリを閉じていても時刻指定で通知できるか */
  canScheduleInBackground: boolean
  /** ホーム画面から起動した状態か */
  standalone: boolean
  /** なぜ限界があるかの説明。画面にそのまま出す */
  note: string
}

declare global {
  interface Window {
    TimestampTrigger?: new (timestamp: number) => unknown
  }
  interface NotificationOptions {
    showTrigger?: unknown
  }
  interface GetNotificationOptions {
    includeTriggered?: boolean
  }
}

export function notificationSupport(): NotificationSupport {
  const supported = typeof window !== 'undefined' && 'Notification' in window
  const canScheduleInBackground =
    supported &&
    'showTrigger' in Notification.prototype &&
    typeof window.TimestampTrigger !== 'undefined'
  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true)

  let note: string
  if (!supported) {
    note = 'このブラウザは通知に対応していません。カレンダーに入れる方法を使ってください。'
  } else if (!standalone) {
    note =
      'ホーム画面に追加して、そこから開いた状態でないと通知が使えないことがあります（とくに iPhone）。'
  } else if (canScheduleInBackground) {
    note = 'この端末はアプリを閉じていても通知を出せます。'
  } else {
    note =
      'この端末では、アプリを閉じている間の通知は出せません（サーバーが要るため）。確実に鳴らすには「カレンダーに入れる」を使ってください。'
  }

  return { supported, permission: supported ? Notification.permission : 'unsupported', canScheduleInBackground, standalone, note }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  return Notification.requestPermission()
}

export interface PendingReminder {
  key: string
  at: Date
  title: string
  body: string
  /** 画面のポップ表示にも出すか */
  popup: boolean
}

const TAG_PREFIX = 'shireitou'

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

export async function showNow(title: string, body: string): Promise<boolean> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false
  const options: NotificationOptions = { body, tag: `${TAG_PREFIX}-now` }
  const reg = await registration()
  if (reg) {
    await reg.showNotification(title, options)
    return true
  }
  try {
    new Notification(title, options)
    return true
  } catch {
    return false
  }
}

/**
 * 対応ブラウザなら、アプリを閉じていても時刻に通知が出るよう予約する。
 * 予約できた件数を返す (0 なら非対応)。
 */
export async function scheduleBackground(reminders: PendingReminder[]): Promise<number> {
  const support = notificationSupport()
  if (!support.canScheduleInBackground || support.permission !== 'granted') return 0
  const reg = await registration()
  if (!reg) return 0

  // 前に予約したぶんを消してから貼り直す (予定を作り直しても二重に鳴らないため)
  const existing = await reg.getNotifications({ includeTriggered: false })
  for (const n of existing) if (n.tag?.startsWith(TAG_PREFIX)) n.close()

  let count = 0
  for (const r of reminders) {
    if (r.at.getTime() <= Date.now()) continue
    try {
      await reg.showNotification(r.title, {
        body: r.body,
        tag: `${TAG_PREFIX}-${r.key}`,
        showTrigger: new window.TimestampTrigger!(r.at.getTime()),
      } as NotificationOptions)
      count++
    } catch {
      break
    }
  }
  return count
}

/**
 * アプリを開いている間だけ動くタイマー。戻り値を呼ぶと解除される。
 * setTimeout の上限を避けるため、遠い予定は一度起きてから貼り直す。
 */
export function scheduleWhileOpen(
  reminders: PendingReminder[],
  onFire: (r: PendingReminder) => void,
): () => void {
  let timer: number | undefined
  const fired = new Set<string>()

  const arm = () => {
    const next = reminders
      .filter((r) => !fired.has(r.key) && r.at.getTime() > Date.now())
      .sort((a, b) => a.at.getTime() - b.at.getTime())[0]
    if (!next) return
    const delay = Math.min(next.at.getTime() - Date.now(), 6 * 60 * 60 * 1000)
    timer = window.setTimeout(
      () => {
        if (Date.now() >= next.at.getTime() - 1000) {
          fired.add(next.key)
          onFire(next)
        }
        arm()
      },
      Math.max(1000, delay),
    )
  }
  arm()

  return () => {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

// ---------- 何を知らせるか ----------

export interface ReminderInput {
  date: string
  plan?: DayPlan
  tasks: Task[]
  /** コマの何分前に知らせるか */
  beforeMin: number
}

function at(date: string, hhmm: string, offsetMin = 0): Date {
  const d = parseDate(date)
  const min = toMinutes(hhmm) - offsetMin
  d.setMinutes(d.getMinutes() + min)
  return d
}

/**
 * その日の通知の一覧を作る。
 * 予定表のコマの開始と、今日が締切のタスクを対象にする。
 */
export function buildReminders(input: ReminderInput): PendingReminder[] {
  const out: PendingReminder[] = []

  for (const b of input.plan?.blocks ?? []) {
    if (b.kind !== 'task' && b.kind !== 'study' && b.kind !== 'workout') continue
    if (b.doneAt) continue
    const minutes = toMinutes(b.end) - toMinutes(b.start)
    out.push({
      key: `blk-${b.id}`,
      at: at(input.date, b.start, input.beforeMin),
      title: `${b.start} から ${b.title}`,
      body: `${formatDuration(minutes)}の予定です${b.reason ? `。${b.reason}` : ''}`,
      popup: true,
    })
  }

  for (const t of input.tasks) {
    if (t.status === 'done' || t.status === 'dropped') continue
    if (t.dueDate !== input.date || !t.dueTime) continue
    // 締切そのものではなく、少し前に知らせる
    out.push({
      key: `due-${t.id}`,
      at: at(input.date, t.dueTime, Math.max(input.beforeMin, 30)),
      title: `まもなく締切: ${t.title}`,
      body: `${t.dueTime} が締切です`,
      popup: true,
    })
  }

  return out
    .filter((r) => !Number.isNaN(r.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
}

// ---------- 端末のカレンダーに入れる (.ics) ----------

function icsTime(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}T${p2(d.getHours())}${p2(d.getMinutes())}00`
}

/** .ics の中で改行や記号が壊れないようにする */
function esc(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/**
 * その日の予定を .ics にする。**アラーム付きで端末のカレンダーに入る。**
 *
 * ブラウザの通知と違って端末側の仕組みなので、アプリを閉じていても鳴る。
 * iPhone で「閉じていても届く」を成り立たせる、いまのところ唯一の確実な方法。
 */
export function buildPlanIcs(plan: DayPlan, date: string, beforeMin: number): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//shireitou//JP',
    'CALSCALE:GREGORIAN',
  ]

  for (const b of plan.blocks) {
    if (b.kind !== 'task' && b.kind !== 'study' && b.kind !== 'workout') continue
    lines.push(
      'BEGIN:VEVENT',
      `UID:shireitou-${b.id}@banz-hub.github.io`,
      `DTSTAMP:${icsTime(new Date())}`,
      `DTSTART:${icsTime(at(date, b.start))}`,
      `DTEND:${icsTime(at(date, b.end))}`,
      `SUMMARY:${esc(b.title)}`,
      `DESCRIPTION:${esc(b.reason ?? '司令塔が組んだ予定')}`,
      'BEGIN:VALARM',
      `TRIGGER:-PT${Math.max(0, beforeMin)}M`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(b.title)}`,
      'END:VALARM',
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  // .ics は CRLF で区切る決まり
  return lines.join('\r\n')
}

export function downloadIcs(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 「19:00 から 数学課題」のような、いま鳴らすべきものが何件あるか */
export function dueNow(reminders: PendingReminder[], now: Date, windowMin = 1): PendingReminder[] {
  const from = now.getTime() - windowMin * 60_000
  return reminders.filter((r) => r.at.getTime() >= from && r.at.getTime() <= now.getTime())
}
