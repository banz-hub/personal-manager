/**
 * 空き時間に何をするかの提案。
 *
 * 外部サービスは使わず、登録された「やること」と「趣味・関心」を
 * 空き時間の長さ・場所・時間帯と突き合わせて並べ替えているだけ。
 * どういう理由で出てきたかを reason に必ず入れて、納得して選べるようにする。
 */

import type { EventItem, Interest, SpotKind, Todo } from '../types'
import { SPOT_LABELS } from '../types'
import type { Gap } from './schedule'
import { formatDuration } from './date'

export interface Suggestion {
  id: string
  title: string
  reason: string
  minutes: number
  source: 'todo' | 'interest' | 'context' | 'generic'
  todo?: Todo
  interest?: Interest
  score: number
}

/** その空き時間の場所で、この候補ができるか */
function spotMatches(spots: SpotKind[], gapSpot: SpotKind): boolean {
  if (spots.length === 0) return true
  if (spots.includes('anywhere')) return true
  if (gapSpot === 'outside') {
    // 外出先なら「外出先でできること」と「どこでも」が対象
    return spots.some((s) => s !== 'home')
  }
  return spots.includes(gapSpot)
}

function daysUntil(dueDate: string, today: string): number {
  const a = new Date(dueDate).getTime()
  const b = new Date(today).getTime()
  return Math.round((a - b) / 86400000)
}

export interface SuggestInput {
  gap: Gap
  todos: Todo[]
  interests: Interest[]
  today: string
  /** その日の予定。文脈のある提案に使う */
  dayEvents?: EventItem[]
  limit?: number
}

export function suggestForGap(input: SuggestInput): Suggestion[] {
  const { gap, today } = input
  const out: Suggestion[] = []
  const hour = Math.floor(gap.startMin / 60)

  // --- やること ---
  for (const todo of input.todos) {
    if (todo.doneAt) continue
    if (todo.minutes > gap.minutes) continue
    if (!spotMatches(todo.spots, gap.spot)) continue

    let score = 40 + todo.priority * 20
    const reasons: string[] = []
    if (todo.priority === 3) reasons.push('優先度が高い')
    if (todo.dueDate) {
      const left = daysUntil(todo.dueDate, today)
      if (left <= 0) {
        score += 60
        reasons.push('期限を過ぎている')
      } else if (left <= 3) {
        score += 40
        reasons.push(`期限まであと${left}日`)
      } else if (left <= 7) {
        score += 15
        reasons.push('今週が期限')
      }
    }
    // 空き時間を余らせすぎない候補を上に
    const fit = todo.minutes / gap.minutes
    score += Math.round(fit * 25)
    if (fit > 0.6) reasons.push('この空き時間にちょうど収まる')
    if (gap.spot !== 'anywhere' && todo.spots.includes(gap.spot)) {
      score += 15
      reasons.push(`${SPOT_LABELS[gap.spot]}でできる`)
    }

    out.push({
      id: `todo:${todo.id}`,
      title: todo.title,
      reason: reasons.join(' / ') || `${formatDuration(todo.minutes)}で終わる`,
      minutes: todo.minutes,
      source: 'todo',
      todo,
      score,
    })
  }

  // --- 趣味・関心 ---
  for (const interest of input.interests) {
    if (interest.minMinutes > gap.minutes) continue
    if (!spotMatches(interest.spots, gap.spot)) continue
    let score = 30
    const reasons = [`${formatDuration(interest.minMinutes)}あればできる趣味`]
    if (interest.hours) {
      const [from, to] = interest.hours
      if (hour < from || hour >= to) continue
      score += 10
      reasons.push('気分の乗る時間帯')
    }
    if (interest.spots.includes(gap.spot)) {
      score += 15
      reasons.push(`${SPOT_LABELS[gap.spot]}向き`)
    }
    if (gap.minutes >= interest.minMinutes * 2) {
      score += 5
      reasons.push('じっくり時間が取れる')
    }
    out.push({
      id: `interest:${interest.id}`,
      title: interest.name,
      reason: reasons.join(' / '),
      minutes: Math.min(gap.minutes, interest.minMinutes),
      source: 'interest',
      interest,
      score,
    })
  }

  // --- その日の予定から出る文脈 ---
  out.push(...contextSuggestions(input))

  // --- 何も登録が無いとき用 ---
  if (out.length === 0) out.push(...genericSuggestions(gap))

  return out.sort((a, b) => b.score - a.score).slice(0, input.limit ?? 5)
}

/** 直後の予定の種類から出てくる、その場面ならではの候補 */
function contextSuggestions(input: SuggestInput): Suggestion[] {
  const { gap } = input
  const out: Suggestion[] = []
  const after = gap.after
  const onTrip = (input.dayEvents ?? []).some((e) => e.category === 'trip')

  if (after?.category === 'jobhunt' && gap.minutes >= 15) {
    out.push({
      id: 'ctx:jobhunt-prep',
      title: `${after.title} の直前確認`,
      reason: 'このあと就活の予定 / 場所と持ち物、話す内容を見直す',
      minutes: Math.min(30, gap.minutes),
      source: 'context',
      score: 150,
    })
  }
  if (after && gap.travelReserved > 0 && gap.minutes >= 10) {
    out.push({
      id: 'ctx:move',
      title: `${after.title} へ移動`,
      reason: `移動に${formatDuration(gap.travelReserved)}を確保済み / 残りが自由時間`,
      minutes: gap.travelReserved,
      source: 'context',
      score: 90,
    })
  }
  if (onTrip && gap.minutes >= 45 && gap.spot !== 'home') {
    out.push({
      id: 'ctx:trip-walk',
      title: `${gap.placeLabel}を歩いてみる`,
      reason: `旅行中の空き ${formatDuration(gap.minutes)} / 次の予定まで戻れる範囲で`,
      minutes: Math.min(90, gap.minutes),
      source: 'context',
      score: 110,
    })
  }
  if (!gap.after && gap.minutes >= 30 && gap.spot === 'home') {
    out.push({
      id: 'ctx:tomorrow',
      title: '明日の予定と出発時刻を確認',
      reason: '今日の予定はここまで / 朝あわてないための5分',
      minutes: 5,
      source: 'context',
      score: 70,
    })
  }
  return out
}

/** 登録がまだ無いときに、とりあえず出す候補 */
function genericSuggestions(gap: Gap): Suggestion[] {
  const base = `${formatDuration(gap.minutes)}の空き / ${gap.placeLabel}`
  if (gap.minutes < 30) {
    return [
      {
        id: 'gen:short',
        title: '短い用事を片づける',
        reason: `${base} — 「やること」に登録しておくとここに具体名が出ます`,
        minutes: gap.minutes,
        source: 'generic',
        score: 10,
      },
    ]
  }
  if (gap.spot === 'home') {
    return [
      {
        id: 'gen:home',
        title: 'まとまった作業に使う',
        reason: `${base} — 「やること」に登録しておくとここに具体名が出ます`,
        minutes: gap.minutes,
        source: 'generic',
        score: 10,
      },
    ]
  }
  return [
    {
      id: 'gen:out',
      title: '外でできることに使う',
      reason: `${base} — 趣味を登録しておくとここに候補が出ます`,
      minutes: gap.minutes,
      source: 'generic',
      score: 10,
    },
  ]
}
