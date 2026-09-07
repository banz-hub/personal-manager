/**
 * 学習 OS の判断部分。
 *
 * 進捗 (最終学習日・学習時間・復習回数・正答率) は記録から毎回集計して出す。
 * ノードに書き戻さないのは、記録と表示が食い違ったときに直せなくなるため。
 *
 * 優先順位は priority.ts と同じ方針で、決定論的に出して理由を必ず言葉で返す。
 */

import type { Exam, Importance, Mastery, StudyNode, StudySession, TaskArea } from '../types'
import {
  MASTERY_LABELS,
  MASTERY_REMAINING,
  REVIEW_INTERVAL_DAYS,
} from '../types'
import { addDays, daysBetween, formatDuration } from './date'

// ---------- 木をたどる ----------

export function childrenOf(nodes: StudyNode[], parentId?: string): StudyNode[] {
  return nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
}

export function rootsOf(nodes: StudyNode[]): StudyNode[] {
  return childrenOf(nodes, undefined)
}

export function isLeaf(nodes: StudyNode[], node: StudyNode): boolean {
  return !nodes.some((n) => n.parentId === node.id)
}

/** そのノードと配下すべて */
export function withDescendants(nodes: StudyNode[], rootId: string): StudyNode[] {
  const byParent = new Map<string | undefined, StudyNode[]>()
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? []
    list.push(n)
    byParent.set(n.parentId, list)
  }
  const out: StudyNode[] = []
  const stack = [rootId]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const id = stack.pop() as string
    // 親子の指定が壊れて輪になっていても止まるようにする
    if (seen.has(id)) continue
    seen.add(id)
    const node = nodes.find((n) => n.id === id)
    if (node) out.push(node)
    for (const child of byParent.get(id) ?? []) stack.push(child.id)
  }
  return out
}

/** 配下の葉 (実際に勉強する単位) */
export function leavesOf(nodes: StudyNode[], rootId: string): StudyNode[] {
  return withDescendants(nodes, rootId).filter((n) => isLeaf(nodes, n))
}

/** 全体の葉 */
export function allLeaves(nodes: StudyNode[]): StudyNode[] {
  return nodes.filter((n) => isLeaf(nodes, n))
}

/** ルートまでの道すじ (上から順) */
export function pathOf(nodes: StudyNode[], nodeId: string): StudyNode[] {
  const out: StudyNode[] = []
  const seen = new Set<string>()
  let current = nodes.find((n) => n.id === nodeId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    out.unshift(current)
    current = current.parentId ? nodes.find((n) => n.id === current!.parentId) : undefined
  }
  return out
}

/** 「数学 / 位相空間論」のような、その項目がどこにあるかの表示 */
export function pathLabel(nodes: StudyNode[], nodeId: string): string {
  return pathOf(nodes, nodeId)
    .slice(0, -1)
    .map((n) => n.title)
    .join(' / ')
}

/** 分野は科目 (ルート) が持つ。子は親をたどって受け継ぐ */
export function areaOf(nodes: StudyNode[], nodeId: string): TaskArea {
  const path = pathOf(nodes, nodeId)
  return path[0]?.area ?? 'other'
}

// ---------- 進捗 ----------

export interface NodeProgress {
  nodeId: string
  /** YYYY-MM-DD。一度もやっていなければ無し */
  lastStudiedOn?: string
  totalMin: number
  sessionCount: number
  /** 復習した回数 = 2 回目以降 */
  reviewCount: number
  correct: number
  attempted: number
  /** 0〜1。問題を解いていなければ null */
  accuracy: number | null
  /** 次に復習する日。理解度と最終学習日から出す */
  nextReviewOn?: string
  /** 何日やっていないか。一度もやっていなければ null */
  staleDays: number | null
}

const EMPTY_PROGRESS = (nodeId: string): NodeProgress => ({
  nodeId,
  totalMin: 0,
  sessionCount: 0,
  reviewCount: 0,
  correct: 0,
  attempted: 0,
  accuracy: null,
  staleDays: null,
})

