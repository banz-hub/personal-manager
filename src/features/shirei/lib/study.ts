/**
 * 前の版の学習項目（StudyNode）を読むための道具。
 *
 * 習熟度・優先度・試験からの逆算はやめて、学習はタスクとして持つようにした（2026-09-19）。
 * 残っているのは、前の版で付けた学習記録（StudySession）を、ふりかえり・検索で読むための 3 つだけ。
 */

import type { StudyNode, TaskArea } from '../types'

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
