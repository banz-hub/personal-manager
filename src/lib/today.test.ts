import { describe, expect, it } from 'vitest'
import type { Exam, Mastery, Settings, StudyNode, StudySession, Task } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { toMinutes } from './date'
import { generatePlan, workMinutes, type FreeSlot } from './scheduler'
import { buildContextText, buildToday, topThreeToday, type BuildInput } from './today'

const TODAY = '2026-09-07'
const NOW = toMinutes('18:00')

function task(patch: Partial<Task> & { id: string; title: string }): Task {
  return {
    area: 'other',
    status: 'todo',
    estimateMin: 60,
    importance: 2,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...patch,
  }
}

function node(patch: Partial<StudyNode> & { id: string; title: string }): StudyNode {
  return {
    importance: 2,
    estimateMin: 60,
    order: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...patch,
  }
}

function slot(start: string, end: string): FreeSlot {
  return { startMin: toMinutes(start), endMin: toMinutes(end) }
}

function ctx(patch: Partial<BuildInput> = {}, settings: Partial<Settings> = {}) {
  return buildToday({
    date: TODAY,
    now: NOW,
    tasks: [],
    logs: [],
    nodes: [],
    exams: [],
    sessions: [],
    fixed: [],
    slots: [slot('18:00', '23:00')],
    settings: { ...DEFAULT_SETTINGS, ...settings },
    ...patch,
  })
}

const TREE: StudyNode[] = [
  node({ id: 'math', title: '数学', area: 'math' }),
  node({ id: 'topo', title: '位相空間論', parentId: 'math' }),
  node({ id: 'open', title: '開集合', parentId: 'topo', order: 0 }),
  node({ id: 'closed', title: '閉集合', parentId: 'topo', order: 1 }),
  node({ id: 'conn', title: '連結性', parentId: 'topo', order: 2 }),
]

const EXAM: Exam = {
  id: 'e1',
  title: '位相空間論 期末',
  date: '2026-09-09',
  scopeNodeIds: ['topo'],
  importance: 3,
  createdAt: '',
}

describe('タスクと学習を1つの並びにする', () => {
  it('試験直前の学習は、締切の遠いタスクより上に来る', () => {
    const c = ctx({
      tasks: [task({ id: 't', title: '締切の遠いタスク', dueDate: '2026-10-30', importance: 2 })],
      nodes: TREE.map((n) => (n.id === 'open' ? { ...n, mastery: 'needs-review' as Mastery } : n)),
      exams: [EXAM],
    })

    expect(c.schedulable[0].kind).toBe('study')
    expect(c.schedulable[0].title).toContain('開集合')
  })

  it('今日が締切のタスクは、試験が先の学習より上に来る', () => {
    const c = ctx({
      tasks: [task({ id: 't', title: '今日締切', dueDate: TODAY, importance: 3 })],
      nodes: TREE,
      exams: [{ ...EXAM, date: '2026-10-20' }],
    })

    expect(c.schedulable[0].kind).toBe('task')
  })

  it('学習項目は上限の件数までしか今日の対象にしない', () => {
    const many = [
      node({ id: 'r', title: '資格', area: 'cert' }),
      ...Array.from({ length: 20 }, (_, i) =>
        node({ id: `n${i}`, title: `項目${i}`, parentId: 'r', order: i }),
      ),
    ]
    const c = ctx({ nodes: many }, { studyPerDayMax: 3 })
    expect(c.schedulable.filter((s) => s.kind === 'study')).toHaveLength(3)
    // 候補そのものは全部見えている (画面には出す)
    expect(c.study).toHaveLength(20)
  })
})

