/**
 * 睡眠の記録と、その評価・助言。
 *
 * 記録は「何時から何時まで寝た」を手で入れる (`recordSleep`)。
 * はじめは寝る・起きたのボタンで押した時刻を残す形だったが、
 * 押し忘れた晩が空欄になるので、あとから入れられる形に変えた。
 * ボタンの関数 (startSleep / wakeUp / sleepAgain) は、同じ区間の形を作るので
 * テストで記録を組み立てるのに今も使っている。
 *
 * 記録は**入れた時刻をそのまま**残す。丸めたり補正したりしない。
 * ここで加工すると、あとから「本当は何時だったか」が分からなくなる。
 * 評価や助言は、残した生の記録から毎回計算し直す。
 */

import type { Settings, SleepLog, SleepRating } from '../types'
import { addDays, dateKey, formatDuration, fromMinutes, toMinutes } from './date'
import { newId } from './id'

/** 二度寝と見なす上限 (分)。これより長く起きていたら、その晩はもう終わり */
export const SNOOZE_GAP_MAX = 180

/** 目標よりこれ以上短い日を「足りていない」と数える (分) */
export const SHORT_SLEEP_MIN = 60

/** これより短い記録は、押し間違いとみなして残さない (分) */
export const MIN_RECORDED_MIN = 5

function ms(iso: string): number {
  return new Date(iso).getTime()
}

function minutesBetween(from: string, to: string): number {
  return Math.max(0, Math.round((ms(to) - ms(from)) / 60000))
}

/** いま寝ている最中か */
export function isAsleep(log?: SleepLog): boolean {
  return log != null && log.spans.some((s) => !s.to)
}

/**
 * いちばん新しい記録。
 * 起きた日で並べているので、日付順の最後が最新になる。
 */
export function latestLog(logs: SleepLog[]): SleepLog | undefined {
  if (logs.length === 0) return undefined
  return [...logs].sort((a, b) => {
    const at = a.spans[0]?.from ?? ''
    const bt = b.spans[0]?.from ?? ''
    return at < bt ? -1 : at > bt ? 1 : 0
  })[logs.length - 1]
}

// ---------- ボタンを押したとき ----------

/**
 * 「寝る」。
 * すでに寝ていることになっていれば何もしない (二重に押しても壊れない)。
 */
export function startSleep(logs: SleepLog[], now: Date): SleepLog[] {
  const last = latestLog(logs)
  if (isAsleep(last)) return logs

  // 寝るのは夜なので、起きるのはたいてい翌日。あとで起きたときに直す
  const log: SleepLog = {
    id: newId('slp'),
    date: dateKey(new Date(now.getTime() + 6 * 60 * 60 * 1000)),
    spans: [{ from: now.toISOString() }],
  }
  return [...logs, log]
}

/**
 * 「起きた」。開いている区間を閉じる。
 * 寝ていないのに押されたら何もしない。
 */
export function wakeUp(logs: SleepLog[], now: Date): SleepLog[] {
  const last = latestLog(logs)
  if (!last || !isAsleep(last)) return logs

  const spans = last.spans.map((s) => (s.to ? s : { ...s, to: now.toISOString() }))
  // 起きた日で数え直す。日をまたいだかどうかがここで確定する
  const updated: SleepLog = { ...last, spans, date: dateKey(now) }

  // 押し間違い (寝る → すぐ起きた) は残さない。あとで「その日の代表」を選ぶときに邪魔になる
  if (totalMinutes(updated) < MIN_RECORDED_MIN) return logs.filter((l) => l.id !== last.id)

  return logs.map((l) => (l.id === last.id ? updated : l))
}

/**
 * 「二度寝」。同じ晩の続きとして区間を足す。
 *
 * 起きてから長く経っていたら、続きではなく新しい晩として始める。
 * 昼寝や、夜になってから押した場合に前の晩とつながってしまうのを防ぐため。
 */
export function sleepAgain(logs: SleepLog[], now: Date): SleepLog[] {
  const last = latestLog(logs)
  if (!last || isAsleep(last)) return logs

  const wokeAt = last.spans[last.spans.length - 1]?.to
  if (!wokeAt || minutesBetween(wokeAt, now.toISOString()) > SNOOZE_GAP_MAX) {
    return startSleep(logs, now)
  }

  const updated: SleepLog = { ...last, spans: [...last.spans, { from: now.toISOString() }] }
  return logs.map((l) => (l.id === last.id ? updated : l))
}

// ---------- 手で入れたとき ----------

/** これより長い記録は入力の間違いとみなす (分)。16 時間 */
export const MAX_RECORDED_MIN = 16 * 60

