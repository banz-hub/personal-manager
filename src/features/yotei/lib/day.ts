/**
 * 1日ぶんの計画を組み立てる。
 * 画面はここが返した結果を並べるだけにして、計算はすべてこの中に閉じ込める。
 */

import type { AppData } from './storage'
import { findGaps, timelineOn, type Gap, type TimelineItem } from './schedule'
import { buildJourneys, type Journey } from './travel'
import { findPlans, sameStation, type RoutePlan } from './routes'
import { lastTrainFor, type LastTrainResult } from './lastTrain'
import { lastRunBetween, lastRunChainHome, type LastRunHome } from './timetable'
import { newId } from './id'
import { chooseRuns, hasStopFor, type RunChoice } from './timetable'
import type { Expense, ExpenseCategory, EventCategory } from '../types'
import { toMinutes } from './date'

/** 登録区間が無い移動を、とりあえず何分とみなすか */
export const UNKNOWN_TRAVEL_MINUTES = 30

export interface PlannedItem {
  item: TimelineItem
  /** 出発時刻の候補。先頭が採用案 */
  journeys: Journey[]
  /** 出発地の駅 */
  fromStation: string
  /** 出発地の呼び名。自宅以外から続けて移動するときに使う */
  fromLabel: string
  fromHome: boolean
  /** 登録区間が無く、乗換案内に頼る必要がある */
  unknownRoute: boolean
}

/** その日の帰り道。最後の予定の場所から自宅までの終電を見る */
export interface Homeward {
  fromStation: string
  fromLabel: string
  /** その場所から駅までの徒歩分 */
  walkMinutes: number
  plan: RoutePlan | null
  lastTrain: LastTrainResult | null
  /** 時刻表から求めた最終便。あればこちらを優先する */
  lastRun: LastRunHome | null
}

export interface DayPlan {
  dateKey: string
  items: TimelineItem[]
  planned: PlannedItem[]
  gaps: Gap[]
  /** その日の移動でかかる運賃 (定期券適用後・片道の合計) */
  fareYen: number
  /** 外出して終わる日だけ入る */
  homeward?: Homeward
}

export function buildDay(data: AppData, dateKey: string): DayPlan {
  const items = timelineOn(dateKey, data)
  const home = data.profile.homeStation

  const planned: PlannedItem[] = []
  let previousStation = home
  let previousItem: TimelineItem | undefined
  let hasLeftHome = false

  for (const item of items) {
    if (!item.needsTravel || !item.station) {
      planned.push({
        item,
        journeys: [],
        fromStation: previousStation,
        fromLabel: previousItem?.placeName ?? '自宅',
        fromHome: !hasLeftHome,
        unknownRoute: false,
      })
      previousItem = item
      continue
    }
    if (sameStation(previousStation, item.station)) {
      // すでに同じ駅にいるので移動は不要
      planned.push({
        item,
        journeys: [],
        fromStation: previousStation,
        fromLabel: previousItem?.placeName ?? '自宅',
        fromHome: false,
        unknownRoute: false,
      })
      previousStation = item.station
      previousItem = item
      continue
    }
    const fromHome = !hasLeftHome
    const fromLabel = previousItem?.placeName ?? '自宅'
    const journeys = buildJourneys({
      profile: data.profile,
      legs: data.legs,
      passes: data.passes,
      dateKey,
      fromStation: previousStation,
      fromHome,
      // 直前の予定の場所から駅まで歩く時間も出発時刻に含める
      originWalkMinutes: previousItem?.walkMinutes ?? 0,
      originLabel: fromLabel,
      toStation: item.station,
      walkMinutes: item.walkMinutes,
      arriveBy: item.start,
    })
    planned.push({
      item,
      journeys,
      fromStation: previousStation,
      fromLabel,
      fromHome,
      unknownRoute: journeys.every((j) => j.plan === null),
    })
    previousStation = item.station
    previousItem = item
    hasLeftHome = true
  }

  const gaps = findGaps(items, {
    minMinutes: 20,
    travelMinutes: (before, after) => estimateTravel(data, before, after),
  })

  const fareYen = planned.reduce(
    (sum, p) => sum + (p.journeys[0]?.fare?.chargedYen ?? 0),
    0,
  )

  return { dateKey, items, planned, gaps, fareYen, homeward: buildHomeward(data, items, dateKey) }
}

/**
 * 最後の予定が自宅以外なら、そこから家に帰る経路と終電を出す。
 * 終電が未登録なら lastTrain は null になり、画面側は登録を促す。
 */
function buildHomeward(
  data: AppData,
  items: TimelineItem[],
  dateKeyForHome: string,
): Homeward | undefined {
  const home = data.profile.homeStation
  const last = [...items].reverse().find((i) => i.station && !sameStation(i.station, home))
  if (!last?.station || !home) return undefined
  const plan = findPlans(last.station, home, data.legs)[0] ?? null
  return {
    fromStation: last.station,
    fromLabel: last.placeName ?? last.station,
    walkMinutes: last.walkMinutes,
    plan,
    lastTrain: plan ? lastTrainFor(plan, last.walkMinutes) : null,
    // 時刻表があるなら、手入力の終電より実際の便を優先する。
    // 直通が無くても、途中で乗り継げるならそこまで探す。
    lastRun:
      lastRunBetween(data.runs, dateKeyForHome, last.station, home) ??
      (plan && plan.stations.length === 3
        ? lastRunChainHome(data.runs, dateKeyForHome, last.station, plan.stations[1], home, 5)
        : null),
  }
}

