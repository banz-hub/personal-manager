/**
 * Claude の返した予定を取り込む。
 *
 * 「今日の状況をコピー」で外に持ち出して相談した結果を、貼り付けて戻せるようにする。
 * これで往復が閉じる。
 *
 * **書いてあることをそのまま作る。**題名からタスクを推測して勝手に紐づけたりはしない
 * (取り違えると、関係ないタスクの実績になってしまう)。
 * ただし題名が完全に一致するものがあれば、そこだけ紐づける。
 */

import type { DayPlan, PlanBlock, StudyNode, Task } from '../types'
import { fromMinutes, toMinutes } from './date'
import { newId } from './id'
import { hasOverlap } from './planedit'
import { normalize } from './search'

export interface ParsedLine {
  start: string
  end: string
  title: string
  /** 見つかったタスク・学習項目。無ければ紐づけない */
  taskId?: string
  nodeId?: string
  kind: 'task' | 'study'
}

export interface ImportResult {
  lines: ParsedLine[]
  /** 読み取れなかった行。そのまま見せて直してもらう */
  skipped: string[]
  /** 時間が重なっている行があるか */
  overlapping: boolean
}

/**
 * 「19:00〜20:00 数学課題」の形の行を拾う。
 * 箇条書きの記号、全角のコロンや波ダッシュ、いろいろな区切りを許す。
 */
const LINE = /^\s*[-*・]?\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*[〜~\-–—ー]\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*(.*)$/

export function parsePlanText(
  text: string,
  tasks: Task[],
  nodes: StudyNode[],
): ImportResult {
  const lines: ParsedLine[] = []
  const skipped: string[] = []

  // 題名が完全に一致するものだけ紐づける。あいまい一致で取り違えないため
  const taskByTitle = new Map(tasks.map((t) => [normalize(t.title), t]))
  const nodeByTitle = new Map(nodes.map((n) => [normalize(n.title), n]))

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue

    const m = line.match(LINE)
    if (!m) {
      // 見出しや説明文は黙って捨てる。時刻らしきものがある行だけ「読めなかった」に入れる
      if (/\d{1,2}\s*[:：]\s*\d{2}/.test(line)) skipped.push(line)
      continue
    }

    const [, sh, sm, eh, em, rest] = m
    const start = Number(sh) * 60 + Number(sm)
    const end = Number(eh) * 60 + Number(em)
    const title = rest.replace(/^[\s:：·・|｜]+/, '').trim()

    if (end <= start || start < 0 || end > 24 * 60 || title.length === 0) {
      skipped.push(line)
      continue
    }

    const key = normalize(title)
    const task = taskByTitle.get(key)
    const node = nodeByTitle.get(key)

    lines.push({
      start: fromMinutes(start),
      end: fromMinutes(end),
      title,
      taskId: task?.id,
      nodeId: task ? undefined : node?.id,
      kind: !task && node ? 'study' : 'task',
    })
  }

  const blocks = lines.map(toBlock)
  return { lines, skipped, overlapping: hasOverlap(blocks) }
}

function toBlock(line: ParsedLine): PlanBlock {
  return {
    id: newId('blk'),
    start: line.start,
    end: line.end,
    kind: line.kind,
    taskId: line.taskId,
    nodeId: line.nodeId,
    title: line.title,
    reason: 'Claude と相談して決めた予定',
  }
}

/**
 * 読み取った行から予定表を作る。
 * **完了済みのコマは残す。**実績を消してしまわないため。
 */
export function applyImport(existing: DayPlan | undefined, lines: ParsedLine[], date: string): DayPlan {
  const done = (existing?.blocks ?? []).filter((b) => b.doneAt)
  const added = lines.map(toBlock)

  // 完了済みと重なる行は落とす。過去の実績のほうが正しい
  const kept = added.filter(
    (a) =>
      !done.some(
        (d) => toMinutes(a.start) < toMinutes(d.end) && toMinutes(d.start) < toMinutes(a.end),
      ),
  )

  const blocks = [...done, ...kept].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))

  return {
    id: date,
    date,
    blocks,
    generatedAt: new Date().toISOString(),
    freeMin: existing?.freeMin ?? 0,
    fillRatio: existing?.fillRatio ?? 0,
    notes: ['Claude と相談した予定を取り込みました。'],
  }
}

/** 何件が既にあるものと結びついたか。取り込む前に見せる */
export function linkedCount(lines: ParsedLine[]): number {
  return lines.filter((l) => l.taskId || l.nodeId).length
}
