/**
 * 登録した列車の時刻から「間に合ういちばん遅い電車」を選ぶ。
 *
 * 所要時間だけで逆算すると「8:00に駅に着けばいい」までしか分からず、
 * 実際には次の電車が 8:12 で12分待つ、ということが起きる。
 * 本数の少ない路線（常磐線など）はここが効くので、便ごとの時刻を持って選べるようにする。
 *
 * 山手線のように数分間隔で来る路線は待ち時間がほぼ出ないため時刻表を持たず、
 * 乗換駅から先は「区間の所要時間」で足す（extraMinutes）。
 */

import type { ServiceDays, TrainRun } from '../types'
import { fromMinutes, parseDate, toMinutes } from './date'
import { normalizeStation, sameStation } from './routes'

/** その日に走る便か */
export function runsOnDate(run: TrainRun, dateKey: string): boolean {
  if (run.serviceDays === 'all') return true
  const day = parseDate(dateKey).getDay()
  const isHoliday = day === 0 || day === 6
  return run.serviceDays === 'holiday' ? isHoliday : !isHoliday
}

/**
 * 時刻を「直前の時刻より後」になるまで24時間ずつ進める。
 *
 * 23:50発 → 00:03着 のように日をまたぐ便を、そのまま分に直すと
 * 00:03 が 3分になって「早朝に着く」と誤判定してしまうため、通し時刻に直す。
 */
function advance(previous: number, time: string): number {
  let m = toMinutes(time)
  while (m < previous) m += 1440
  return m
}

/** 便の中からその駅の時刻を引く */
export function stopTime(run: TrainRun, station: string): string | undefined {
  return run.stops.find((s) => sameStation(s.station, station))?.time
}

/** 出発駅より後に停車するか（同じ便で乗り通せるか） */
function indexOf(run: TrainRun, station: string): number {
  return run.stops.findIndex((s) => sameStation(s.station, station))
}

export interface RunChoice {
  run: TrainRun
  /** 出発駅の発車時刻 */
  departAt: string
  departMinutes: number
  /** 降りる駅 */
  alightAt: string
  /** 降りる駅の到着時刻 */
  arriveAt: string
  arriveMinutes: number
  /** 降りたあと目的地までにかかる時間（乗換＋乗車＋徒歩） */
  extraMinutes: number
  /** 目的地に着く時刻 */
  finalMinutes: number
  /** 目的地の希望時刻までの余り。小さいほど無駄がない */
  slackMinutes: number
  /** 到着時刻を所要時間から見積もったもの（降車駅の時刻が登録されていない） */
  estimated?: boolean
  /** 乗り継ぐ2本目の便。時刻表のある路線どうしをつないだときに入る */
  connection?: {
    run: TrainRun
    /** 乗り継ぎ駅を出る時刻 */
    departAt: string
    /** 目的地に着く時刻 */
    arriveAt: string
    /** 乗り継ぎ駅での待ち時間 */
    waitMinutes: number
  }
}

/** 乗り継ぎの指定 */
export interface ChainInput {
  /** 乗り継ぐ駅 */
  at: string
  /** 2本目で降りる駅 */
  to: string
  /** 乗り継ぎに要する時間（ホーム移動など） */
  transferMinutes: number
  /** 降りたあと目的地までにかかる時間（徒歩＋余裕） */
  tailMinutes: number
}

export interface ChooseInput {
  runs: TrainRun[]
  dateKey: string
  from: string
  /** 降りる候補の駅と、そこから目的地までにかかる時間 */
  alightOptions: Array<{ station: string; extraMinutes: number }>
  /** 目的地に着きたい時刻 'HH:MM' */
  arriveBy: string
  /**
   * 降車駅の時刻を持たない便のための、出発から目的地までの所要時間。
   * 発車時刻だけを登録した時刻表でも使えるようにするためのもので、
   * 区間に登録した所要時間から算出する。
   */
  fallbackMinutes?: number
  /** 時刻表のある路線どうしを乗り継ぐとき */
  chain?: ChainInput
  /** 何本まで返すか */
  limit?: number
}

/**
 * 乗り継ぎ駅を time 以降に出て、目的地に停まる便のうち、いちばん早く着くもの。
 */
