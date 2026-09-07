/**
 * 横断の検索。
 *
 * タスク・学習項目・企業・選考の予定を、ひとつの検索欄から探せるようにする。
 * 数が増えてくると「どこに入れたか」を思い出せなくなるため。
 *
 * 手の込んだ検索はしない。ひらがな・カタカナの揺れと大文字小文字だけそろえて、
 * 部分一致で拾う。それ以上は、探すより一覧を見たほうが早い。
 */

import type { Company, SelectionEvent, StudyNode, Task } from '../types'
import { AREA_LABELS, MASTERY_LABELS, SELECTION_KIND_LABELS, STAGE_LABELS } from '../types'
import { pathLabel } from './study'

export type HitKind = 'task' | 'node' | 'company' | 'selection'

export interface Hit {
  kind: HitKind
  id: string
  title: string
  /** どこにあるものかの補足 */
  detail: string
  /** 開くべき画面 */
  to: string
  /** 上に出すほど大きい */
  score: number
}

export const HIT_LABELS: Record<HitKind, string> = {
  task: 'タスク',
  node: '学習',
  company: '企業',
  selection: '選考の予定',
}

/**
 * カタカナをひらがなに寄せ、大文字小文字と全角半角の差を消す。
 * 「ITパスポート」と「ｉｔぱすぽーと」を同じものとして扱うため。
 */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .trim()
}

function match(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(needle)
}

export interface SearchInput {
  query: string
  tasks: Task[]
  nodes: StudyNode[]
  companies: Company[]
  selections: SelectionEvent[]
  limit?: number
}

export function search(input: SearchInput): Hit[] {
  const q = normalize(input.query)
  if (q.length === 0) return []

  const out: Hit[] = []

  for (const t of input.tasks) {
    if (!match(t.title, q) && !match(t.note ?? '', q)) continue
    const open = t.status === 'todo' || t.status === 'doing'
    out.push({
      kind: 'task',
      id: t.id,
      title: t.title,
      detail: [
        AREA_LABELS[t.area],
        t.dueDate ? `締切 ${t.dueDate}` : null,
        open ? null : '完了',
      ]
        .filter(Boolean)
        .join(' / '),
      to: '/tasks',
      // 題名に当たったもの、まだ終わっていないものを上に
      score: (match(t.title, q) ? 20 : 5) + (open ? 10 : 0),
    })
  }

  for (const n of input.nodes) {
    if (!match(n.title, q) && !match(n.note ?? '', q)) continue
    const path = pathLabel(input.nodes, n.id)
    out.push({
      kind: 'node',
      id: n.id,
      title: n.title,
      detail: [path, MASTERY_LABELS[n.mastery ?? 'new']].filter(Boolean).join(' / '),
      to: '/study',
      score: match(n.title, q) ? 18 : 5,
    })
  }

  for (const c of input.companies) {
    const hay = [c.name, c.industry, c.role, c.memo].filter(Boolean).join(' ')
    if (!match(hay, q)) continue
    out.push({
      kind: 'company',
      id: c.id,
      title: c.name,
      detail: [STAGE_LABELS[c.stage], c.industry, `志望度 ${c.interest}`].filter(Boolean).join(' / '),
      to: '/job',
      score: match(c.name, q) ? 18 : 5,
    })
  }

  const companyById = new Map(input.companies.map((c) => [c.id, c]))
  for (const e of input.selections) {
    const company = companyById.get(e.companyId)
    const hay = [e.title, e.note, e.place, company?.name].filter(Boolean).join(' ')
    if (!match(hay, q)) continue
    out.push({
      kind: 'selection',
      id: e.id,
      title: `${company?.name ?? '企業未設定'} ${SELECTION_KIND_LABELS[e.kind]}`,
      detail: [e.date, e.time, e.place].filter(Boolean).join(' '),
      to: '/job',
      score: 15,
    })
  }

  return out
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, input.limit ?? 30)
}

export function groupHits(hits: Hit[]): Array<[HitKind, Hit[]]> {
  const order: HitKind[] = ['task', 'node', 'company', 'selection']
  return order
    .map((k) => [k, hits.filter((h) => h.kind === k)] as [HitKind, Hit[]])
    .filter(([, list]) => list.length > 0)
}