/** 2つの予定の間の移動にかかる時間の見積もり */
export function estimateTravel(
  data: AppData,
  before?: TimelineItem,
  after?: TimelineItem,
): number {
  const home = data.profile.homeStation
  const toStationMinutes = data.profile.homeToStationMinutes
  const from = before?.station ?? home
  const to = after?.station ?? home
  const walkOut = before?.station ? before.walkMinutes : toStationMinutes
  const walkIn = after?.station ? after.walkMinutes : toStationMinutes

  if (!from || !to || sameStation(from, to)) {
    // 同じ場所に留まるなら移動時間はいらない
    if (!before || !after) return 0
    return 0
  }
  const plans = findPlans(from, to, data.legs)
  const ride = plans[0]?.minutes ?? UNKNOWN_TRAVEL_MINUTES
  // 出発時刻の逆算と数字を揃えるため、到着の余裕も差し引いておく
  return ride + walkOut + walkIn + Math.max(0, data.profile.bufferMinutes)
}

/** 予定の種類から交通費の分類を決める */
export function expenseCategoryFor(category?: EventCategory): ExpenseCategory {
  switch (category) {
    case 'baito':
      return 'baito'
    case 'jobhunt':
      return 'jobhunt'
    case 'trip':
      return 'trip'
    default:
      return 'other'
  }
}

export interface ExpenseDraft {
  amountYen: number
  label: string
  category: ExpenseCategory
  roundTrip: boolean
}

/** その移動から交通費の下書きを作る */
export function draftExpense(planned: PlannedItem, roundTrip = true): ExpenseDraft | null {
  const journey = planned.journeys[0]
  if (!journey?.fare) return null
  const one = journey.fare.chargedYen
  if (one <= 0) return null
  return {
    amountYen: roundTrip ? one * 2 : one,
    label: `${journey.fromStation} ↔ ${journey.toStation}`,
    category: expenseCategoryFor(planned.item.category),
    roundTrip,
  }
}

/** 交通費レコードを作る */
export function buildExpense(params: {
  dateKey: string
  amountYen: number
  label: string
  category: ExpenseCategory
  tripId?: string
  reimbursed?: boolean
  auto?: boolean
}): Expense {
  return {
    id: newId('ex'),
    date: params.dateKey,
    amountYen: params.amountYen,
    category: params.category,
    kind: 'transport',
    label: params.label,
    means: '電車',
    tripId: params.tripId,
    reimbursed: params.reimbursed ?? false,
    auto: params.auto ?? true,
  }
}

/** 通知を出すべき時刻の一覧 (出発時刻をもとにする) */
export function remindersForDay(plan: DayPlan, dateKey: string) {
  const out: Array<{ key: string; at: Date; title: string; body: string }> = []
  for (const p of plan.planned) {
    const minutesBefore = p.item.event?.remindMinutesBefore
    if (minutesBefore == null) continue
    const journey = p.journeys[0]
    // 移動がある予定は「家を出る時刻」、無ければ予定開始を基準にする
    const baseTime = journey ? journey.leaveHomeAt : p.item.start
    const base = toMinutes(baseTime) - minutesBefore
    const [y, m, d] = dateKey.split('-').map(Number)
    const at = new Date(y, m - 1, d, 0, base, 0, 0)
    out.push({
      key: `${p.item.id}`,
      at,
      title: p.item.title,
      body: journey
        ? `${journey.leaveHomeAt} に出発 / ${p.item.start} 開始`
        : `${p.item.start} 開始`,
    })
  }
  return out
}

/**
 * その移動に使える列車を、時刻表から選ぶ。
 *
 * 経路の途中どの駅で降りてもよいものとして、目的地に間に合う便を探す。
 * 降りたあとの区間（山手線など時刻表を持たない部分）は所要時間で足す。
 */
export function trainChoicesFor(
  data: AppData,
  journey: Journey,
  arriveBy: string,
  dateKey: string,
): RunChoice[] {
  const plan = journey.plan
  if (!plan || data.runs.length === 0) return []

  const buffer = Math.max(0, data.profile.bufferMinutes)
  const alightOptions: Array<{ station: string; extraMinutes: number }> = []

  // stations[i] で降りたとき、目的地までにあと何分かかるか
  for (let i = 1; i < plan.stations.length; i++) {
    let remaining = 0
    for (let j = i; j < plan.legs.length; j++) remaining += plan.legs[j].minutes
    // 区間をまたぐ乗り継ぎのぶん
    remaining += Math.max(0, plan.legs.length - i) * 5
    alightOptions.push({
      station: plan.stations[i],
      extraMinutes: remaining + journey.walkMinutes + buffer,
    })
  }

  // 乗り換えが1回で、乗り継ぎ駅と目的地の両方に時刻表があるなら、実際の便でつなぐ
  const chain =
    plan.legs.length === 2 &&
    hasStopFor(data.runs, plan.stations[1], dateKey) &&
    hasStopFor(data.runs, plan.stations[2], dateKey)
      ? {
          at: plan.stations[1],
          to: plan.stations[2],
          transferMinutes: 5,
          tailMinutes: journey.walkMinutes + buffer,
        }
      : undefined

  return chooseRuns({
    runs: data.runs,
    dateKey,
    from: journey.fromStation,
    alightOptions,
    arriveBy,
    chain,
    // 発車時刻しか登録されていない便のために、全体の所要時間も渡しておく
    fallbackMinutes: plan.minutes + journey.walkMinutes + buffer,
    limit: 3,
  })
}
