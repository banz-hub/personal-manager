/**
 * 予定の時刻から「何時に家を出ればいいか」を逆算する。
 *
 *   準備 → 家から最寄り駅 → 電車 → 駅から現地まで徒歩 → 余裕をみて到着
 *
 * 電車の部分は登録済み区間 (routes.ts) から作る。登録が無ければ
 * plan が null になり、画面側は乗換案内へのリンクに切り替える。
 */

import type { Pass, Profile, RouteLeg } from '../types'
import { fromMinutes, toMinutes } from './date'
import { activePasses, fareWithPasses, findPlans, sameStation } from './routes'
import type { FareBreakdown, RoutePlan } from './routes'

export interface JourneyStep {
  label: string
  minutes: number
  /** この段階が終わった時刻 */
  at: string
}

export interface Journey {
  /** 使う経路。登録区間で作れなければ null */
  plan: RoutePlan | null
  fromStation: string
  toStation: string
  walkMinutes: number
  steps: JourneyStep[]
  /** 家を出てから到着までの合計 (余裕を含む) */
  totalMinutes: number
  /** 家を出る時刻 */
  leaveHomeAt: string
  /** 準備を始める時刻 */
  prepareFrom: string
  /** 最寄り駅から電車に乗る時刻の目安 */
  boardAt: string
  /** 目的地に着く時刻 (予定開始 - 余裕) */
  arriveAt: string
  /** 前日のうちに出ないと間に合わない */
  previousDay: boolean
  /** 登録区間が無く、電車の時間が計算できていない。時刻は当てにならない */
  routeUnknown: boolean
  fare: FareBreakdown | null
  /** 片道の運賃 (定期券適用前) */
  rawFareYen: number
}

export interface JourneyInput {
  profile: Profile
  legs: RouteLeg[]
  passes: Pass[]
  dateKey: string
  /** 出発地の駅。省略すると自宅最寄り駅 */
  fromStation?: string
  /** 出発地が自宅かどうか。自宅なら家→駅の時間を足す */
  fromHome?: boolean
  /** 自宅以外から出るとき、その場所から出発駅までの徒歩分 */
  originWalkMinutes?: number
  /** 出発地の呼び名。「大学」など */
  originLabel?: string
  toStation: string
  /** 目的地の駅からの徒歩分 */
  walkMinutes: number
  /** 何時までに着きたいか 'HH:MM' */
  arriveBy: string
}

/** 経路候補それぞれについて逆算する。候補が無ければ「電車部分が不明」の1本を返す */
export function buildJourneys(input: JourneyInput): Journey[] {
  const from = input.fromStation?.trim() || input.profile.homeStation
  const fromHome = input.fromHome ?? true
  const plans = from && input.toStation ? findPlans(from, input.toStation, input.legs) : []
  if (plans.length === 0) return [buildJourney(input, null, from, fromHome)]
  return plans.map((plan) => buildJourney(input, plan, from, fromHome))
}

function buildJourney(
  input: JourneyInput,
  plan: RoutePlan | null,
  from: string,
  fromHome: boolean,
): Journey {
  const { profile } = input
  const buffer = Math.max(0, profile.bufferMinutes)
  const walk = Math.max(0, input.walkMinutes)
  // 駅にたどり着くまでの時間。自宅なら設定値、それ以外なら直前の場所からの徒歩
  const toStation = fromHome
    ? Math.max(0, profile.homeToStationMinutes)
    : Math.max(0, input.originWalkMinutes ?? 0)
  const ride = plan?.minutes ?? 0

  const arriveTarget = toMinutes(input.arriveBy) - buffer
  const stationArrive = arriveTarget - walk
  const board = stationArrive - ride
  const leaveHome = board - toStation
  const prepare = leaveHome - Math.max(0, profile.prepMinutes)

  const steps: JourneyStep[] = []
  if (toStation > 0) {
    steps.push({
      label: fromHome
        ? `${profile.homeToStationMethod || '移動'}で${from || '最寄り駅'}へ`
        : `${input.originLabel ?? 'いまいる場所'}から${from}へ`,
      minutes: toStation,
      at: fromMinutes(board),
    })
  }
  if (plan) {
    steps.push({
      label: `電車 ${plan.stations.join(' → ')}`,
      minutes: ride,
      at: fromMinutes(stationArrive),
    })
  } else {
    steps.push({ label: '電車 (区間が未登録)', minutes: 0, at: fromMinutes(stationArrive) })
  }
  if (walk > 0) {
    steps.push({ label: `${input.toStation}から徒歩`, minutes: walk, at: fromMinutes(arriveTarget) })
  }
  if (buffer > 0) {
    steps.push({ label: '余裕', minutes: buffer, at: input.arriveBy })
  }

  const fare = plan ? fareWithPasses(plan, activePasses(input.passes, input.dateKey)) : null

  return {
    plan,
    fromStation: from,
    toStation: input.toStation,
    walkMinutes: walk,
    steps,
    totalMinutes: toStation + ride + walk + buffer,
    leaveHomeAt: fromMinutes(leaveHome),
    prepareFrom: fromMinutes(prepare),
    boardAt: fromMinutes(board),
    arriveAt: fromMinutes(arriveTarget),
    previousDay: leaveHome < 0,
    routeUnknown: plan === null,
    fare,
    rawFareYen: plan?.fareYen ?? 0,
  }
}

/**
 * 予定に対する移動先を決める。
 * 予定に場所が紐づいていればその駅、そうでなければ予定に直接書かれた駅を使う。
 */
export function resolveDestination(
  station: string | undefined,
  walkMinutes: number | undefined,
): { station: string; walkMinutes: number } | null {
  const s = station?.trim()
  if (!s) return null
  return { station: s, walkMinutes: walkMinutes ?? 0 }
}

/** 出発地と目的地が同じなら移動は不要 */
export function needsMove(from: string, to: string): boolean {
  return !sameStation(from, to)
}
