/**
 * 大きなタスクを手順に割る。
 *
 * 「A社のESを書く」のまま置いておくと、いつまでも手がつかない。
 * かといって **勝手に細かくしすぎない** (第 7 条)。
 * ひな形は候補として出すだけで、選んだものだけが実際のタスクになる。
 */

import type { Importance, Task, TaskArea } from '../types'
import { addDays } from './date'
import { newId } from './id'

export interface StepDraft {
  title: string
  /** 全体の見積もりに対する割合。合計が 1 になるようにしてある */
  share: number
  importance: Importance
}

export interface Template {
  id: string
  label: string
  /** どの分野で出すか。空なら全部で出す */
  areas: TaskArea[]
  /** 題名にこれが含まれていたら先に勧める */
  hints: RegExp
  steps: StepDraft[]
}

/**
 * ひな形。どれも「最後に見直す」で終わるようにしてある。
 * 出して終わりにすると、直す時間が無いまま提出することになるため。
 */
export const TEMPLATES: Template[] = [
  {
    id: 'report',
    label: 'レポート・課題',
    areas: ['math', 'teaching', 'other'],
    hints: /レポート|課題|論文|作文|感想文/,
    steps: [
      { title: '何を書くか決める', share: 0.1, importance: 3 },
      { title: '資料を集める', share: 0.2, importance: 2 },
      { title: '構成を決める', share: 0.15, importance: 3 },
      { title: '本文を書く', share: 0.35, importance: 3 },
      { title: '読み直して直す', share: 0.15, importance: 2 },
      { title: '提出', share: 0.05, importance: 3 },
    ],
  },
  {
    id: 'exam',
    label: '試験勉強',
    areas: ['math', 'teaching', 'cert', 'english'],
    hints: /試験|テスト|期末|中間|検定|受験/,
    steps: [
      { title: '範囲を確認する', share: 0.05, importance: 3 },
      { title: '教科書・資料を通す', share: 0.3, importance: 2 },
      { title: '演習を解く', share: 0.35, importance: 3 },
      { title: '間違えたところを直す', share: 0.2, importance: 3 },
      { title: '前日に総復習', share: 0.1, importance: 2 },
    ],
  },
  {
    id: 'presentation',
    label: '発表・プレゼン',
    areas: ['math', 'teaching', 'jobhunt', 'other'],
    hints: /発表|プレゼン|報告|ゼミ|模擬授業|指導案/,
    steps: [
      { title: '伝えたいことを1つ決める', share: 0.1, importance: 3 },
      { title: '構成を作る', share: 0.2, importance: 3 },
      { title: '資料を作る', share: 0.35, importance: 2 },
      { title: '話す練習をする', share: 0.25, importance: 3 },
      { title: '時間を計って通す', share: 0.1, importance: 2 },
    ],
  },
  {
    id: 'es',
    label: 'ES・エントリーシート',
    areas: ['jobhunt'],
    hints: /ES|エントリーシート|履歴書|志望動機|ガクチカ/i,
    steps: [
      { title: '企業研究', share: 0.2, importance: 2 },
      { title: '求める人物像の確認', share: 0.1, importance: 2 },
      { title: 'ガクチカの選定', share: 0.15, importance: 3 },
      { title: '志望動機の作成', share: 0.25, importance: 3 },
      { title: '文章を直す', share: 0.2, importance: 2 },
      { title: '最終確認して提出', share: 0.1, importance: 3 },
    ],
  },
  {
    id: 'reading',
    label: '本を読む',
    areas: ['english', 'cert', 'other', 'life'],
    hints: /読む|読破|参考書|問題集|テキスト/,
    steps: [
      { title: '目次を見て範囲を決める', share: 0.05, importance: 2 },
      { title: '前半を読む', share: 0.35, importance: 2 },
      { title: '後半を読む', share: 0.35, importance: 2 },
      { title: '要点をまとめる', share: 0.25, importance: 2 },
    ],
  },
]

/** 題名と分野から、勧める順にひな形を並べる */
export function suggestTemplates(title: string, area: TaskArea): Template[] {
  const scored = TEMPLATES.map((t) => {
    let score = 0
    if (t.hints.test(title)) score += 10
    if (t.areas.length === 0 || t.areas.includes(area)) score += 3
    return { t, score }
  })
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t)
}

/**
 * 均等に割るだけのひな形。
 * どのひな形にも当てはまらないときや、単に長すぎるときに使う。
 */
export function evenSteps(count: number): StepDraft[] {
  const n = Math.max(2, Math.min(10, count))
  return Array.from({ length: n }, (_, i) => ({
    title: `${i + 1}回目`,
    share: 1 / n,
    importance: 2 as Importance,
  }))
}

/** 自由に書いた手順（1行1つ）を、均等配分のひな形にする */
export function stepsFromText(text: string): StepDraft[] {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^\s*[-・*\d.]+\s*/, '').trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return []
  return lines.map((title) => ({ title, share: 1 / lines.length, importance: 2 as Importance }))
}

export interface DecomposeResult {
  /** 分解して出来た子タスク */
  children: Task[]
  /** 親タスク。子に任せるので、自分は「まとめ」として残す */
  parent: Task
}

/** 5 分単位に丸める。1 分刻みの予定は守れない */
function round5(min: number): number {
  return Math.max(5, Math.round(min / 5) * 5)
}

/**
 * 親タスクを手順に割る。
 *
 * 見積もりは割合で配り、締切は最後の手順を親の締切に合わせて 1 日ずつ前へずらす。
 * 「提出日に全部やる」形にならないようにするため。
 */
export function decompose(parent: Task, steps: StepDraft[], now: string): DecomposeResult {
  const total = steps.reduce((sum, s) => sum + s.share, 0) || 1
  const last = steps.length - 1

  const children = steps.map((s, i) => {
    // 最後が親の締切。手前は 1 日ずつ前倒し
    const dueDate = parent.dueDate ? addDays(parent.dueDate, -(last - i)) : undefined
    return {
      id: newId('task'),
      title: `${parent.title} — ${s.title}`,
      area: parent.area,
      status: 'todo' as const,
      dueDate,
      // 締切の時刻は最後の手順にだけ引き継ぐ (途中の手順に時刻は要らない)
      dueTime: i === last ? parent.dueTime : undefined,
      estimateMin: round5((parent.estimateMin * s.share) / total),
      importance: s.importance,
      parentId: parent.id,
      companyId: parent.companyId,
      createdAt: now,
    }
  })

  return {
    children,
    // 親は残すが、時間は子が持つので 0 にはせず「まとめ」として最小にしておく。
    // 消してしまうと、何をまとめていたのか分からなくなる
    parent: { ...parent, estimateMin: 5, note: [parent.note, '手順に分解済み'].filter(Boolean).join('\n') },
  }
}

/** 親タスクの進み具合 */
export function childProgress(parent: Task, all: Task[]): { done: number; total: number } {
  const children = all.filter((t) => t.parentId === parent.id)
  return {
    done: children.filter((c) => c.status === 'done').length,
    total: children.length,
  }
}