/**
 * 「何時から何時まで寝た」を 1 晩の記録にする。
 *
 * `date` は**起きた日。**寝た時刻が起きた時刻より遅い（同じも含む）ときは、
 * 前の日の夜に寝たとみなす。23:30 → 7:00 は前の晩、1:00 → 8:00 と 13:00 → 14:00 は当日。
 *
 * 同じ日の記録は置き換える。手で入れる形では 1 日 1 件で足りるし、
 * 直すたびに増えると、その日の代表がどれか分からなくなる。
 *
 * ありえない長さ（5 分未満・16 時間超）は null を返して保存させない。
 */
export function recordSleep(
  logs: SleepLog[],
  date: string,
  bed: string,
  wake: string,
): SleepLog[] | null {
  const bedMin = toMinutes(bed)
  const wakeMin = toMinutes(wake)
  const overnight = bedMin >= wakeMin
  const minutes = overnight ? 24 * 60 - bedMin + wakeMin : wakeMin - bedMin
  if (minutes < MIN_RECORDED_MIN || minutes > MAX_RECORDED_MIN) return null

  const iso = (day: string, min: number) => {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(y, m - 1, d, Math.floor(min / 60), min % 60).toISOString()
  }
  const log: SleepLog = {
    id: newId('slp'),
    date,
    spans: [{ from: iso(overnight ? addDays(date, -1) : date, bedMin), to: iso(date, wakeMin) }],
  }
  return [...logs.filter((l) => l.date !== date), log]
}

// ---------- 数える ----------

export interface SleepSummary {
  log?: SleepLog
  /** 実際に寝ていた合計 (分)。途中で起きていた時間は入らない */
  minutes: number
  /** 最初に寝た時刻 'HH:MM' */
  bedAt?: string
  /** 最後に起きた時刻 'HH:MM' */
  wakeAt?: string
  /** 二度寝した回数 */
  snoozeCount: number
  /** 二度寝で寝ていた合計 (分) */
  snoozeMinutes: number
  /** 目標に対する過不足 (分)。マイナスなら足りていない */
  diffMin: number
  rating: SleepRating
  /** まだ寝ている最中か */
  ongoing: boolean
}

/**
 * その日を代表する記録を選ぶ。
 *
 * 同じ日に記録が 2 つ以上できることがある (昼寝したあとに夜寝る、押し間違いなど)。
 * 先頭を取ると、うっかり作った短い記録のほうが選ばれてしまうので、
 * **いま寝ている最中のもの、無ければいちばん長いもの**を返す。
 */
export function mainLogOf(logs: SleepLog[], date: string): SleepLog | undefined {
  const sameDay = logs.filter((l) => l.date === date)
  if (sameDay.length <= 1) return sameDay[0]

  const ongoing = sameDay.find((l) => isAsleep(l))
  if (ongoing) return ongoing

  return sameDay.reduce((best, l) => (totalMinutes(l) > totalMinutes(best) ? l : best))
}

/** 寝ていた合計 (分)。閉じている区間だけ数える */
function totalMinutes(log: SleepLog): number {
  return log.spans
    .filter((sp) => sp.to)
    .reduce((sum, sp) => sum + minutesBetween(sp.from, sp.to as string), 0)
}

/** その日の睡眠をまとめる */
export function summarize(logs: SleepLog[], date: string, settings: Settings): SleepSummary {
  const log = mainLogOf(logs, date)
  if (!log || log.spans.length === 0) {
    return {
      minutes: 0,
      snoozeCount: 0,
      snoozeMinutes: 0,
      diffMin: -settings.targetSleepMin,
      rating: 'short',
      ongoing: false,
    }
  }

  const closed = log.spans.filter((s) => s.to)
  const minutes = closed.reduce((sum, s) => sum + minutesBetween(s.from, s.to as string), 0)
  const snoozeSpans = closed.slice(1)

  const first = log.spans[0]
  const lastClosed = closed[closed.length - 1]

  return {
    log,
    minutes,
    bedAt: hhmm(first.from),
    wakeAt: lastClosed ? hhmm(lastClosed.to as string) : undefined,
    snoozeCount: snoozeSpans.length,
    snoozeMinutes: snoozeSpans.reduce(
      (sum, s) => sum + minutesBetween(s.from, s.to as string),
      0,
    ),
    diffMin: minutes - settings.targetSleepMin,
    rating: rate(minutes, snoozeSpans.length, settings),
    ongoing: isAsleep(log),
  }
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  return fromMinutes(d.getHours() * 60 + d.getMinutes())
}

/**
 * 評価。
 *
 * 長さと細切れ具合の 2 つだけで決める。寝つきや深さは測れないので入れない。
 * 測っていないものを評価に混ぜると、数字の意味が分からなくなる。
 */