/**
 * ノードごとの進捗。親には配下の記録がすべて合算される。
 * (単元を見たときに、その中の項目の学習時間が合計で見えるようにするため)
 */
export function buildProgress(
  nodes: StudyNode[],
  sessions: StudySession[],
  today: string,
): Map<string, NodeProgress> {
  const byNode = new Map<string, StudySession[]>()
  for (const s of sessions) {
    const list = byNode.get(s.nodeId) ?? []
    list.push(s)
    byNode.set(s.nodeId, list)
  }

  const out = new Map<string, NodeProgress>()
  for (const node of nodes) {
    const own = withDescendants(nodes, node.id).flatMap((n) => byNode.get(n.id) ?? [])
    out.set(node.id, summarize(node, own, nodes, today))
  }
  return out
}

function summarize(
  node: StudyNode,
  sessions: StudySession[],
  nodes: StudyNode[],
  today: string,
): NodeProgress {
  const p = EMPTY_PROGRESS(node.id)
  if (sessions.length === 0) {
    // まだ一度もやっていなくても、次にやるべき日は「今日」として扱わない。
    // 未学習は復習ではなく初回学習なので、間隔の考え方が違う
    return p
  }

  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date))
  p.sessionCount = sorted.length
  p.totalMin = sorted.reduce((sum, s) => sum + s.minutes, 0)
  p.lastStudiedOn = sorted[sorted.length - 1].date
  p.staleDays = daysBetween(p.lastStudiedOn, today)

  // 同じ日に何回やっても 1 回とは数えず、記録の件数で数える (2 回目以降が復習)
  p.reviewCount = Math.max(0, sorted.length - 1)

  for (const s of sorted) {
    p.correct += s.correct ?? 0
    p.attempted += s.attempted ?? 0
  }
  p.accuracy = p.attempted > 0 ? p.correct / p.attempted : null

  // 復習の予定日は、葉のときだけ意味を持つ (親は集まりなので間隔を持たない)
  if (isLeaf(nodes, node)) {
    const interval = REVIEW_INTERVAL_DAYS[node.mastery ?? 'new']
    if (interval != null) p.nextReviewOn = addDays(p.lastStudiedOn, interval)
  }

  return p
}

/** 復習の予定日を過ぎているか */
export function isReviewDue(progress: NodeProgress, today: string): boolean {
  return progress.nextReviewOn != null && progress.nextReviewOn <= today
}

// ---------- 理解度の集計 ----------

export interface MasterySummary {
  total: number
  counts: Record<Mastery, number>
  /** 0〜1。習得に近いほど 1 */
  progress: number
}

export function summarizeMastery(leaves: StudyNode[]): MasterySummary {
  const counts: Record<Mastery, number> = {
    new: 0,
    learning: 0,
    understood: 0,
    'needs-review': 0,
    mastered: 0,
  }
  let done = 0
  for (const leaf of leaves) {
    const m = leaf.mastery ?? 'new'
    counts[m] += 1
    // 「残りどれくらい手が要るか」の裏返しを、進み具合として使う
    done += 1 - MASTERY_REMAINING[m]
  }
  return {
    total: leaves.length,
    counts,
    progress: leaves.length > 0 ? done / leaves.length : 0,
  }
}

/**
 * しばらく手をつけていない項目。空いた日数の多い順に返す。
 * 経過日数は progress で計算済みなので、ここでは今日の日付を要らない。
 */
export function staleLeaves(
  nodes: StudyNode[],
  progress: Map<string, NodeProgress>,
  minDays = 7,
  limit = 5,
): StudyNode[] {
  return allLeaves(nodes)
    .filter((n) => (n.mastery ?? 'new') !== 'new' && (n.mastery ?? 'new') !== 'mastered')
    .map((n) => ({ node: n, stale: progress.get(n.id)?.staleDays ?? null }))
    .filter((x) => x.stale != null && x.stale >= minDays)
    .sort((a, b) => (b.stale as number) - (a.stale as number))
    .slice(0, limit)
    .map((x) => x.node)
}

