import { describe, expect, it } from 'vitest'
import type { Company, SelectionEvent, StudyNode, Task } from '../types'
import { groupHits, normalize, search } from './search'
import { buildStats, dayBuckets, monthBuckets, ratios, totalOf, trendOf, yearBuckets } from './stats'

const TODAY = '2026-09-08'

function task(patch: Partial<Task> & { id: string; title: string }): Task {
  return { area: 'math', status: 'todo', estimateMin: 60, importance: 2, createdAt: '', ...patch }
}

const NODES: StudyNode[] = [
  { id: 'math', title: '数学', area: 'math', importance: 2, estimateMin: 0, order: 0, createdAt: '' },
  { id: 'topo', title: '位相空間論', parentId: 'math', importance: 2, estimateMin: 0, order: 0, createdAt: '' },
  { id: 'open', title: '開集合', parentId: 'topo', importance: 2, estimateMin: 60, order: 0, createdAt: '' },
]

const COMPANIES: Company[] = [
  {
    id: 'c1',
    name: 'DIT',
    industry: 'IT',
    stage: 'interview-final',
    interest: 5,
    facts: {},
    ratings: {},
    createdAt: '',
    updatedAt: '',
  },
]

const SELECTIONS: SelectionEvent[] = [
  { id: 's1', companyId: 'c1', kind: 'interview', title: '最終面接', date: '2026-09-28', createdAt: '' },
]

describe('検索', () => {
  const run = (query: string) =>
    search({
      query,
      tasks: [
        task({ id: 't1', title: '線形代数のレポート' }),
        task({ id: 't2', title: '終わったもの', status: 'done' }),
      ],
      nodes: NODES,
      companies: COMPANIES,
      selections: SELECTIONS,
    })

  it('カタカナとひらがな、大文字小文字の差を無視する', () => {
    expect(normalize('ＩＴパスポート')).toBe('itぱすぽーと')
    expect(normalize('ITパスポート')).toBe(normalize('ｉｔパスポート'))
  })

  it('タスク・学習・企業・選考をまたいで探せる', () => {
    expect(run('レポート').map((h) => h.kind)).toContain('task')
    expect(run('開集合').map((h) => h.kind)).toContain('node')
    expect(run('dit').map((h) => h.kind)).toContain('company')
  })

  it('学習項目はどこにあるかも返す', () => {
    expect(run('開集合')[0].detail).toContain('数学 / 位相空間論')
  })

  it('まだ終わっていないタスクが上に来る', () => {
    const hits = search({
      query: 'もの',
      tasks: [
        task({ id: 'done', title: '終わったもの', status: 'done' }),
        task({ id: 'open', title: '残っているもの' }),
      ],
      nodes: [],
      companies: [],
      selections: [],
    })
    expect(hits[0].id).toBe('open')
  })

  it('空の検索は何も返さない', () => {
    expect(run('')).toHaveLength(0)
    expect(run('   ')).toHaveLength(0)
  })

  it('種類ごとにまとめられる', () => {
    const g = groupHits(run('dit'))
    expect(g.map(([k]) => k)).toContain('company')
  })
})

describe('月次・年次の集計', () => {
  const logs = [
    { id: 'l1', taskId: 't', date: '2026-09-01', area: 'math' as const, plannedMin: 60, actualMin: 60, createdAt: '' },
    { id: 'l2', taskId: 't', date: '2026-08-20', area: 'cert' as const, plannedMin: 30, actualMin: 30, createdAt: '' },
  ]
  const sessions = [
    { id: 's1', nodeId: 'open', date: '2026-09-05', minutes: 45, mastery: 'mastered' as const, createdAt: '' },
  ]

  it('直近の月で区切る。古い順に並ぶ', () => {
    const b = monthBuckets(TODAY, 3)
    expect(b.map((x) => x.label)).toEqual(['7月', '8月', '9月'])
    expect(b[2].from).toBe('2026-09-01')
    expect(b[2].to).toBe('2026-09-30')
  })

  it('年でも区切れる', () => {
    expect(yearBuckets(TODAY, 2).map((x) => x.label)).toEqual(['2025年', '2026年'])
  })

  it('日でも区切れる', () => {
    const b = dayBuckets(TODAY, 3)
    expect(b.map((x) => x.from)).toEqual(['2026-09-06', '2026-09-07', '2026-09-08'])
  })

  it('区切りごとに時間と分野を集計する', () => {
    const stats = buildStats({
      buckets: monthBuckets(TODAY, 2),
      logs,
      sessions,
      nodes: NODES,
      plans: [],
      workouts: [{ date: '2026-09-07', minutes: 50 }],
    })
    const aug = stats[0]
    const sep = stats[1]

    expect(aug.taskMin).toBe(30)
    expect(sep.taskMin).toBe(60)
    expect(sep.studyMin).toBe(45)
    expect(sep.workoutMin).toBe(50)
    expect(sep.totalMin).toBe(155)
    expect(sep.masteredCount).toBe(1)
    expect(Object.fromEntries(sep.byArea)).toEqual({ math: 105 })
  })

  it('全部まとめた数字も出せる', () => {
    const stats = buildStats({
      buckets: monthBuckets(TODAY, 2),
      logs,
      sessions,
      nodes: NODES,
      plans: [],
      workouts: null,
    })
    const t = totalOf(stats)!
    expect(t.taskMin).toBe(90)
    expect(t.byArea.length).toBe(2)
  })

  it('棒グラフの割合は、最大を1にする。全部0でも壊れない', () => {
    expect(ratios([10, 5, 0])).toEqual([1, 0.5, 0])
    expect(ratios([0, 0])).toEqual([0, 0])
    expect(ratios([])).toEqual([])
  })

  it('増減を言葉で返す', () => {
    const stats = buildStats({
      buckets: monthBuckets(TODAY, 2),
      logs,
      sessions: [],
      nodes: NODES,
      plans: [],
      workouts: null,
    })
    // 8月30分 → 9月60分
    expect(trendOf(stats)).toContain('増えています')
  })

  it('区切りが1つなら増減は言わない', () => {
    expect(trendOf(buildStats({ buckets: monthBuckets(TODAY, 1), logs, sessions: [], nodes: [], plans: [], workouts: null }))).toBeNull()
  })
})

describe('学習のタスクの時間', () => {
  it('学習のタスクの記録はタスクではなく学習に数える', () => {
    const [b] = buildStats({
      buckets: monthBuckets(TODAY, 1),
      logs: [
        { id: '1', taskId: 'st', date: TODAY, area: 'cert', plannedMin: 30, actualMin: 40, createdAt: '' },
        { id: '2', taskId: 'tk', date: TODAY, area: 'other', plannedMin: 30, actualMin: 20, createdAt: '' },
      ],
      sessions: [],
      nodes: [],
      plans: [],
      workouts: null,
      studyTaskIds: new Set(['st']),
    })
    expect(b.studyMin).toBe(40)
    expect(b.taskMin).toBe(20)
  })
})
