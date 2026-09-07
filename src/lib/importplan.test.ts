import { describe, expect, it } from 'vitest'
import type { DayPlan, StudyNode, Task } from '../types'
import { applyImport, linkedCount, parsePlanText } from './importplan'

const DATE = '2026-09-08'

const TASKS: Task[] = [
  { id: 't1', title: '数学課題', area: 'math', status: 'todo', estimateMin: 60, importance: 2, createdAt: '' },
]
const NODES: StudyNode[] = [
  { id: 'n1', title: '開集合', importance: 2, estimateMin: 60, order: 0, createdAt: '' },
]

describe('貼り付けた予定の読み取り', () => {
  it('19:00〜20:00 の形を読む', () => {
    const r = parsePlanText('19:00〜20:00 数学課題', TASKS, NODES)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toMatchObject({ start: '19:00', end: '20:00', title: '数学課題' })
  })

  it('箇条書きやハイフン区切りでも読む', () => {
    const r = parsePlanText('- 09:00-10:30 朝の勉強\n* 13:00–14:00 昼の作業', TASKS, NODES)
    expect(r.lines.map((l) => l.title)).toEqual(['朝の勉強', '昼の作業'])
  })

  it('全角のコロンでも読む', () => {
    expect(parsePlanText('０９：００〜１０：００ 何か', TASKS, NODES).lines).toHaveLength(0)
    expect(parsePlanText('09：00〜10：00 何か', TASKS, NODES).lines).toHaveLength(1)
  })

  it('題名が完全に一致するタスクだけ紐づける', () => {
    const r = parsePlanText('19:00〜20:00 数学課題\n20:00〜20:30 別のもの', TASKS, NODES)
    expect(r.lines[0].taskId).toBe('t1')
    expect(r.lines[1].taskId).toBeUndefined()
    expect(linkedCount(r.lines)).toBe(1)
  })

  it('学習項目にも紐づく', () => {
    const r = parsePlanText('19:00〜19:30 開集合', TASKS, NODES)
    expect(r.lines[0].nodeId).toBe('n1')
    expect(r.lines[0].kind).toBe('study')
  })

  it('見出しや説明の行は黙って捨てる', () => {
    const r = parsePlanText('# 今日の予定\nこんな感じでどうでしょう\n19:00〜20:00 数学課題', TASKS, NODES)
    expect(r.lines).toHaveLength(1)
    expect(r.skipped).toHaveLength(0)
  })

  it('時刻らしき行が読めなければ、そのまま見せる', () => {
    const r = parsePlanText('19:00 から 20:00 まで 数学', TASKS, NODES)
    expect(r.skipped).toHaveLength(1)
  })

  it('終わりが始まりより前の行は捨てる', () => {
    const r = parsePlanText('20:00〜19:00 逆さま', TASKS, NODES)
    expect(r.lines).toHaveLength(0)
    expect(r.skipped).toHaveLength(1)
  })

  it('題名の無い行は捨てる', () => {
    expect(parsePlanText('19:00〜20:00', TASKS, NODES).skipped).toHaveLength(1)
  })

  it('重なりがあれば知らせる', () => {
    const r = parsePlanText('19:00〜20:00 A\n19:30〜20:30 B', TASKS, NODES)
    expect(r.overlapping).toBe(true)
  })
})

describe('取り込み', () => {
  const existing: DayPlan = {
    id: DATE,
    date: DATE,
    blocks: [
      { id: 'done', start: '09:00', end: '10:00', kind: 'task', title: '済んだもの', doneAt: 'x', actualMin: 60 },
      { id: 'todo', start: '11:00', end: '12:00', kind: 'task', title: 'まだのもの' },
    ],
    generatedAt: '',
    freeMin: 300,
    fillRatio: 0.5,
    notes: [],
  }

  it('完了済みのコマは残す', () => {
    const { lines } = parsePlanText('19:00〜20:00 新しい予定', TASKS, NODES)
    const p = applyImport(existing, lines, DATE)
    expect(p.blocks.map((b) => b.title)).toEqual(['済んだもの', '新しい予定'])
  })

  it('完了済みと重なる行は落とす。実績のほうが正しいため', () => {
    const { lines } = parsePlanText('09:30〜10:30 かぶるもの\n19:00〜20:00 かぶらないもの', TASKS, NODES)
    const p = applyImport(existing, lines, DATE)
    expect(p.blocks.map((b) => b.title)).toEqual(['済んだもの', 'かぶらないもの'])
  })

  it('時刻順に並ぶ', () => {
    const { lines } = parsePlanText('20:00〜21:00 あと\n15:00〜16:00 さき', TASKS, NODES)
    const p = applyImport(undefined, lines, DATE)
    expect(p.blocks.map((b) => b.title)).toEqual(['さき', 'あと'])
  })

  it('取り込んだことが分かるように所見を残す', () => {
    const { lines } = parsePlanText('19:00〜20:00 A', TASKS, NODES)
    expect(applyImport(undefined, lines, DATE).notes.join()).toContain('取り込みました')
  })
})
