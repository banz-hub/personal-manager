/**
 * エージェントが組んだ予定を、よてい帳へ書き戻す。
 *
 * **これはエージェントが他のアプリに書き込む唯一の場所。**
 * よてい帳には手で入れた予定と、785 便の時刻表という作り直せない資産がある。
 * だから安全側の決まりを先に置き、それを破る書き込みは行わない。
 *
 *  1. **触るのは `source === 'pm'` のイベントだけ。** 手で入れた予定には一切触れない
 *  2. 触るのは指定した 1 日ぶんだけ。他の日のイベントは読むだけで素通しする
 *  3. 書き込むのは `events` キーだけ。時刻表・区間・授業・支出には触れない
 *  4. 書く直前にもう一度読み直す。画面を開いてから時間が経っていても、
 *     その間によてい帳側で入れた予定を消さないため
 *  5. 書く前に検算する。**エージェント以外のイベントが 1 件でも減っていたら中止する**
 *
 * 5 が最後の砦で、ここを通らない書き込みは起きない。
 */

import { createStore, get, set } from 'idb-keyval'
import type { PlanBlock } from '../../types'

const store = createStore('yoteicho-app', 'state')

/** エージェントが作ったことを示す印。これが無いイベントには絶対に触れない */
export const PM_SOURCE = 'pm'

/** よてい帳のイベント。読み書きするぶんだけ */
export interface YEventLike {
  id: string
  title: string
  category: string
  date: string
  start: string
  end: string
  needsTravel: boolean
  memo?: string
  /** エージェントが作ったイベントにだけ入る */
  source?: string
  /** 元になった予定のコマ */
  pmBlockId?: string
  [key: string]: unknown
}

export function isPmEvent(e: YEventLike): boolean {
  return e.source === PM_SOURCE
}

export interface WriteBackPlan {
  date: string
  /** これから作るイベント */
  create: YEventLike[]
  /** エージェントが前に作ったもので、もう予定に無いので消すイベント */
  remove: YEventLike[]
  /** 手で入れたイベントなど、触らないものの数 */
  untouched: number
  /** 書くものが何も無いか */
  empty: boolean
}

/** 予定表のコマをよてい帳のイベントの形にする */
export function blockToEvent(block: PlanBlock, date: string): YEventLike {
  return {
    id: `pm_${block.id}`,
    title: block.title,
    // 就活かどうかをエージェントは知っているが、細かい分類はよてい帳側の都合なので other にそろえる
    category: 'other',
    date,
    start: block.start,
    end: block.end,
    // 場所を知らないまま移動ありにすると、よてい帳の出発時刻の計算が狂う
    needsTravel: false,
    memo: 'エージェントが作成',
    source: PM_SOURCE,
    pmBlockId: block.id,
  }
}

/**
 * 何を作って何を消すかを先に決める。**ここでは書き込まない。**
 * 画面でこの内容を見せて、ユーザーが納得してから applyWriteBack を呼ぶ。
 */
export function planWriteBack(
  existing: YEventLike[],
  blocks: PlanBlock[],
  date: string,
): WriteBackPlan {
  // 休憩と予備はカレンダーに出しても邪魔なだけなので送らない
  const target = blocks.filter(
    (b) => b.kind === 'task' || b.kind === 'study' || b.kind === 'workout',
  )
  const create = target.map((b) => blockToEvent(b, date))
  const wantIds = new Set(create.map((e) => e.id))

  // その日の、エージェントが前に作ったイベント
  const minePreviously = existing.filter((e) => e.date === date && isPmEvent(e))
  const remove = minePreviously.filter((e) => !wantIds.has(e.id))

  return {
    date,
    create,
    remove,
    untouched: existing.filter((e) => !isPmEvent(e)).length,
    empty: create.length === 0 && remove.length === 0,
  }
}

export interface WriteResult {
  ok: boolean
  created: number
  removed: number
  message: string
}