export function rate(minutes: number, snoozeCount: number, settings: Settings): SleepRating {
  const target = settings.targetSleepMin
  if (minutes < target - 90) return 'short'
  // 長さが足りていても、3 回以上起きていれば休めていない
  if (snoozeCount >= 3) return 'broken'
  if (minutes < target - SHORT_SLEEP_MIN) return 'short'
  if (minutes >= target && snoozeCount === 0) return 'good'
  return 'fair'
}

// ---------- 直近の傾向 ----------

export interface SleepTrend {
  /** 数えられた日数 */
  days: number
  /** 1 日あたりの平均 (分) */
  averageMin: number
  /** 就寝時刻のばらつき (分)。いちばん早い日といちばん遅い日の差 */
  bedtimeSpreadMin: number
  /** 二度寝した日数 */
  snoozeDays: number
  /** 目標に届かなかった日数 */
  shortDays: number
}

/** 直近 `days` 日の傾向。記録のある日だけで数える */
export function trend(logs: SleepLog[], today: string, settings: Settings, days = 7): SleepTrend {
  const from = addDays(today, -(days - 1))
  const target = logs.filter((l) => l.date >= from && l.date <= today)

  // 同じ日に記録が 2 つあっても 1 日として数える
  const dates = [...new Set(target.map((l) => l.date))]
  const summaries = dates.map((d) => summarize(logs, d, settings))
  const counted = summaries.filter((s) => !s.ongoing && s.minutes > 0)
  if (counted.length === 0) {
    return { days: 0, averageMin: 0, bedtimeSpreadMin: 0, snoozeDays: 0, shortDays: 0 }
  }

  const beds = counted
    .map((s) => s.bedAt)
    .filter((b): b is string => b != null)
    // 0〜4 時に寝た日は「前の日の夜が延びた」として扱う。
    // そのまま分に直すと 0:30 が 30 分になり、23:30 との差が 23 時間になってしまう
    .map((b) => (toMinutes(b) < 4 * 60 ? toMinutes(b) + 1440 : toMinutes(b)))

  return {
    days: counted.length,
    averageMin: Math.round(counted.reduce((a, s) => a + s.minutes, 0) / counted.length),
    bedtimeSpreadMin: beds.length > 1 ? Math.max(...beds) - Math.min(...beds) : 0,
    snoozeDays: counted.filter((s) => s.snoozeCount > 0).length,
    shortDays: counted.filter((s) => s.diffMin < -SHORT_SLEEP_MIN).length,
  }
}

// ---------- 助言 ----------

/**
 * 見たものだけを言う。**一般論は言わない。**
 * 「早く寝ましょう」は誰にでも言えるので、記録から言えることだけ返す。
 */
export function advise(summary: SleepSummary, t: SleepTrend, settings: Settings): string[] {
  const out: string[] = []

  if (summary.minutes > 0 && summary.diffMin < -SHORT_SLEEP_MIN) {
    out.push(
      `今日は目標より${formatDuration(-summary.diffMin)}短いです。重い作業を午前に寄せて、夜は軽いものにしてください。`,
    )
  }
  if (summary.snoozeCount >= 2) {
    out.push(
      `二度寝が${summary.snoozeCount}回、合わせて${formatDuration(summary.snoozeMinutes)}。` +
        `一度で起きられていないので、就寝を早めるほうが効きます。`,
    )
  }

  if (t.days >= 3) {
    if (t.averageMin < settings.targetSleepMin - SHORT_SLEEP_MIN) {
      out.push(
        `直近${t.days}日の平均は${formatDuration(t.averageMin)}で、目標に${formatDuration(settings.targetSleepMin - t.averageMin)}足りていません。`,
      )
    }
    if (t.bedtimeSpreadMin >= 120) {
      out.push(
        `寝る時刻が${formatDuration(t.bedtimeSpreadMin)}ぶれています。起きる時刻より寝る時刻をそろえるほうが楽です。`,
      )
    }
    if (t.snoozeDays >= Math.ceil(t.days * 0.6)) {
      out.push(`${t.days}日のうち${t.snoozeDays}日で二度寝しています。目標の起床時刻が早すぎるかもしれません。`)
    }
  }

  if (out.length === 0 && summary.minutes > 0) {
    // 評価と食い違うことを言わない。「まずまず」なのに「目標どおり」と出ると、
    // どちらを信じればよいのか分からなくなる
    out.push(
      summary.rating === 'good'
        ? '目標どおり眠れています。この形を崩さないでください。'
        : summary.snoozeCount > 0
          ? `長さは足りていますが、途中で${summary.snoozeCount}回起きています。寝る時刻を早めると一度で起きやすくなります。`
          : '大きくは崩れていません。このまま続けてください。',
    )
  }
  return out
}