describe('予定表に学習が載る', () => {
  it('タスクと学習が同じ予定表に並ぶ', () => {
    const c = ctx({
      tasks: [task({ id: 't', title: '数学課題', estimateMin: 60, dueDate: TODAY })],
      nodes: TREE,
      exams: [EXAM],
    })
    const plan = generatePlan({
      slots: c.slots,
      items: c.schedulable,
      settings: DEFAULT_SETTINGS,
      today: TODAY,
      now: NOW,
    })

    expect(plan.blocks.some((b) => b.kind === 'task' && b.taskId === 't')).toBe(true)
    expect(plan.blocks.some((b) => b.kind === 'study' && b.nodeId != null)).toBe(true)
  })

  it('学習のコマには、どのノードかが残る', () => {
    const c = ctx({ nodes: TREE, exams: [EXAM] })
    const plan = generatePlan({
      slots: c.slots,
      items: c.schedulable,
      settings: DEFAULT_SETTINGS,
      today: TODAY,
      now: NOW,
    })
    const block = plan.blocks.find((b) => b.kind === 'study')!
    expect(block.nodeId).toBeTruthy()
    expect(block.taskId).toBeUndefined()
    expect(block.reason).toBeTruthy()
  })

  it('学習を入れても詰め込みの上限は守られる', () => {
    const many = [
      node({ id: 'r', title: '資格', area: 'cert' }),
      ...Array.from({ length: 10 }, (_, i) =>
        node({ id: `n${i}`, title: `項目${i}`, parentId: 'r', order: i }),
      ),
    ]
    const c = ctx(
      { tasks: [task({ id: 't', title: 'A', estimateMin: 120, dueDate: TODAY })], nodes: many },
      { studyPerDayMax: 10 },
    )
    const plan = generatePlan({
      slots: c.slots,
      items: c.schedulable,
      settings: DEFAULT_SETTINGS,
      today: TODAY,
      now: NOW,
    })
    // 5時間の8割 = 240分
    expect(workMinutes(plan)).toBeLessThanOrEqual(240)
  })

  it('タスクと学習で id がぶつかっても二重に置かない', () => {
    const c = ctx({
      tasks: [task({ id: 'same', title: 'タスク側', estimateMin: 30, dueDate: TODAY })],
      nodes: [
        node({ id: 'root', title: '資格', area: 'cert' }),
        node({ id: 'same', title: '学習側', parentId: 'root', estimateMin: 30 }),
      ],
    })
    const plan = generatePlan({
      slots: c.slots,
      items: c.schedulable,
      settings: DEFAULT_SETTINGS,
      today: TODAY,
      now: NOW,
    })
    expect(plan.blocks.filter((b) => b.taskId === 'same')).toHaveLength(1)
    expect(plan.blocks.filter((b) => b.nodeId === 'same')).toHaveLength(1)
  })
})

describe('試験の逆算が今日の状況に入る', () => {
  it('近い順に試験の計画が出る', () => {
    const c = ctx({
      nodes: TREE,
      exams: [
        { ...EXAM, id: 'far', date: '2026-10-01' },
        { ...EXAM, id: 'near', date: '2026-09-09' },
      ],
    })
    expect(c.examPlans.map((p) => p.exam.id)).toEqual(['near', 'far'])
    expect(c.examPlans[0].daysLeft).toBe(2)
  })

  it('過ぎた試験は出さない', () => {
    const c = ctx({ nodes: TREE, exams: [{ ...EXAM, date: '2026-09-01' }] })
    expect(c.examPlans).toHaveLength(0)
  })
})

describe('Claude に渡すテキスト', () => {
  it('予定・空き時間・タスク・試験・学習がすべて入る', () => {
    const sessions: StudySession[] = [
      { id: 's1', nodeId: 'open', date: '2026-09-05', minutes: 30, correct: 3, attempted: 10, createdAt: '' },
    ]
    const c = ctx({
      tasks: [task({ id: 't', title: '数学課題', dueDate: TODAY })],
      nodes: TREE.map((n) => (n.id === 'open' ? { ...n, mastery: 'learning' as Mastery } : n)),
      exams: [EXAM],
      sessions,
    })
    const text = buildContextText(c)

    expect(text).toContain('# 今日の状況')
    expect(text).toContain('## 空き時間')
    expect(text).toContain('数学課題')
    expect(text).toContain('## 試験')
    expect(text).toContain('位相空間論 期末')
    expect(text).toContain('## 学習の候補')
    expect(text).toContain('開集合')
    expect(text).toContain('正答率30%')
  })

  it('何も無くても壊れない', () => {
    expect(buildContextText(ctx()).length).toBeGreaterThan(0)
  })
})

describe('今日の最重要3項目', () => {
  it('タスクと学習をまたいで選ぶ', () => {
    const c = ctx({
      tasks: [task({ id: 't', title: '今日締切', dueDate: TODAY, importance: 3 })],
      nodes: TREE.map((n) => (n.id === 'open' ? { ...n, mastery: 'needs-review' as Mastery } : n)),
      exams: [EXAM],
    })
    const three = topThreeToday(c)

    expect(three.length).toBeGreaterThanOrEqual(2)
    expect(three.some((s) => s.kind === 'task')).toBe(true)
    expect(three.some((s) => s.kind === 'study')).toBe(true)
  })

  it('任意のタスクは入れない', () => {
    const c = ctx({
      tasks: [task({ id: 'opt', title: 'いつか', importance: 1 })],
    })
    expect(topThreeToday(c)).toHaveLength(0)
  })

  it('3件までしか返さない', () => {
    const c = ctx({
      tasks: [1, 2, 3, 4, 5].map((i) =>
        task({ id: `t${i}`, title: `T${i}`, dueDate: TODAY, importance: 3 }),
      ),
    })
    expect(topThreeToday(c)).toHaveLength(3)
  })
})
