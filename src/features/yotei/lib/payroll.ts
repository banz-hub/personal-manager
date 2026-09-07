/**
 * バイトの給与計算。2つの給与体系に対応する。
 *
 * 時給制:
 *   勤務時間 = 終了 - 開始 - 休憩。深夜帯に重なった分だけ割増をかける。
 *   休憩はまず通常帯から差し引く (深夜だけ働いた日は深夜帯から引く)。
 *
 * コマ給制 (塾など):
 *   1日の給与 = コマ数 × コマ給 + 日当 + 事務時間 × 事務時給 ÷ 60
 *   事務時間 = 在校時間 - 授業時間 - 日当がカバーする時間 (マイナスなら0)
 *   日当は「出勤1日につき」なので、同じ日に複数シフトがあっても1回だけ付ける。
 *
 * 締め日は月ごとに区切り、月末締めは 31 を指定する。
 */

import type { EventItem, Job, JobRate, PayType } from '../types'
import { daysInMonth, overlapMinutes, toMinutes } from './date'

/** コマ給制の値が未設定のときに使う既定値 */
const PER_CLASS_DEFAULTS = {
  perClassYen: 1850,
  classMinutes: 95,
  dailyAllowanceYen: 448,
  allowanceMinutes: 25,
  officeHourlyYen: 1080,
}

export function payTypeOf(job: Job): PayType {
  return job.payType ?? 'hourly'
}

/** その日に適用される単価 */
export interface ResolvedRate {
  hourlyYen: number
  nightRate: number
  perClassYen: number
  classMinutes: number
  dailyAllowanceYen: number
  allowanceMinutes: number
  officeHourlyYen: number
  /** 元になった昇給履歴。バイト先の初期値のままなら undefined */
  from?: JobRate
}

/**
 * その日付に効いている単価を求める。
 *
 * 昇給のたびに履歴を足していくので、過去のシフトは当時の単価のまま計算される。
 * 履歴に書かれていない項目は、それより前の単価を引き継ぐ。
 */
export function resolveRate(job: Job, dateKey: string): ResolvedRate {
  const base: ResolvedRate = {
    hourlyYen: job.hourlyYen,
    nightRate: job.nightRate,
    perClassYen: job.perClassYen ?? PER_CLASS_DEFAULTS.perClassYen,
    classMinutes: job.classMinutes ?? PER_CLASS_DEFAULTS.classMinutes,
    dailyAllowanceYen: job.dailyAllowanceYen ?? PER_CLASS_DEFAULTS.dailyAllowanceYen,
    allowanceMinutes: job.allowanceMinutes ?? PER_CLASS_DEFAULTS.allowanceMinutes,
    officeHourlyYen: job.officeHourlyYen ?? PER_CLASS_DEFAULTS.officeHourlyYen,
  }

  // 適用日の古い順に、その日までに始まっているものを順に上書きしていく
  const applicable = [...(job.rates ?? [])]
    .filter((r) => r.effectiveFrom <= dateKey)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))

  for (const rate of applicable) {
    if (rate.hourlyYen != null) base.hourlyYen = rate.hourlyYen
    if (rate.nightRate != null) base.nightRate = rate.nightRate
    if (rate.perClassYen != null) base.perClassYen = rate.perClassYen
    if (rate.classMinutes != null) base.classMinutes = rate.classMinutes
    if (rate.dailyAllowanceYen != null) base.dailyAllowanceYen = rate.dailyAllowanceYen
    if (rate.allowanceMinutes != null) base.allowanceMinutes = rate.allowanceMinutes
    if (rate.officeHourlyYen != null) base.officeHourlyYen = rate.officeHourlyYen
    base.from = rate
  }
  return base
}

export interface ShiftPay {
  event: EventItem
  job: Job
  payType: PayType
  /** 休憩を除いた勤務時間。コマ給制では在校時間 */
  workedMinutes: number

  // --- 時給制 ---
  normalMinutes: number
  nightMinutes: number
  basePayYen: number
  /** 深夜割増の上乗せ分だけ */
  nightExtraYen: number

  // --- コマ給制 ---
  classCount: number
  /** 授業に充てた時間 */
  teachingMinutes: number
  classPayYen: number
  /** 日当。同じ日の2件目以降は0 */
  allowanceYen: number
  /** 授業でも日当でもカバーされない時間 */
  officeMinutes: number
  officePayYen: number

