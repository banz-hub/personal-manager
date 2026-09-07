/**
 * 終電から逆算して「いつまでその場所にいられるか」を出す。
 *
 * 時刻表は持っていないので、区間ごとに登録した終電の時刻だけを使う。
 * 乗り継ぎがあるときは、後ろの区間から順に「この時刻までに乗らないと間に合わない」を
 * さかのぼって、いちばん厳しい制約を採用する。
 */

import type { RouteLeg } from '../types'
import { fromMinutes, toMinutes } from './date'
import { sameStation, type RoutePlan } from './routes'

/** 乗り継ぎに見込む時間 (分)。routes.ts の見積もりと揃えてある */
const CONNECTION_MINUTES = 5

/** 深夜0時台の終電を、前日からの通し時刻として扱う (00:30 → 24:30) */
function lateNight(time: string): number {
  const m = toMinutes(time)
  return m < 240 ? m + 1440 : m
}

/** 24時をまたいだ時刻を「翌0:30」の形で表示する */
export function formatLateNight(minutes: number): string {
  const wrapped = fromMinutes(minutes)
  return minutes >= 1440 ? `翌${wrapped}` : wrapped
}

export interface LegLimit {
  leg: RouteLeg
  /** この区間に乗れる最終時刻 (分) */
  limitMinutes: number
  /** 区間そのものの終電 (分)。制約になっているかの判定に使う */
  lastTrainMinutes: number
  from: string
  to: string
}

export interface LastTrainResult {
  /** 最初の駅で電車に乗る最終時刻 (分) */
  boardByMinutes: number
  /** その場所を出る最終時刻 (分)。駅までの徒歩を引いてある */
  leaveByMinutes: number
  boardBy: string
  leaveBy: string
  legLimits: LegLimit[]
  /** いちばん厳しい制約になっている区間 */
  binding?: LegLimit
}

/** 経路の各区間が、進む向きから見てどちらの終電を使うか */
function lastTrainOf(leg: RouteLeg, from: string): string | undefined {
  // 経路上の出発駅が leg.from と同じなら from→to 方向
  return sameStation(leg.from, from) ? leg.lastTrainFrom : leg.lastTrainTo
}

/**
 * 経路の終電から、出発地を出る最終時刻を求める。
 * 終電が未登録の区間がひとつでもあれば null を返す。
 */
export function lastTrainFor(
  plan: RoutePlan,
  walkToStationMinutes = 0,
): LastTrainResult | null {
  if (plan.legs.length === 0) return null

  const limits: LegLimit[] = []
  /**
   * 「この区間の出発駅に、遅くともこの時刻までに着いていないといけない」を、
   * 後ろの区間からさかのぼって持ち回る。
   *
   * 引くのは **手前の区間の乗車時間**。ここでこの区間自身の乗車時間を引くと、
   * 手前が長い経路で出発を遅く見積もり、終電を逃す。
   */
  let arriveBy = Number.POSITIVE_INFINITY

  for (let i = plan.legs.length - 1; i >= 0; i--) {
    const leg = plan.legs[i]
    const from = plan.stations[i]
    const to = plan.stations[i + 1]
    const raw = lastTrainOf(leg, from)
    if (!raw) return null
    const lastTrainMinutes = lateNight(raw)
    // この区間に乗れるのは、終電か、次の区間に間に合う時刻か、早いほう
    const limitMinutes = Math.min(lastTrainMinutes, arriveBy - leg.minutes)
    limits.unshift({ leg, limitMinutes, lastTrainMinutes, from, to })
    // 乗り継ぎのぶん手前に着いておく
    arriveBy = limitMinutes - CONNECTION_MINUTES
  }

  const boardByMinutes = limits[0].limitMinutes
  const leaveByMinutes = boardByMinutes - Math.max(0, walkToStationMinutes)

  // 自分の終電がそのまま制約になっている区間を「効いている区間」とする
  const binding = limits.find((l) => l.limitMinutes === l.lastTrainMinutes)

  return {
    boardByMinutes,
    leaveByMinutes,
    boardBy: formatLateNight(boardByMinutes),
    leaveBy: formatLateNight(leaveByMinutes),
    legLimits: limits,
    binding,
  }
}

/** 終電が登録されている区間がひとつでもあるか (案内文の出し分けに使う) */
export function hasAnyLastTrain(legs: RouteLeg[]): boolean {
  return legs.some((l) => l.lastTrainFrom || l.lastTrainTo)
}