// ---------- 試験からの逆算 ----------

/** これ以内なら「直前」とみなし、新しい範囲より弱点の復習を優先する */
export const REVIEW_PHASE_DAYS = 3

/**
 * 「今ぐらついている」ことを示す加点 (復習期日超過・放置日数・低正答率) の合計の上限。
 * これらは互いに強く相関するので、上限を外すと同じ事実の重複加算になる。
 */
export const ATTENTION_CAP = 45

export interface ExamPlan {
  exam: Exam
  /** 試験日まで何日。当日は 0、過ぎていれば負 */
  daysLeft: number
  leaves: StudyNode[]
  summary: MasterySummary
  /** まだ積む必要のある学習時間 (分) */
  requiredMin: number
  /** 1 日あたり必要な時間 (分)。当日以降は残り全部 */
  perDayMin: number
  /** 直近の実績から見た 1 日あたりの学習時間 (分) */
  recentPerDayMin: number
  /** 直前なので弱点復習を優先する段階か */
  reviewPhase: boolean
  findings: string[]
}

/** 直近 days 日の 1 日あたり学習時間 */
export function recentDailyStudyMin(
  sessions: StudySession[],
  today: string,
  days = 14,
): number {
  const from = addDays(today, -days + 1)
  const total = sessions
    .filter((s) => s.date >= from && s.date <= today)
    .reduce((sum, s) => sum + s.minutes, 0)
  return Math.round(total / days)
}

export function buildExamPlan(
  exam: Exam,
  nodes: StudyNode[],
  sessions: StudySession[],
  today: string,
): ExamPlan {
  const leafSet = new Map<string, StudyNode>()
  for (const rootId of exam.scopeNodeIds) {
    for (const leaf of leavesOf(nodes, rootId)) leafSet.set(leaf.id, leaf)
  }
  const leaves = [...leafSet.values()]
  const summary = summarizeMastery(leaves)

  const requiredMin = Math.round(
    leaves.reduce((sum, n) => sum + n.estimateMin * MASTERY_REMAINING[n.mastery ?? 'new'], 0),
  )
  const daysLeft = daysBetween(today, exam.date)
  // 当日と過ぎた分は割らずに残り全部として見せる (0 で割らないため、でもある)
  const perDayMin = daysLeft > 0 ? Math.round(requiredMin / daysLeft) : requiredMin
  const recentPerDayMin = recentDailyStudyMin(sessions, today)
  const reviewPhase = daysLeft >= 0 && daysLeft <= REVIEW_PHASE_DAYS

  return {
    exam,
    daysLeft,
    leaves,
    summary,
    requiredMin,
    perDayMin,
    recentPerDayMin,
    reviewPhase,
    findings: examFindings({
      exam,
      daysLeft,
      leaves,
      summary,
      requiredMin,
      perDayMin,
      recentPerDayMin,
      reviewPhase,
    }),
  }
}

