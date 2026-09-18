/**
 * 学習のタスク。学習は「学習」の印が付いたタスクとして持ち、タイマーの記録で時間を残す。
 *
 * 習熟度・優先度・試験からの逆算はやめた（2026-09-19、本人の判断）。
 * 何をやるかは、この一覧から自分で今日のリストに入れて決める。
 */

import type { StudyNode, StudySession, Task, TaskArea, TaskLog } from '../types'
import { newId } from './id'

export function newStudyTask(title: string, area: TaskArea, nowIso: string): Task {
  return {
    id: newId('task'),
    title: title.trim(),
    area,
    status: 'todo',
    // 1 回の長さはタイマーの長さで決まるので、ここは目安の 30 分だけ
    estimateMin: 30,
    importance: 2,
    recurring: true,
    study: true,
    createdAt: nowIso,
  }
}

/**
 * 前の版の学習項目を、学習のタスクに移す。
 * 子を持つ項目（科目・単元）はまとめ役なので移さず、実際に勉強する単位（葉）だけを移す。
 * 分野は親をたどって受け継ぐ。
 */
export function nodesToTasks(nodes: StudyNode[], nowIso: string): Task[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const hasChild = new Set(nodes.map((n) => n.parentId).filter(Boolean))
  const areaOf = (n: StudyNode): TaskArea => {
    let cur: StudyNode | undefined = n
    for (let i = 0; cur && i < 20; i++) {
      if (cur.area) return cur.area
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return 'other'
  }
  return [...nodes]
    .filter((n) => !hasChild.has(n.id))
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
    .map((n) => ({
      ...newStudyTask(n.title, areaOf(n), nowIso),
      ...(n.note ? { note: n.note } : {}),
    }))
}

/** 移したあとに消してよい学習項目。記録（StudySession）が付いているものは残す */
export function removableNodes(nodes: StudyNode[], sessions: StudySession[]): StudyNode[] {
  const used = new Set(sessions.map((s) => s.nodeId))
  return nodes.filter((n) => !used.has(n.id))
}

export interface StudyTotal {
  minutes: number
  /** 最後にやった日 (YYYY-MM-DD) */
  lastDate?: string
}

/** 学習のタスクごとの累計時間と最後にやった日。タイマーで測った記録から出す */
export function studyTotals(tasks: Task[], logs: TaskLog[]): Map<string, StudyTotal> {
  const ids = new Set(tasks.filter((t) => t.study).map((t) => t.id))
  const out = new Map<string, StudyTotal>()
  for (const l of logs) {
    if (!ids.has(l.taskId)) continue
    const cur = out.get(l.taskId) ?? { minutes: 0 }
    cur.minutes += l.actualMin
    if (!cur.lastDate || l.date > cur.lastDate) cur.lastDate = l.date
    out.set(l.taskId, cur)
  }
  return out
}