/** よてい帳の events を読む。読めなければ null */
export async function readYoteichoEvents(): Promise<YEventLike[] | null> {
  try {
    const events = await get<YEventLike[]>('events', store)
    return events ?? null
  } catch {
    return null
  }
}

/**
 * 実際に書き込む。
 *
 * 引数の plan は画面に見せたときのものだが、**中身は使わずに組み立て直す。**
 * 見せてから押すまでの間によてい帳側が変わっている可能性があるので、
 * 必ず読み直した最新の一覧を土台にする。
 */
export async function applyWriteBack(
  blocks: PlanBlock[],
  date: string,
): Promise<WriteResult> {
  const before = await readYoteichoEvents()
  if (before === null) {
    return { ok: false, created: 0, removed: 0, message: 'よてい帳のデータを読めませんでした' }
  }

  const plan = planWriteBack(before, blocks, date)
  const removeIds = new Set(plan.remove.map((e) => e.id))
  const createIds = new Set(plan.create.map((e) => e.id))

  const next = [
    // 消すものと、同じ id で作り直すものを除いて残す
    ...before.filter((e) => !removeIds.has(e.id) && !createIds.has(e.id)),
    ...plan.create,
  ]

  const check = verify(before, next)
  if (!check.ok) {
    return { ok: false, created: 0, removed: 0, message: check.message }
  }

  try {
    await set('events', next, store)
  } catch (e) {
    return {
      ok: false,
      created: 0,
      removed: 0,
      message: `書き込めませんでした (${e instanceof Error ? e.message : String(e)})`,
    }
  }

  return {
    ok: true,
    created: plan.create.length,
    removed: plan.remove.length,
    message: `よてい帳に${plan.create.length}件を反映しました${plan.remove.length > 0 ? `（前に作った${plan.remove.length}件は差し替え）` : ''}。手で入れた予定${plan.untouched}件は触っていません。`,
  }
}

/**
 * 書く前の検算。
 * **エージェント以外のイベントが 1 件でも欠けていたら書かない。**
 * ここを通らなければ、手で入れた予定が消えることはない。
 */
export function verify(
  before: YEventLike[],
  next: YEventLike[],
): { ok: boolean; message: string } {
  const mineGone = before.filter((e) => !isPmEvent(e))
  const nextIds = new Set(next.map((e) => e.id))

  const missing = mineGone.filter((e) => !nextIds.has(e.id))
  if (missing.length > 0) {
    return {
      ok: false,
      message: `安全のため中止しました。手で入れた予定が${missing.length}件消えてしまう計算になっています（例: ${missing[0].title || missing[0].date}）。`,
    }
  }

  // 念のため、同じ id が二重にならないことも見る
  if (nextIds.size !== next.length) {
    return { ok: false, message: '安全のため中止しました。同じ id の予定が重複しています。' }
  }

  return { ok: true, message: '' }
}

/**
 * エージェントが作ったイベントをすべて取り消す。
 * 「やっぱりカレンダーを汚したくない」と思ったときの戻し口。
 */
export async function clearPmEvents(): Promise<WriteResult> {
  const before = await readYoteichoEvents()
  if (before === null) {
    return { ok: false, created: 0, removed: 0, message: 'よてい帳のデータを読めませんでした' }
  }

  const next = before.filter((e) => !isPmEvent(e))
  const removed = before.length - next.length

  const check = verify(before, next)
  if (!check.ok) return { ok: false, created: 0, removed: 0, message: check.message }

  try {
    await set('events', next, store)
  } catch (e) {
    return {
      ok: false,
      created: 0,
      removed: 0,
      message: `書き込めませんでした (${e instanceof Error ? e.message : String(e)})`,
    }
  }

  return {
    ok: true,
    created: 0,
    removed,
    message: `エージェントが作った${removed}件を取り消しました。手で入れた予定${next.length}件はそのままです。`,
  }
}