function examFindings(p: Omit<ExamPlan, 'findings'>): string[] {
  const out: string[] = []

  if (p.leaves.length === 0) {
    out.push('試験範囲が未設定です。範囲にする科目や単元を選んでください。')
    return out
  }

  if (p.daysLeft < 0) {
    out.push(`試験日 (${p.exam.date}) を過ぎています。`)
    return out
  }

  if (p.requiredMin === 0) {
    out.push(`範囲${p.leaves.length}項目はすべて習得済みです。あとは維持だけで足ります。`)
    return out
  }

  out.push(
    `試験まであと${p.daysLeft}日。範囲${p.leaves.length}項目のうち習得は${p.summary.counts.mastered}項目で、` +
      `残り${formatDuration(p.requiredMin)}ぶんの学習が要ります。1日あたり${formatDuration(p.perDayMin)}です。`,
  )

  // 今のペースで足りるかを、実績と突き合わせて言う
  if (p.recentPerDayMin > 0 && p.perDayMin > p.recentPerDayMin * 1.3) {
    out.push(
      `直近2週間の実績は1日あたり${formatDuration(p.recentPerDayMin)}です。` +
        `このままだと間に合わないので、範囲を削るか、1日${formatDuration(p.perDayMin)}に増やす必要があります。`,
    )
  }

  if (p.reviewPhase) {
    out.push(
      `直前なので、新しい範囲を進めるより弱点の復習を優先します。` +
        `要復習が${p.summary.counts['needs-review']}項目、学習中が${p.summary.counts.learning}項目あります。`,
    )
    if (p.summary.counts.new > 0) {
      out.push(
        `未学習が${p.summary.counts.new}項目残っています。全部やろうとせず、重要度の高いものだけに絞ってください。`,
      )
    }
  }

  return out
}

/** 近い順の試験 (過ぎたものは除く) */
export function upcomingExams(exams: Exam[], today: string): Exam[] {
  return exams.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))
}

/** その項目が範囲に入っている試験のうち、いちばん近いもの */
export function nearestExamFor(
  nodeId: string,
  exams: Exam[],
  nodes: StudyNode[],
  today: string,
): Exam | undefined {
  return upcomingExams(exams, today).find((e) =>
    e.scopeNodeIds.some((rootId) => withDescendants(nodes, rootId).some((n) => n.id === nodeId)),
  )
}

// ---------- 学習の優先順位 ----------

export interface ScoredStudy {
  node: StudyNode
  /** 「数学 / 位相空間論」 */
  path: string
  area: TaskArea
  mastery: Mastery
  score: number
  reasons: string[]
  /** 今日この項目に充てる分数 */
  todayMin: number
  progress: NodeProgress
  exam?: Exam
  daysToExam: number | null
  reviewDue: boolean
}

export interface RankStudyInput {
  nodes: StudyNode[]
  exams: Exam[]
  sessions: StudySession[]
  today: string
  /** 1 回の学習の長さの上限 (分) */
  chunkMin: number
}

/** 理解度からの点。要復習がいちばん高いのは、忘れかけを放置するのが最も損だから */
function masteryScore(m: Mastery): [number, string | null] {
  switch (m) {
    case 'needs-review':
      return [45, '要復習になっている']
    case 'new':
      return [30, 'まだ未学習']
    case 'learning':
      return [25, '学習中で途中']
    case 'understood':
      return [10, null]
    case 'mastered':
      return [-20, '習得済み']
  }
}

function examScore(daysLeft: number | null): [number, string | null] {
  if (daysLeft === null) return [0, null]
  if (daysLeft < 0) return [0, null]
  if (daysLeft <= 3) return [100, `試験まであと${daysLeft}日`]
  if (daysLeft <= 7) return [60, `試験まであと${daysLeft}日`]
  if (daysLeft <= 14) return [35, '試験まで2週間を切っている']
  if (daysLeft <= 30) return [18, '試験が1か月以内にある']
  return [6, null]
}

function remainingMinutes(node: StudyNode): number {
  return node.estimateMin * MASTERY_REMAINING[node.mastery ?? 'new']
}

