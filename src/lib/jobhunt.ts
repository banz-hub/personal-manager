/**
 * 就活 OS の判断部分。
 *
 * 就活の締切はこちらの都合で動かせないので、見落としが致命傷になる。
 * だから「近い順に並べる」だけでなく、**期限切れを別に出す**ことを最優先にしてある。
 *
 * 企業比較では、調べた事実 (facts) と自分の見立て (ratings) を必ず分けて扱う。
 * 混ぜると、あとで見返したときにどちらだったのか分からなくなる。
 */

import type {
  Company,
  Importance,
  SelectionEvent,
  SelectionKind,
  SelectionStage,
  Task,
} from '../types'
import { ACTIVE_STAGES, CLOSED_STAGES, SELECTION_KIND_LABELS, STAGE_LABELS } from '../types'
import { daysBetween, dueMinutes, formatDate } from './date'
import { newId } from './id'

// ---------- 締切の検出 ----------

/** 締切の近さ。画面の色分けと並び順に使う */
export type Urgency = 'overdue' | 'today' | 'tomorrow' | 'soon' | 'later'

export const URGENCY_LABELS: Record<Urgency, string> = {
  overdue: '期限切れ',
  today: '今日',
  tomorrow: '明日',
  soon: '3日以内',
  later: 'この先',
}

export const URGENCY_ORDER: Urgency[] = ['overdue', 'today', 'tomorrow', 'soon', 'later']

export interface DatedSelection {
  event: SelectionEvent
  company: Company | undefined
  urgency: Urgency
  /** 何日後か。今日は 0、過ぎていれば負 */
  daysLeft: number
  label: string
}

export function urgencyOf(daysLeft: number): Urgency {
  if (daysLeft < 0) return 'overdue'
  if (daysLeft === 0) return 'today'
  if (daysLeft === 1) return 'tomorrow'
  if (daysLeft <= 3) return 'soon'
  return 'later'
}

/**
 * 選考の予定を締切の近い順に並べる。
 * 済んだものは外す。期限切れは別のグループとして残す (消すと気づけなくなる)。
 */
export function upcomingSelections(
  events: SelectionEvent[],
  companies: Company[],
  today: string,
  limit?: number,
): DatedSelection[] {
  const byId = new Map(companies.map((c) => [c.id, c]))
  const out = events
    .filter((e) => !e.doneAt)
    .map((event) => {
      const daysLeft = daysBetween(today, event.date)
      const company = byId.get(event.companyId)
      return {
        event,
        company,
        daysLeft,
        urgency: urgencyOf(daysLeft),
        label: `${company?.name ?? '企業未設定'} ${SELECTION_KIND_LABELS[event.kind]}`,
      }
    })
    .sort((a, b) => a.daysLeft - b.daysLeft || (a.event.time ?? '').localeCompare(b.event.time ?? ''))

  return limit != null ? out.slice(0, limit) : out
}

export function groupByUrgency(list: DatedSelection[]): Record<Urgency, DatedSelection[]> {
  const out: Record<Urgency, DatedSelection[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    soon: [],
    later: [],
  }
  for (const d of list) out[d.urgency].push(d)
  return out
}

// ---------- 次にやること ----------

/**
 * その企業の「次にやること」。
 * 選考段階から機械的に決まるので、ここは推測ではなく決まりごと。
 */
export function nextActionFor(company: Company): string | null {
  if (CLOSED_STAGES.includes(company.stage)) return null
  switch (company.stage) {
    case 'none':
      return '企業研究を始める'
    case 'research':
      return '求める人物像を確認して、ESの下書きに入る'
    case 'es-draft':
      return 'ESを仕上げて提出する'
    case 'es-sent':
      return '説明会や適性検査の日程を確認する'
    case 'briefing':
      return '説明会で聞いたことをメモに残し、志望動機に反映する'
    case 'test':
      return '適性検査の対策をする'
    case 'interview1':
    case 'interview2':
    case 'interview-final':
      return '想定質問・志望動機・ガクチカを見直して模擬面接をする'
    default:
      return null
  }
}

/** 選考が動いている企業だけ */
export function activeCompanies(companies: Company[]): Company[] {
  return companies.filter((c) => ACTIVE_STAGES.includes(c.stage))
}

// ---------- タスクの下書き ----------

export interface TaskDraft {
  title: string
  estimateMin: number
  importance: Importance
  /** 締切からの逆算で決まる日。無ければ締切なし */
  dueDate?: string
}

/**
 * 応募したときに要る作業の並び。
 *
 * **勝手に登録はしない。**候補として出して、ユーザーが選んだものだけタスクにする。
 * 全部が全部いつも必要なわけではないので、押しつけない (第 7 条・第 13 条)。
 */
export function applicationTaskDrafts(dueDate?: string): TaskDraft[] {
  return [
    { title: '企業研究', estimateMin: 60, importance: 2, dueDate: shift(dueDate, -7) },
    { title: '求める人物像の確認', estimateMin: 30, importance: 2, dueDate: shift(dueDate, -6) },
    { title: 'ガクチカの選定', estimateMin: 45, importance: 3, dueDate: shift(dueDate, -5) },
    { title: '志望動機の作成', estimateMin: 60, importance: 3, dueDate: shift(dueDate, -4) },
    { title: 'ESの文章を直す', estimateMin: 45, importance: 2, dueDate: shift(dueDate, -2) },
    { title: 'ESの最終確認', estimateMin: 20, importance: 3, dueDate: shift(dueDate, -1) },
    { title: 'ESを提出', estimateMin: 15, importance: 3, dueDate },
  ]
}

