/**
 * トレーニングのリマインダー。
 *
 * ブラウザだけで完結するアプリなので、通知の実現手段には限界がある。
 * ここでは実際に効く順に3段構えにしている。
 *   1. カレンダー登録 (.ics) — 端末のカレンダーに繰り返し予定＋アラームを入れる。最も確実
 *   2. 通知トリガー (TimestampTrigger) — 対応ブラウザならアプリを閉じていても時刻に通知が出る
 *   3. アプリを開いている間のタイマー + 次回起動時の未実施チェック — どの環境でも動く保険
 *
 * 端末の設定はデバイスごとに違うので、バックアップ対象にはせず localStorage に持つ。
 */

// Notification Triggers はまだ標準の型定義に入っていないので、ここで最小限だけ宣言する
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

const KEY = 'kintore.reminder'

export interface ReminderSettings {
  enabled: boolean
  /** 曜日。JavaScript の getDay() と同じ 0=日曜 〜 6=土曜 */
  days: number[]
  /** 'HH:MM' */
  time: string
  /** その日すでに記録済みなら通知しない */
  skipIfLogged: boolean
}

export const DEFAULT_REMINDER: ReminderSettings = {
  enabled: false,
  days: [1, 3, 5],
  time: '19:00',
  skipIfLogged: true,
}

export const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export function loadReminder(): ReminderSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_REMINDER
    return { ...DEFAULT_REMINDER, ...(JSON.parse(raw) as Partial<ReminderSettings>) }
  } catch {
    return DEFAULT_REMINDER
  }
}

export function saveReminder(settings: ReminderSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // 保存できない環境では設定が残らないだけ
  }
}

// ---------- 環境の判定 ----------

export interface NotificationSupport {
  /** Notification API が使えるか */
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  /** アプリを閉じていても時刻指定で通知できるか (TimestampTrigger) */
  canScheduleInBackground: boolean
  /** ホーム画面から起動した状態か (iOS では通知にこれが必要) */
  standalone: boolean
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
  return {
    supported,
    permission: supported ? Notification.permission : 'unsupported',
    canScheduleInBackground,
    standalone,
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  return Notification.requestPermission()
}

// ---------- 次回の通知時刻 ----------

function parseTime(time: string): [number, number] {
  const [h, m] = time.split(':').map((v) => Number(v))
  return [Number.isFinite(h) ? h : 19, Number.isFinite(m) ? m : 0]
}

/** 設定に合う直近の日時。曜日が1つも選ばれていなければ null */
export function nextOccurrence(settings: ReminderSettings, from = new Date()): Date | null {
  if (settings.days.length === 0) return null
  const [hh, mm] = parseTime(settings.time)
  for (let i = 0; i < 8; i++) {
    const candidate = new Date(from)
    candidate.setDate(candidate.getDate() + i)
    candidate.setHours(hh, mm, 0, 0)
    if (candidate <= from) continue
    if (settings.days.includes(candidate.getDay())) return candidate
  }
  return null
}

/** 今後 count 回ぶんの通知時刻 */
export function upcomingOccurrences(
  settings: ReminderSettings,
  count: number,
  from = new Date(),
): Date[] {
  const out: Date[] = []
  let cursor = from
  for (let i = 0; i < count; i++) {
    const next = nextOccurrence(settings, cursor)
    if (!next) break
    out.push(next)
    cursor = next
  }
  return out
}

// ---------- 通知を出す ----------

const NOTIFICATION_TAG = 'kintore-reminder'

function notificationBody(): string {
  return '今日のメニューを見て、1セットだけでも始めてみましょう。'
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

/** 今すぐ通知を出す */
export async function showReminderNow(body = notificationBody()): Promise<boolean> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false
  const options: NotificationOptions = {
    body,
    icon: './app-icon.svg',
    badge: './app-icon.svg',
    tag: NOTIFICATION_TAG,
  }
  const reg = await registration()
  if (reg) {
    await reg.showNotification('筋トレの時間です', options)
    return true
  }
  try {
    new Notification('筋トレの時間です', options)
    return true
  } catch {
    return false
  }
}

/**
 * 対応ブラウザなら、アプリを閉じていても時刻に通知が出るよう予約する。
 * 予約できた件数を返す (0 なら非対応)。
 */
export async function scheduleBackgroundNotifications(
  settings: ReminderSettings,
  count = 8,
): Promise<number> {
  const support = notificationSupport()
  if (!support.canScheduleInBackground || support.permission !== 'granted') return 0
  const reg = await registration()
  if (!reg) return 0

  // 予約済みのぶんを消してから入れ直す
  const existing = await reg.getNotifications({ tag: NOTIFICATION_TAG, includeTriggered: false })
  for (const n of existing) n.close()

  const times = upcomingOccurrences(settings, count)
  let scheduled = 0
  for (const at of times) {
    try {
      await reg.showNotification('筋トレの時間です', {
        body: notificationBody(),
        icon: './app-icon.svg',
        tag: `${NOTIFICATION_TAG}-${at.getTime()}`,
        showTrigger: new window.TimestampTrigger!(at.getTime()),
      } as NotificationOptions)
      scheduled++
    } catch {
      break
    }
  }
  return scheduled
}

/**
 * アプリを開いている間だけ動くタイマー。
 * 予定時刻になったら通知を出す。戻り値を呼ぶと解除される。
 */
export function scheduleWhileOpen(
  settings: ReminderSettings,
  onFire: () => void,
): () => void {
  if (!settings.enabled) return () => {}
  let timer: number | undefined

  const arm = () => {
    const next = nextOccurrence(settings)
    if (!next) return
    // setTimeout の上限に近い値を避けるため、遠い予定は一度起きてから貼り直す
    const delay = Math.min(next.getTime() - Date.now(), 6 * 60 * 60 * 1000)
    timer = window.setTimeout(() => {
      if (Date.now() >= next.getTime() - 1000) onFire()
      arm()
    }, Math.max(1000, delay))
  }
  arm()

  return () => {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

/**
 * 起動時に「今日の予定時刻を過ぎているのにまだ記録がない」かを判定する。
 * バックグラウンド通知が出せない環境での取りこぼしを拾う。
 */
export function isMissedToday(
  settings: ReminderSettings,
  loggedToday: boolean,
  now = new Date(),
): boolean {
  if (!settings.enabled) return false
  if (!settings.days.includes(now.getDay())) return false
  if (settings.skipIfLogged && loggedToday) return false
  const [hh, mm] = parseTime(settings.time)
  const due = new Date(now)
  due.setHours(hh, mm, 0, 0)
  return now >= due
}

// ---------- カレンダー登録 (.ics) ----------

const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function icsStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(
    d.getMinutes(),
  )}00`
}

/**
 * 端末のカレンダーに入れる繰り返し予定を作る。
 * 通知APIの制約を受けないので、これが最も確実に鳴る。
 */
export function buildReminderIcs(settings: ReminderSettings, durationMinutes = 45): string {
  const start = nextOccurrence(settings) ?? new Date()
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
  const byday = settings.days.map((d) => ICS_DAYS[d]).join(',')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//kintore-log//JP',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:kintore-${start.getTime()}@local`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${byday}`,
    'SUMMARY:筋トレ',
    'DESCRIPTION:筋トレログを開いて今日のメニューを確認する',
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    'DESCRIPTION:筋トレの時間です',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.join('\r\n')
}
