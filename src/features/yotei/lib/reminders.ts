/**
 * 予定の通知。
 *
 * ブラウザだけで完結するアプリなので、通知の確実さには限界がある。
 * 効く順に3段構えにしてある。
 *   1. 端末カレンダーへの登録 (.ics) — アラーム付きで入れられるので最も確実
 *   2. 通知トリガー (TimestampTrigger) — 対応ブラウザならアプリを閉じていても鳴る
 *   3. アプリを開いている間のタイマー — どの環境でも動く保険
 *
 * iPhone は「ホーム画面に追加」して起動した状態でないと通知そのものが使えない。
 */

export interface NotificationSupport {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  /** アプリを閉じていても時刻指定で通知できるか */
  canScheduleInBackground: boolean
  /** ホーム画面から起動した状態か */
  standalone: boolean
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

export interface PendingReminder {
  key: string
  at: Date
  title: string
  body: string
}

const TAG_PREFIX = 'yoteicho'

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
  const options: NotificationOptions = {
    body,
    icon: './app-icon.svg',
    badge: './app-icon.svg',
    tag: `${TAG_PREFIX}-now`,
  }
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

  const existing = await reg.getNotifications({ includeTriggered: false })
  for (const n of existing) if (n.tag?.startsWith(TAG_PREFIX)) n.close()

  let count = 0
  for (const r of reminders) {
    if (r.at.getTime() <= Date.now()) continue
    try {
      await reg.showNotification(r.title, {
        body: r.body,
        icon: './app-icon.svg',
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