/** 面接が決まったときに要る作業の並び */
export function interviewTaskDrafts(dueDate?: string): TaskDraft[] {
  return [
    { title: '企業研究の見直し', estimateMin: 45, importance: 3, dueDate: shift(dueDate, -3) },
    { title: '想定質問の準備', estimateMin: 60, importance: 3, dueDate: shift(dueDate, -3) },
    { title: '志望動機の確認', estimateMin: 30, importance: 3, dueDate: shift(dueDate, -2) },
    { title: 'ガクチカの確認', estimateMin: 30, importance: 2, dueDate: shift(dueDate, -2) },
    { title: '模擬面接', estimateMin: 60, importance: 2, dueDate: shift(dueDate, -1) },
  ]
}

export function draftsFor(kind: SelectionKind, dueDate?: string): TaskDraft[] {
  if (kind === 'interview') return interviewTaskDrafts(dueDate)
  if (kind === 'es') return applicationTaskDrafts(dueDate)
  return []
}

/**
 * 締切から日数を引く。
 * 引いた結果が今日より前になっても、そのまま返す (もう遅れていることが分かるほうがよい)。
 */
function shift(dueDate: string | undefined, days: number): string | undefined {
  if (!dueDate) return undefined
  const d = new Date(dueDate)
  d.setDate(d.getDate() + days)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

/** 下書きを実際のタスクにする */
export function taskFromDraft(draft: TaskDraft, company: Company, now: string): Task {
  return {
    id: newId('task'),
    title: `${company.name} ${draft.title}`,
    area: 'jobhunt',
    status: 'todo',
    dueDate: draft.dueDate,
    estimateMin: draft.estimateMin,
    importance: draft.importance,
    companyId: company.id,
    createdAt: now,
  }
}

// ---------- 企業比較 ----------

export interface ComparisonRow {
  company: Company
  /** 事実だけから出せる並び順の材料。無い項目は null */
  facts: {
    salaryManYen: number | null
    holidaysPerYear: number | null
    overtimeHoursPerMonth: number | null
    turnoverRate: number | null
  }
  /** 自分の見立ての平均。付けていなければ null */
  ratingAverage: number | null
  interest: number
}

export function buildComparison(companies: Company[]): ComparisonRow[] {
  return companies.map((company) => {
    const values = Object.values(company.ratings).filter(
      (v): v is number => typeof v === 'number',
    )
    return {
      company,
      facts: {
        salaryManYen: company.facts.salaryManYen ?? null,
        holidaysPerYear: company.facts.holidaysPerYear ?? null,
        overtimeHoursPerMonth: company.facts.overtimeHoursPerMonth ?? null,
        turnoverRate: company.facts.turnoverRate ?? null,
      },
      ratingAverage:
        values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null,
      interest: company.interest,
    }
  })
}

/**
 * 比較を並べ替える。
 * **事実で並べるか、見立てで並べるかを必ず選ばせる。**
 * 両方を混ぜた総合点は出さない。混ぜた瞬間、どちらが効いたのか説明できなくなる。
 */
export type SortKey =
  | 'interest'
  | 'ratingAverage'
  | 'salaryManYen'
  | 'holidaysPerYear'
  | 'overtimeHoursPerMonth'
  | 'turnoverRate'

export const SORT_LABELS: Record<SortKey, string> = {
  interest: '志望度（自分の気持ち）',
  ratingAverage: '見立ての平均（自分の評価）',
  salaryManYen: '年収（事実）',
  holidaysPerYear: '年間休日（事実）',
  overtimeHoursPerMonth: '残業時間（事実・少ない順）',
  turnoverRate: '離職率（事実・少ない順）',
}

/** 小さいほうが良い項目 */
const LOWER_IS_BETTER: SortKey[] = ['overtimeHoursPerMonth', 'turnoverRate']

export function sortComparison(rows: ComparisonRow[], key: SortKey): ComparisonRow[] {
  const valueOf = (r: ComparisonRow): number | null => {
    if (key === 'interest') return r.interest
    if (key === 'ratingAverage') return r.ratingAverage
    return r.facts[key]
  }
  const asc = LOWER_IS_BETTER.includes(key)

  return [...rows].sort((a, b) => {
    const av = valueOf(a)
    const bv = valueOf(b)
    // 値が無いものは常に後ろ。「0」と「未記入」を混同しないため
    if (av === null && bv === null) return a.company.name.localeCompare(b.company.name)
    if (av === null) return 1
    if (bv === null) return -1
    if (av === bv) return a.company.name.localeCompare(b.company.name)
    return asc ? av - bv : bv - av
  })
}

// ---------- 今日の状況への持ち込み ----------

/**
 * 選考の予定を、優先順位の材料になる「締切のあるタスク」として見たときの説明。
 * 実際のタスクは別に作るが、まだ作っていないものも今日の画面で見せたいので使う。
 */
export function selectionSummary(d: DatedSelection): string {
  const when =
    d.daysLeft < 0
      ? `${-d.daysLeft}日前に過ぎている`
      : d.daysLeft === 0
        ? '今日'
        : `あと${d.daysLeft}日`
  const time = d.event.time ? ` ${d.event.time}` : ''
  return `${d.label}（${formatDate(d.event.date)}${time}・${when}）`
}

/** 選考の予定の締切を分に直す。締切時刻が無ければその日いっぱい */
export function selectionDueMinutes(event: SelectionEvent): number {
  return dueMinutes(event.time)
}

export function stageLabel(stage: SelectionStage): string {
  return STAGE_LABELS[stage]
}