function firstConnection(
  runs: TrainRun[],
  dateKey: string,
  at: string,
  to: string,
  notBefore: number,
): {
  run: TrainRun
  departAt: string
  departMinutes: number
  arriveAt: string
  arriveMinutes: number
} | null {
  let best: {
    run: TrainRun
    departAt: string
    departMinutes: number
    arriveAt: string
    arriveMinutes: number
  } | null = null
  for (const run of runs) {
    if (!runsOnDate(run, dateKey)) continue
    const i = indexOf(run, at)
    if (i < 0) continue
    const j = indexOf(run, to)
    if (j <= i) continue
    // 乗り継ぎ駅を出る時刻。日をまたぐ便も通し時刻で比べる
    const departMinutes = advance(notBefore, run.stops[i].time)
    // 24時間以上先の便は乗り継ぎとして扱わない
    if (departMinutes - notBefore > 240) continue
    const arriveMinutes = advance(departMinutes, run.stops[j].time)
    if (!best || arriveMinutes < best.arriveMinutes) {
      best = {
        run,
        departAt: run.stops[i].time,
        departMinutes,
        arriveAt: run.stops[j].time,
        arriveMinutes,
      }
    }
  }
  return best
}

/**
 * 間に合う便を、遅く出られる順に返す。
 * 先頭が「いちばん遅く出られて間に合う便」＝最適。
 */
export function chooseRuns(input: ChooseInput): RunChoice[] {
  const deadline = toMinutes(input.arriveBy)
  const out: RunChoice[] = []

  for (const run of input.runs) {
    if (!runsOnDate(run, input.dateKey)) continue
    const fromIndex = indexOf(run, input.from)
    if (fromIndex < 0) continue
    const departAt = run.stops[fromIndex].time

    // 時刻表のある路線どうしを乗り継ぐ場合
    if (input.chain) {
      const i = indexOf(run, input.chain.at)
      if (i > fromIndex) {
        const arriveMinutes = advance(toMinutes(departAt), run.stops[i].time)
        const next = firstConnection(
          input.runs,
          input.dateKey,
          input.chain.at,
          input.chain.to,
          arriveMinutes + Math.max(0, input.chain.transferMinutes),
        )
        if (next) {
          const finalMinutes = next.arriveMinutes + Math.max(0, input.chain.tailMinutes)
          if (finalMinutes <= deadline) {
            out.push({
              run,
              departAt,
              departMinutes: toMinutes(departAt),
              alightAt: input.chain.at,
              arriveAt: run.stops[i].time,
              arriveMinutes,
              extraMinutes: finalMinutes - arriveMinutes,
              finalMinutes,
              slackMinutes: deadline - finalMinutes,
              connection: {
                run: next.run,
                departAt: next.departAt,
                arriveAt: next.arriveAt,
                waitMinutes: next.departMinutes - arriveMinutes,
              },
            })
          }
        }
      }
      continue
    }

    // 降りる駅の候補ごとに、目的地に着く時刻を出す
    let matched = false
    for (const option of input.alightOptions) {
      const alightIndex = indexOf(run, option.station)
      // 出発駅より後に停まる駅でなければ乗り通せない
      if (alightIndex <= fromIndex) continue
      matched = true
      const arriveAt = run.stops[alightIndex].time
      const arriveMinutes = advance(toMinutes(departAt), arriveAt)
      const finalMinutes = arriveMinutes + Math.max(0, option.extraMinutes)
      if (finalMinutes > deadline) continue

      out.push({
        run,
        departAt,
        departMinutes: toMinutes(departAt),
        alightAt: option.station,
        arriveAt,
        arriveMinutes,
        extraMinutes: option.extraMinutes,
        finalMinutes,
        slackMinutes: deadline - finalMinutes,
      })
    }

    // 降車駅の時刻が無い便は、区間に登録した所要時間で目的地の到着を見積もる
    if (!matched && input.fallbackMinutes != null) {
      const departMinutes = toMinutes(departAt)
      const finalMinutes = departMinutes + Math.max(0, input.fallbackMinutes)
      if (finalMinutes <= deadline) {
        out.push({
          run,
          departAt,
          departMinutes,
          alightAt: input.alightOptions[input.alightOptions.length - 1]?.station ?? '目的地',
          arriveAt: fromMinutes(finalMinutes),
          arriveMinutes: finalMinutes,
          extraMinutes: 0,
          finalMinutes,
          slackMinutes: deadline - finalMinutes,
          estimated: true,
        })
      }
    }
  }

  // 同じ便で複数の降車駅が候補になったときは、目的地に早く着くほうを残す
  const best = new Map<string, RunChoice>()
  for (const choice of out) {
    const prev = best.get(choice.run.id)
    if (!prev || choice.finalMinutes < prev.finalMinutes) best.set(choice.run.id, choice)
  }

  return [...best.values()]
    .sort((a, b) => {
      // 追加料金の要る便（特急など）は、同じ時間帯なら後ろに回す
      const fee = Number(a.run.surcharge ?? false) - Number(b.run.surcharge ?? false)
      if (fee !== 0) return fee
      return b.departMinutes - a.departMinutes
    })
    .slice(0, input.limit ?? 3)
}

