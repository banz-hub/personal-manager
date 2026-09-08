/**
 * 空き時間に何をするかの候補を、よてい帳から借りてくる。
 *
 * **並べ方はここで決めない。**よてい帳の `suggest.ts` をそのまま呼ぶ。
 * 同じ「空き時間の使い道」を 2 通りに計算すると、
 * よてい帳の画面とエージェントの画面で違うものが出て、どちらが正しいのか分からなくなる。
 *
 * ここがやるのは、エージェントの空き時間 (FreeSlot) を
 * よてい帳の空き時間 (Gap) の形に直すことだけ。
 *
 * **読むだけで書かない。**「済み」にするのはよてい帳の担当。
 * やることの正本は向こうにあり、こちらから触ると二重に持つことになる。
 */

import type { Interest, Todo } from '../../yotei/types'
import type { Gap } from '../../yotei/lib/schedule'
import { suggestForGap, type Suggestion } from '../../yotei/lib/suggest'
import { fromMinutes } from './date'
import { normalize } from './search'
import { minutesOf, type FreeSlot } from './scheduler'

/** 場所の手がかりが無い空き時間の扱い。手入力の空き時間はこれになる */
const UNKNOWN_SPOT = 'anywhere' as const

/**
 * エージェントの空き時間を、よてい帳の空き時間の形に直す。
 *
 * `travelReserved` を 0 にしてあるのは、
 * エージェント側の `findSlots` が移動のぶんを **先に差し引いた** 結果を渡してくるため。
 * ここでもう一度引くと二重に引くことになる。
 */
export function slotToGap(slot: FreeSlot): Gap {
  return {
    startMin: slot.startMin,
    endMin: slot.endMin,
    start: fromMinutes(slot.startMin),
    end: fromMinutes(slot.endMin),
    minutes: minutesOf(slot),
    spot: slot.spot ?? UNKNOWN_SPOT,
    placeLabel: slot.placeLabel ?? slot.label ?? '',
    travelReserved: 0,
  }
}

export interface FreeTimeInput {
  slots: FreeSlot[]
  todos: Todo[]
  interests: Interest[]
  today: string
  /** 1 つの空き時間あたり何件まで出すか */
  limit?: number
  /**
   * すでにこの画面の別のところに出ている題名。同じものを二度出さない。
   *
   * 例: 筋トレログが「今日やる」と言っている日に、
   * よてい帳の趣味にも「筋トレ」が入っていると、1 つの画面に 2 回出る。
   * どちらを見ればいいのか分からなくなるので、あとから出るこちらを引っ込める。
   *
   * **記録どうしを結びつけるためのものではない。**表示の重複を消すだけ。
   * 消しても実害が無いのは、消えた側がただの候補で、
   * 残る側が理由と時間を持った本物の予定だから。
   */
  alreadyShown?: string[]
}

export interface SlotSuggestions {
  slot: FreeSlot
  suggestions: Suggestion[]
}

/**
 * 空き時間ごとの候補。候補が 1 件も無い空き時間は落とす
 * (見出しだけ並んでも読むものが無いので)。
 */
export function suggestForSlots(input: FreeTimeInput): SlotSuggestions[] {
  const out: SlotSuggestions[] = []
  const shown = new Set((input.alreadyShown ?? []).map(normalize))
  for (const slot of input.slots) {
    const suggestions = suggestForGap({
      gap: slotToGap(slot),
      todos: input.todos,
      interests: input.interests,
      today: input.today,
      // 埋め草を落としたぶんが減るので、多めに取ってから絞る
      limit: (input.limit ?? 3) + GENERIC_HEADROOM,
    })
      // 「短い用事を片づける」のような埋め草は落とす。
      // よてい帳では何も登録が無い人向けに要るが、こちらの画面には
      // すでに優先順位・学習・筋トレが並んでいる。中身の無い行を足すと、
      // 本当に読むべき候補が下に押し出される
      .filter((s) => s.source !== 'generic')
      // すでに画面の別のところに出ているものは重ねない
      .filter((s) => !shown.has(normalize(s.title)))
      .slice(0, input.limit ?? 3)
    if (suggestions.length > 0) out.push({ slot, suggestions })
  }
  return out
}

/** 埋め草を落とすぶん、よてい帳から多めに受け取る枚数 */
const GENERIC_HEADROOM = 3

/** 出どころを画面に出すための名前 */
export const SOURCE_LABELS: Record<Suggestion['source'], string> = {
  todo: 'やること',
  interest: '趣味',
  context: '今日の予定から',
  generic: 'ひと休み',
}