  transportYen: number
  totalYen: number
}

/** 深夜帯の区間を分の軸に並べる。日をまたぐ勤務とも重ねられるよう前後の日ぶんも用意する */
function nightRanges(job: Job): Array<[number, number]> {
  const from = toMinutes(job.nightStart)
  let to = toMinutes(job.nightEnd)
  if (to <= from) to += 1440
  return [-1440, 0, 1440].map((offset) => [from + offset, to + offset] as [number, number])
}

/** 拘束時間から休憩を引いた分数 */
function workedMinutesOf(event: EventItem): number {
  const start = toMinutes(event.start)
  let end = toMinutes(event.end)
  // 終了が開始より前なら日をまたいだ勤務
  if (end <= start) end += 1440
  const raw = Math.max(0, end - start)
  const rest = Math.min(raw, Math.max(0, event.breakMinutes ?? 0))
  return raw - rest
}

/**
 * 1回のシフトの給与。
 * withAllowance を false にすると日当を付けない (同じ日の2件目以降に使う)。
 */
export function shiftPay(event: EventItem, job: Job, withAllowance = true): ShiftPay {
  const transport = job.transportPaid ? job.transportPerDayYen : 0
  const workedMinutes = workedMinutesOf(event)
  // その日に効いていた単価で計算する（昇給前のシフトは当時の単価のまま）
  const rate = resolveRate(job, event.date)

  if (payTypeOf(job) === 'perClass') {
    const { perClassYen, classMinutes, dailyAllowanceYen, allowanceMinutes, officeHourlyYen } = rate

    // コマを選んでいればその数、選んでいなければ手入力のコマ数
    const selectedCount = event.classSlotIds?.length ?? 0
    const classCount = selectedCount > 0 ? selectedCount : Math.max(0, event.classCount ?? 0)
    const teachingMinutes = classCount * classMinutes
    // 在校時間のうち、授業でも日当でもカバーされない部分だけが事務給になる
    const officeMinutes = Math.max(0, workedMinutes - teachingMinutes - allowanceMinutes)

    const classPayYen = classCount * perClassYen
    const allowanceYen = withAllowance && workedMinutes > 0 ? dailyAllowanceYen : 0
    const officePayYen = Math.round((officeMinutes * officeHourlyYen) / 60)

    return {
      event,
      job,
      payType: 'perClass',
      workedMinutes,
      normalMinutes: 0,
      nightMinutes: 0,
      basePayYen: 0,
      nightExtraYen: 0,
      classCount,
      teachingMinutes,
      classPayYen,
      allowanceYen,
      officeMinutes,
      officePayYen,
      transportYen: transport,
      totalYen: classPayYen + allowanceYen + officePayYen + transport,
    }
  }

  // --- 時給制 ---
  const start = toMinutes(event.start)
  let end = toMinutes(event.end)
  if (end <= start) end += 1440
  const rawMinutes = Math.max(0, end - start)
  const breakMinutes = Math.min(rawMinutes, Math.max(0, event.breakMinutes ?? 0))

  let night = 0
  for (const [ns, ne] of nightRanges(job)) night += overlapMinutes(start, end, ns, ne)
  night = Math.min(night, rawMinutes)
  let normal = rawMinutes - night

  // 休憩は通常帯から先に引く
  let rest = breakMinutes
  const takeFromNormal = Math.min(normal, rest)
  normal -= takeFromNormal
  rest -= takeFromNormal
  night = Math.max(0, night - rest)

  const hourly = rate.hourlyYen
  const basePay = (workedMinutes / 60) * hourly
  const nightExtra = (night / 60) * hourly * Math.max(0, rate.nightRate - 1)

  return {
    event,
    job,
    payType: 'hourly',
    workedMinutes,
    normalMinutes: normal,
    nightMinutes: night,
    basePayYen: Math.round(basePay),
    nightExtraYen: Math.round(nightExtra),
    classCount: 0,
    teachingMinutes: 0,
    classPayYen: 0,
    allowanceYen: 0,
    officeMinutes: 0,
    officePayYen: 0,
    transportYen: transport,
    totalYen: Math.round(basePay + nightExtra) + transport,
  }
}

