import { describe, expect, it } from 'vitest'
import type { Exam, Mastery, Settings, StudyNode, StudySession, Task } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import type { KintoreDay } from './bridge/kintore'
import { toMinutes } from './date'
import { generatePlan, workMinutes, type FreeSlot } from './scheduler'
import {
  buildContextText,
  buildToday,
  easedSettings,
  topThreeToday,
  type BuildInput,
} from './today'

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
    companies: [],
    selections: [],
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

describe('筋トレの取り込み', () => {
  function kintore(patch: Partial<KintoreDay> = {}): KintoreDay {
    return {
      available: true,
      forDate: TODAY,
      doneToday: false,
      plannedToday: true,
      planReason: '直近7日で2回。週5回に届いていないので、今日に置きます',
      estimateMin: 50,
      restDays: 1,
      streakDays: 1,
      restRecommended: false,
      last7Count: 2,
      daysPerWeek: 5,
      ...patch,
    }
  }

  it('やる日なら予定に入る候補になる', () => {
    const c = ctx({ workout: kintore() })
    const w = c.schedulable.find((s) => s.kind === 'workout')
    expect(w).toBeDefined()
    expect(w!.todayMin).toBe(50)
    expect(w!.reason).toContain('週5回に届いていない')
  })

  it('もう終えていれば候補にしない', () => {
    const c = ctx({ workout: kintore({ doneToday: true, plannedToday: false }) })
    expect(c.schedulable.some((s) => s.kind === 'workout')).toBe(false)
  })

  it('休養日なら候補にしない', () => {
    const c = ctx({ workout: kintore({ plannedToday: false, restRecommended: true, streakDays: 3 }) })
    expect(c.schedulable.some((s) => s.kind === 'workout')).toBe(false)
  })

  it('連携が使えなければ候補にしない', () => {
    const c = ctx({ workout: kintore({ available: false }) })
    expect(c.schedulable.some((s) => s.kind === 'workout')).toBe(false)
  })

  it('締切のあるタスクに割り込まない', () => {
    const c = ctx({
      tasks: [task({ id: 't', title: '今日締切', dueDate: TODAY, importance: 3 })],
      workout: kintore(),
    })
    expect(c.schedulable[0].kind).toBe('task')
  })

  it('週の目標から遅れているほど順位が上がる', () => {
    const behind = ctx({ workout: kintore({ last7Count: 0 }) }).schedulable.findIndex(
      (s) => s.kind === 'workout',
    )
    const onTrack = ctx({
      tasks: [task({ id: 'a', title: 'A', dueDate: '2026-09-12' })],
      workout: kintore({ last7Count: 4 }),
    }).schedulable.findIndex((s) => s.kind === 'workout')
    // 遅れているほうが先頭に来る
    expect(behind).toBe(0)
    expect(onTrack).toBeGreaterThan(0)
  })

  it('予定表に筋トレのコマが載り、id は紐づけない', () => {
    const c = ctx({ workout: kintore() })
    const plan = generatePlan({
      slots: c.slots,
      items: c.schedulable,
      settings: c.planSettings,
      today: TODAY,
      now: NOW,
    })
    const b = plan.blocks.find((x) => x.kind === 'workout')!
    expect(b.title).toBe('筋トレ')
    expect(b.taskId).toBeUndefined()
    expect(b.nodeId).toBeUndefined()
    expect(b.reason).toBeTruthy()
  })

  it('今日の状況のテキストに筋トレが入る', () => {
    const text = buildContextText(ctx({ workout: kintore({ doneToday: true, todayMinutes: 55, plannedToday: false }) }))
    expect(text).toContain('## 筋トレ')
    expect(text).toContain('実施済み')
  })
})

describe('前日の負荷で詰め込みを緩める', () => {
  const base = DEFAULT_SETTINGS

  function kintore(patch: Partial<KintoreDay>): KintoreDay {
    return {
      available: true,
      forDate: TODAY,
      doneToday: false,
      plannedToday: false,
      planReason: '',
      estimateMin: 50,
      restDays: 1,
      streakDays: 1,
      restRecommended: false,
      last7Count: 2,
      daysPerWeek: 5,
      ...patch,
    }
  }

  it('3日続けていたら上限を下げ、理由を返す', () => {
    const r = easedSettings(base, kintore({ restRecommended: true, streakDays: 3 }))
    expect(r.settings.fillRatio).toBeCloseTo(0.7)
    expect(r.note).toContain('3日続けて')
    expect(r.note).toContain('80%から70%')
  })

  it('昨日たくさんやっていたら下げる', () => {
    const r = easedSettings(base, kintore({ yesterdayMinutes: 75 }))
    expect(r.settings.fillRatio).toBeCloseTo(0.7)
    expect(r.note).toContain('昨日1時間15分')
  })

  it('負荷が軽ければ下げない', () => {
    const r = easedSettings(base, kintore({ yesterdayMinutes: 30 }))
    expect(r.settings.fillRatio).toBe(base.fillRatio)
    expect(r.note).toBeUndefined()
  })

  it('設定を切っていれば下げない', () => {
    const r = easedSettings(
      { ...base, easeAfterWorkout: false },
      kintore({ restRecommended: true, streakDays: 4 }),
    )
    expect(r.settings.fillRatio).toBe(base.fillRatio)
  })

  it('連携が無ければ下げない', () => {
    expect(easedSettings(base, undefined).settings.fillRatio).toBe(base.fillRatio)
  })

  it('下限の50%より下げない', () => {
    const r = easedSettings({ ...base, fillRatio: 0.5 }, kintore({ restRecommended: true }))
    expect(r.settings.fillRatio).toBe(0.5)
    expect(r.note).toBeUndefined()
  })
})