/** その路線・向きに登録されている駅を、便の停車順にならして集める */
export function stationsOfLine(runs: TrainRun[], line: string): string[] {
  const order: string[] = []
  for (const run of runs.filter((r) => r.line === line)) {
    for (const stop of run.stops) {
      if (!order.some((s) => sameStation(s, stop.station))) order.push(stop.station)
    }
  }
  return order
}

/** 登録されている路線名の一覧 */
export function lineNames(runs: TrainRun[]): string[] {
  const set = new Set<string>()
  for (const r of runs) set.add(r.line)
  return [...set].sort((a, b) => a.localeCompare(b, 'ja'))
}

/** その駅を通る便があるか（時刻表で計算できる区間かの判定） */
export function hasTimetableFor(runs: TrainRun[], from: string, dateKey: string): boolean {
  const key = normalizeStation(from)
  return runs.some((r) => runsOnDate(r, dateKey) && r.stops.some((s) => normalizeStation(s.station) === key))
}

export const SERVICE_OPTIONS: Array<{ value: ServiceDays; label: string }> = [
  { value: 'weekday', label: '平日' },
  { value: 'holiday', label: '土休日' },
  { value: 'all', label: '毎日' },
]

/** その駅の時刻を持つ便があるか（乗り継ぎを時刻表でつなげるかの判定） */
export function hasStopFor(runs: TrainRun[], station: string, dateKey: string): boolean {
  return runs.some(
    (r) => runsOnDate(r, dateKey) && r.stops.some((s) => sameStation(s.station, station)),
  )
}

/** 帰りの最終便 */
export interface LastRunHome {
  run: TrainRun
  /** 出発駅を出る時刻 */
  departAt: string
  departMinutes: number
  /** 自宅の最寄り駅に着く時刻 */
  arriveAt: string
  arriveMinutes: number
}

/**
 * from を出て to に着く便のうち、いちばん遅く出るもの。
 * 帰りの終電を、手入力ではなく時刻表から出すために使う。
 */
export function lastRunBetween(
  runs: TrainRun[],
  dateKey: string,
  from: string,
  to: string,
): LastRunHome | null {
  let best: LastRunHome | null = null
  for (const run of runs) {
    if (!runsOnDate(run, dateKey)) continue
    const i = indexOf(run, from)
    if (i < 0) continue
    const j = indexOf(run, to)
    if (j <= i) continue
    const departMinutes = toMinutes(run.stops[i].time)
    // 深夜0時台の便は前日からの通し時刻として扱う
    const normalized = departMinutes < 240 ? departMinutes + 1440 : departMinutes
    const arriveMinutes = advance(normalized, run.stops[j].time)
    if (!best || normalized > best.departMinutes) {
      best = {
        run,
        departAt: run.stops[i].time,
        departMinutes: normalized,
        arriveAt: run.stops[j].time,
        arriveMinutes,
      }
    }
  }
  return best
}

/**
 * 乗り換えを1回はさむ最終便。
 *
 * 大学（運河）から自宅へ帰るように、途中で別の路線に乗り継ぐ場合に使う。
 * 「乗り継げる中でいちばん遅く出られる便」を探すので、
 * 1本目が遅くても乗り継ぎが無ければ採用しない。
 */
export function lastRunChainHome(
  runs: TrainRun[],
  dateKey: string,
  from: string,
  via: string,
  to: string,
  transferMinutes: number,
): (LastRunHome & { connection: LastRunHome }) | null {
  let best: (LastRunHome & { connection: LastRunHome }) | null = null

  for (const run of runs) {
    if (!runsOnDate(run, dateKey)) continue
    const i = indexOf(run, from)
    if (i < 0) continue
    const j = indexOf(run, via)
    if (j <= i) continue

    const rawDepart = toMinutes(run.stops[i].time)
    // 0時台の便は前日からの通し時刻として扱う
    const departMinutes = rawDepart < 240 ? rawDepart + 1440 : rawDepart
    const viaMinutes = advance(departMinutes, run.stops[j].time)

    // 乗り継ぎ先を探す
    const next = firstConnection(
      runs,
      dateKey,
      via,
      to,
      viaMinutes + Math.max(0, transferMinutes),
    )
    if (!next) continue

    if (!best || departMinutes > best.departMinutes) {
      best = {
        run,
        departAt: run.stops[i].time,
        departMinutes,
        arriveAt: next.arriveAt,
        arriveMinutes: next.arriveMinutes,
        connection: {
          run: next.run,
          departAt: next.departAt,
          departMinutes: next.departMinutes,
          arriveAt: next.arriveAt,
          arriveMinutes: next.arriveMinutes,
        },
      }
    }
  }
  return best
}