export function scoreStudyNode(
  node: StudyNode,
  input: RankStudyInput,
  progress: Map<string, NodeProgress>,
): ScoredStudy {
  const { nodes, exams, today, chunkMin } = input
  const mastery = node.mastery ?? 'new'
  const p = progress.get(node.id) ?? EMPTY_PROGRESS(node.id)
  const exam = nearestExamFor(node.id, exams, nodes, today)
  const daysToExam = exam ? daysBetween(today, exam.date) : null

  const reasons: string[] = []
  let score = 0

  const [eScore, eReason] = examScore(daysToExam)
  score += eScore
  if (eReason) reasons.push(eReason)
  if (exam) score += 15

  const [mScore, mReason] = masteryScore(mastery)
  score += mScore
  if (mReason) reasons.push(mReason)

  score += node.importance * 18
  if (node.importance === 3) reasons.push('重要な範囲')

  /*
   * 「復習の予定日を過ぎている」「◯日やっていない」「正答率が低い」は、どれも
   * 「この項目は今ぐらついている」という同じ 1 つのことを別の角度から見ているだけで、
   * たいてい同時に立つ。そのまま足すと同じ事実を三重に数えることになり、
   * 学習項目がタスクを不当に押しのける。だから合計に上限をおく。
   */
  let attention = 0

  const reviewDue = isReviewDue(p, today)
  if (reviewDue) {
    attention += 35
    reasons.push('復習の予定日を過ぎている')
  }

  if (p.staleDays != null && p.staleDays >= 3) {
    attention += Math.min(p.staleDays * 2, 20)
    reasons.push(`${p.staleDays}日やっていない`)
  }

  // 正答率は、数をこなしてからでないと当てにならない
  if (p.accuracy != null && p.attempted >= 5 && p.accuracy < 0.6) {
    attention += 25
    reasons.push(`正答率${Math.round(p.accuracy * 100)}%`)
  }

  score += Math.min(attention, ATTENTION_CAP)

  // 試験直前は、新しい範囲を広げるより手の届く弱点を固める
  const reviewPhase = daysToExam != null && daysToExam >= 0 && daysToExam <= REVIEW_PHASE_DAYS
  if (reviewPhase && mastery === 'new') {
    score -= 25
    reasons.push('試験直前なので、新しい範囲より復習を優先する')
  }

  const remaining = remainingMinutes(node)
  const todayMin = Math.max(10, Math.round(Math.min(remaining, chunkMin) / 5) * 5)

  return {
    node,
    path: pathLabel(nodes, node.id),
    area: areaOf(nodes, node.id),
    mastery,
    score,
    reasons,
    todayMin,
    progress: p,
    exam,
    daysToExam,
    reviewDue,
  }
}

/**
 * 今日やるべき学習項目を順に並べる。
 * 習得済みで復習の日でもないものは、今日やる候補から外す。
 */
export function rankStudy(input: RankStudyInput): ScoredStudy[] {
  const progress = buildProgress(input.nodes, input.sessions, input.today)
  return allLeaves(input.nodes)
    .map((node) => scoreStudyNode(node, input, progress))
    .filter((s) => s.mastery !== 'mastered' || s.reviewDue)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const ad = a.daysToExam ?? Number.MAX_SAFE_INTEGER
      const bd = b.daysToExam ?? Number.MAX_SAFE_INTEGER
      if (ad !== bd) return ad - bd
      return a.node.id.localeCompare(b.node.id)
    })
}

/** 「今日はここをやる」の一文 */
export function explainStudy(scored: ScoredStudy[]): string {
  const top = scored[0]
  if (!top) return '学習項目がありません。まず科目と単元を登録してください。'
  const why = top.reasons.slice(0, 2).join('、')
  const where = top.path ? `${top.path} の ` : ''
  return (
    `学習は${where}「${top.node.title}」から。` +
    (why ? `理由は${why}。` : '') +
    `目安は${formatDuration(top.todayMin)}。`
  )
}

/** 学習の記録を 1 件つけたときの、ノードの更新後の姿 */
export function applyStudySession(
  node: StudyNode,
  mastery: Mastery | undefined,
): StudyNode {
  // 手応えを入れなかったときは理解度を変えない (勝手に上げない)
  return mastery ? { ...node, mastery } : node
}

export function masteryLabel(m: Mastery | undefined): string {
  return MASTERY_LABELS[m ?? 'new']
}

export function importanceOf(node: StudyNode): Importance {
  return node.importance
}
