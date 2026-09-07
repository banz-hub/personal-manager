/**
 * 登録済み区間から経路を組み立てる。
 *
 * 乗換案内API を使わない方針なので、ここでやっているのは
 * 「自分で登録した区間をつなぎ合わせて経路を作る」だけ。
 * 例えば「自宅最寄り→東京」と「東京→渋谷」を登録しておけば
 * 「自宅最寄り→渋谷」も出せる。登録が無い区間は null を返し、
 * 画面側で乗換案内アプリへのリンクに切り替える。
 */

import type { Pass, RouteLeg } from '../types'

/** 表記ゆれを吸収する。「新宿駅」「 新宿 」→「新宿」 */
export function normalizeStation(name: string): string {
  return name
    .replace(/\u3000/g, ' ')
    .trim()
    .replace(/駅$/, '')
    .toLowerCase()
}

export function sameStation(a: string, b: string): boolean {
  return normalizeStation(a) === normalizeStation(b) && normalizeStation(a) !== ''
}

/** 経路の1本。登録区間を順につないだもの */
export interface RoutePlan {
  /** 通る駅の並び (出発駅を含む) */
  stations: string[]
  legs: RouteLeg[]
  /** 乗車時間の合計 (分)。区間をまたぐ乗り継ぎに +5 分みておく */
  minutes: number
  /** 定期券を考えない運賃 */
  fareYen: number
  /** 乗換回数の目安 */
  transfers: number
  /** この案の売り。'最速' など */
  label: string
}

/** 区間をまたいで乗り継ぐときに見込む待ち時間 (分) */
const CONNECTION_MINUTES = 5

interface Edge {
  to: string
  leg: RouteLeg
}

function buildGraph(legs: RouteLeg[]): Map<string, Edge[]> {
  const graph = new Map<string, Edge[]>()
  const push = (from: string, to: string, leg: RouteLeg) => {
    const key = normalizeStation(from)
    if (!key) return
    const list = graph.get(key) ?? []
    list.push({ to, leg })
    graph.set(key, list)
  }
  for (const leg of legs) {
    // 向きは区別しない
    push(leg.from, leg.to, leg)
    push(leg.to, leg.from, leg)
  }
  return graph
}

function planFrom(stations: string[], legs: RouteLeg[]): RoutePlan {
  const minutes =
    legs.reduce((sum, l) => sum + l.minutes, 0) + Math.max(0, legs.length - 1) * CONNECTION_MINUTES
  return {
    stations,
    legs,
    minutes,
    fareYen: legs.reduce((sum, l) => sum + l.fareYen, 0),
    transfers: legs.reduce((sum, l) => sum + l.transfers, 0) + Math.max(0, legs.length - 1),
    label: '',
  }
}

/**
 * 登録区間から from→to の経路候補を作る。
 * 見つからなければ空配列。最大 maxPlans 件を「最速 / 乗換が少ない / 安い」で選ぶ。
 */
export function findPlans(
  from: string,
  to: string,
  legs: RouteLeg[],
  maxPlans = 3,
  maxLegs = 4,
): RoutePlan[] {
  const start = normalizeStation(from)
  const goal = normalizeStation(to)
  if (!start || !goal) return []
  if (start === goal) return []

  const graph = buildGraph(legs)
  const found: RoutePlan[] = []
  let visitedCount = 0

  const walk = (current: string, stations: string[], used: RouteLeg[], seen: Set<string>) => {
    // 組み合わせ爆発を避けるための保険
    if (found.length >= 60 || visitedCount > 4000) return
    visitedCount++
    if (used.length >= maxLegs) return
    for (const edge of graph.get(current) ?? []) {
      const next = normalizeStation(edge.to)
      if (seen.has(next)) continue
      const nextStations = [...stations, edge.to]
      const nextLegs = [...used, edge.leg]
      if (next === goal) {
        found.push(planFrom(nextStations, nextLegs))
        continue
      }
      seen.add(next)
      walk(next, nextStations, nextLegs, seen)
      seen.delete(next)
    }
  }

  walk(start, [from], [], new Set([start]))
  if (found.length === 0) return []

  // 同じ駅の並びは1本にまとめる
  const unique = new Map<string, RoutePlan>()
  for (const plan of found) {
    const key = plan.stations.map(normalizeStation).join('>')
    const prev = unique.get(key)
    if (!prev || plan.minutes < prev.minutes) unique.set(key, plan)
  }
  // 遠回りしすぎる案は候補から外す。区間をつないで探すので、放っておくと
  // 「一度都心に出てから戻る」ような案が混ざってしまう。
  const values = [...unique.values()]
  const fastest = Math.min(...values.map((p) => p.minutes))
  const all = values.filter((p) => p.minutes <= fastest * 1.5 + 10)

  const picked: RoutePlan[] = []
  const take = (plan: RoutePlan | undefined, label: string) => {
    if (!plan) return
    if (picked.some((p) => p.stations.join('>') === plan.stations.join('>'))) return
    picked.push({ ...plan, label })
  }
  take([...all].sort((a, b) => a.minutes - b.minutes)[0], '最速')
  take(
    [...all].sort((a, b) => a.transfers - b.transfers || a.minutes - b.minutes)[0],
    '乗換が少ない',
  )
  take([...all].sort((a, b) => a.fareYen - b.fareYen || a.minutes - b.minutes)[0], '安い')
  // まだ枠が余っていれば所要時間の短い順に足す
  for (const plan of [...all].sort((a, b) => a.minutes - b.minutes)) {
    if (picked.length >= maxPlans) break
    take(plan, '別ルート')
  }
  return picked.slice(0, maxPlans)
}

/** その日に有効な定期券 */
export function activePasses(passes: Pass[], dateKey: string): Pass[] {
  return passes.filter((p) => dateKey >= p.startDate && dateKey <= p.endDate)
}

/** 区間の両端が定期券に含まれていれば運賃はかからない */
export function isCoveredByPass(leg: RouteLeg, passes: Pass[]): Pass | null {
  for (const pass of passes) {
    const set = new Set(pass.stations.map(normalizeStation))
    if (set.has(normalizeStation(leg.from)) && set.has(normalizeStation(leg.to))) return pass
  }
  return null
}

export interface FareBreakdown {
  /** 実際に払う額 */
  chargedYen: number
  /** 定期券で浮いた額 */
  coveredYen: number
  /** 定期券が効いた区間の説明 */
  coveredBy: string[]
}

/** 定期券を当てはめて、実際にかかる運賃を出す */
export function fareWithPasses(plan: RoutePlan, passes: Pass[]): FareBreakdown {
  let charged = 0
  let covered = 0
  const coveredBy: string[] = []
  for (const leg of plan.legs) {
    const pass = isCoveredByPass(leg, passes)
    if (pass) {
      covered += leg.fareYen
      if (!coveredBy.includes(pass.name)) coveredBy.push(pass.name)
    } else {
      charged += leg.fareYen
    }
  }
  return { chargedYen: charged, coveredYen: covered, coveredBy }
}

/** 登録済みの駅名を集めて入力補助に使う */
export function knownStations(legs: RouteLeg[], extra: string[] = []): string[] {
  const set = new Set<string>()
  for (const leg of legs) {
    if (leg.from.trim()) set.add(leg.from.trim())
    if (leg.to.trim()) set.add(leg.to.trim())
  }
  for (const s of extra) if (s.trim()) set.add(s.trim())
  return [...set].sort((a, b) => a.localeCompare(b, 'ja'))
}