/**
 * 複数のシフトをまとめて計算する。
 * 日当は出勤1日につき1回なので、同じ日の2件目以降には付けない。
 */
export function shiftPays(events: EventItem[], job: Job): ShiftPay[] {
  const seenDates = new Set<string>()
  return [...events]
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    .map((event) => {
      const first = !seenDates.has(event.date)
      seenDates.add(event.date)
      return shiftPay(event, job, first)
    })
}

export interface PayPeriod {
  /** 締め期間の開始日 */
  from: string
  /** 締め日 */
  to: string
  /** 給料日 */
  payDate: string
  label: string
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** 締め日をその月の実在する日に丸める (2月に31日締めなら末日) */
function clampDay(year: number, month1: number, day: number): number {
  return Math.min(day, daysInMonth(year, month1))
}

/** year 年 month1 月の締め日で終わる給与期間 */
export function payPeriodEndingIn(job: Job, year: number, month1: number): PayPeriod {
  const endDay = clampDay(year, month1, job.closingDay)
  const to = `${year}-${p2(month1)}-${p2(endDay)}`

  const prev = new Date(year, month1 - 2, 1)
  const prevYear = prev.getFullYear()
  const prevMonth = prev.getMonth() + 1
  const prevEndDay = clampDay(prevYear, prevMonth, job.closingDay)
  const fromDate = new Date(prevYear, prevMonth - 1, prevEndDay)
  fromDate.setDate(fromDate.getDate() + 1)
  const from = `${fromDate.getFullYear()}-${p2(fromDate.getMonth() + 1)}-${p2(fromDate.getDate())}`

  const payMonth = new Date(year, month1 - 1 + job.payMonthOffset, 1)
  const payDay = clampDay(payMonth.getFullYear(), payMonth.getMonth() + 1, job.payDay)
  const payDate = `${payMonth.getFullYear()}-${p2(payMonth.getMonth() + 1)}-${p2(payDay)}`

  return { from, to, payDate, label: `${month1}月${endDay}日締め` }
}

export interface PaySummary {
  job: Job
  period: PayPeriod
  shifts: ShiftPay[]
  workedMinutes: number
  basePayYen: number
  nightExtraYen: number
  classCount: number
  classPayYen: number
  allowanceYen: number
  officeMinutes: number
  officePayYen: number
  transportYen: number
  totalYen: number
}

/** 締め期間ぶんの合計 */
export function summarizePay(job: Job, events: EventItem[], period: PayPeriod): PaySummary {
  const inPeriod = events.filter(
    (e) => e.jobId === job.id && e.date >= period.from && e.date <= period.to,
  )
  const shifts = shiftPays(inPeriod, job)
  const sum = (pick: (s: ShiftPay) => number) => shifts.reduce((acc, s) => acc + pick(s), 0)

  return {
    job,
    period,
    shifts,
    workedMinutes: sum((s) => s.workedMinutes),
    basePayYen: sum((s) => s.basePayYen),
    nightExtraYen: sum((s) => s.nightExtraYen),
    classCount: sum((s) => s.classCount),
    classPayYen: sum((s) => s.classPayYen),
    allowanceYen: sum((s) => s.allowanceYen),
    officeMinutes: sum((s) => s.officeMinutes),
    officePayYen: sum((s) => s.officePayYen),
    transportYen: sum((s) => s.transportYen),
    totalYen: sum((s) => s.totalYen),
  }
}

/** 年ぶんの給与 (扶養の範囲を見るときに使う) */
export function yearlyPay(jobs: Job[], events: EventItem[], year: number): number {
  let total = 0
  for (const job of jobs) {
    const mine = events.filter((e) => e.jobId === job.id && e.date.startsWith(String(year)))
    total += shiftPays(mine, job).reduce((s, x) => s + x.totalYen, 0)
  }
  return total
}

export const DEFAULT_JOB: Omit<Job, 'id' | 'name'> = {
  payType: 'hourly',
  hourlyYen: 1100,
  nightRate: 1.25,
  nightStart: '22:00',
  nightEnd: '05:00',
  ...PER_CLASS_DEFAULTS,
  transportPaid: false,
  transportPerDayYen: 0,
  closingDay: 31,
  payDay: 25,
  payMonthOffset: 1,
}
