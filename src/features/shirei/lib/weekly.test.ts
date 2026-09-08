import { describe, expect, it } from 'vitest'
import type {
  Company,
  DailyReview,
  DayPlan,
  SelectionEvent,
  StudyNode,
  StudySession,
  TaskLog,
} from '../types'
import type { WorkoutDay } from './bridge/kintore'
import {
  buildWeekly,
  daysLeftInWeek,
  formatWeek,
  isCurrentWeek,
  shiftWeek,
  weekEndOf,
  weekStartOf,
  type WeeklyInput,
} from './weekly'

// 2026-09-08 は火曜。その週は 09-07(月)〜09-13(日)
const TUE = '2026-09-08'
const MON = '2026-09-07'
const SUN = '2026-09-13'

function input(patch: Partial<WeeklyInput> = {}): WeeklyInput {
  return {
    date: TUE,
    tasks: [],
    logs: [],
    plans: [],
    reviews: [],
    nodes: [],
    sessions: [],
    companies: [],
    selections: [],
    workouts: [],
    ...patch,
  }
}

function plan(date: string, blocks: Array<{ id: string; done?: boolean; min?: number }>): DayPlan {
  return {
    id: date,
    date,
    blocks: blocks.map((b, i) => ({
      id: b.id,
      start: `${String(9 + i).padStart(2, '0')}:00`,
      end: `${String(9 + i).padStart(2, '0')}:${String(b.min ?? 60).padStart(2, '0')}`.replace(':60', ':59'),
      kind: 'task' as const,
      taskId: b.id,
      title: b.id,
      doneAt: b.done ? 'x' : undefined,
    })),
    generatedAt: '',
    freeMin: 300,
    fillRatio: 0.6,
    notes: [],
  }
}

function log(patch: Partial<TaskLog> & { taskId: string; date: string }): TaskLog {
  return { id: `l_${patch.taskId}`, area: 'math', plannedMin: 60, actualMin: 60, createdAt: '', ...patch }
}

function review(date: string, deferred: string[]): DailyReview {
  return {
    id: date,
    date,
    doneTaskIds: [],
    undoneTaskIds: deferred,
    deferredTaskIds: deferred,
    doneNodeIds: [],
    undoneNodeIds: [],
    plannedMin: 0,
    actualMin: 0,
    studyMin: 0,
    workoutMin: 0,
    workoutDone: false,
    findings: [],
    createdAt: '',
  }
}

const NODES: StudyNode[] = [
  { id: 'math', title: '数学', area: 'math', importance: 2, estimateMin: 0, order: 0, createdAt: '' },
  { id: 'open', title: '開集合', parentId: 'math', importance: 2, estimateMin: 60, order: 0, createdAt: '' },
  { id: 'cert', title: '資格', area: 'cert', importance: 2, estimateMin: 0, order: 1, createdAt: '' },
  { id: 'ip', title: 'IP', parentId: 'cert', importance: 2, estimateMin: 60, order: 0, createdAt: '' },
]

function ses(patch: Partial<StudySession> & { nodeId: string; date: string }): StudySession {
  return { id: `s_${patch.nodeId}_${patch.date}`, minutes: 30, createdAt: '', ...patch }
}

describe('週の区切り', () => {
  it('月曜はじまりで数える', () => {
    expect(weekStartOf(TUE)).toBe(MON)
    expect(weekEndOf(TUE)).toBe(SUN)
  })

  it('月曜そのものは、その週の始まり', () => {
    expect(weekStartOf(MON)).toBe(MON)
  })

  it('日曜は前の週の終わりとして扱う', () => {
    expect(weekStartOf(SUN)).toBe(MON)
  })

  it('前の週・次の週へ動かせる', () => {
    expect(shiftWeek(TUE, -1)).toBe('2026-08-31')
    expect(shiftWeek(TUE, 1)).toBe('2026-09-14')
  })

  it('表示は 9/7〜9/13 の形', () => {
    expect(formatWeek(MON)).toBe('9/7〜9/13')
  })

  it('今週かどうかと、残り日数が分かる', () => {
    expect(isCurrentWeek(MON, TUE)).toBe(true)
    expect(isCurrentWeek('2026-08-31', TUE)).toBe(false)
    // 火曜なので、火・水・木・金・土・日 の6日
    expect(daysLeftInWeek(MON, TUE)).toBe(6)
    expect(daysLeftInWeek('2026-08-31', TUE)).toBe(0)
  })
})

describe('タスクの集計', () => {
  it('完了率と延期率を出す', () => {
    const s = buildWeekly(
      input({
        plans: [
          plan(MON, [{ id: 'a', done: true }, { id: 'b' }]),
          plan('2026-09-09', [{ id: 'c', done: true }, { id: 'd' }]),
        ],
        reviews: [review(MON, ['b'])],
      }),
    )
    expect(s.tasks.planned).toBe(4)
    expect(s.tasks.done).toBe(2)
    expect(s.tasks.deferred).toBe(1)
    expect(s.tasks.completionRate).toBe(0.5)
    expect(s.tasks.deferRate).toBe(0.25)
  })

  it('週の外の予定は数えない', () => {
    const s = buildWeekly(
      input({ plans: [plan('2026-09-06', [{ id: 'x' }]), plan(MON, [{ id: 'a' }])] }),
    )
    expect(s.tasks.planned).toBe(1)
  })

  it('見積もり精度は実績÷予定の中央値', () => {
    const s = buildWeekly(
      input({
        plans: [plan(MON, [{ id: 'a' }])],
        logs: [
          log({ taskId: 'a', date: MON, plannedMin: 60, actualMin: 90 }),
          log({ taskId: 'b', date: MON, plannedMin: 60, actualMin: 120 }),
          log({ taskId: 'c', date: MON, plannedMin: 60, actualMin: 60 }),
        ],
      }),
    )
    // 1.5 / 2.0 / 1.0 の中央値 = 1.5
    expect(s.tasks.estimateRatio).toBe(1.5)
  })

  it('ログが無ければ見積もり精度は null', () => {
    expect(buildWeekly(input({ plans: [plan(MON, [{ id: 'a' }])] })).tasks.estimateRatio).toBeNull()
  })
})

describe('学習の集計', () => {
  it('学習時間と分野ごとの内訳を出す', () => {
    const s = buildWeekly(
      input({
        nodes: NODES,
        sessions: [
          ses({ nodeId: 'open', date: MON, minutes: 60 }),
          ses({ nodeId: 'ip', date: '2026-09-09', minutes: 30 }),
        ],
      }),
    )
    expect(s.study.totalMin).toBe(90)
    expect(s.study.sessions).toBe(2)
    expect(s.study.byArea[0]).toEqual(['math', 60])
  })

  it('タスクの実績も分野の内訳に足す', () => {
    const s = buildWeekly(
      input({
        nodes: NODES,
        plans: [plan(MON, [{ id: 'a' }])],
        logs: [log({ taskId: 'a', date: MON, area: 'jobhunt', actualMin: 45 })],
        sessions: [ses({ nodeId: 'open', date: MON, minutes: 30 })],
      }),
    )
    expect(Object.fromEntries(s.study.byArea)).toEqual({ jobhunt: 45, math: 30 })
  })

  it('習得まで進んだ数を数える', () => {
    const s = buildWeekly(
      input({
        nodes: NODES,
        sessions: [
          ses({ nodeId: 'open', date: MON, mastery: 'mastered' }),
          ses({ nodeId: 'ip', date: MON, mastery: 'learning' }),
        ],
      }),
    )
    expect(s.study.masteredCount).toBe(1)
  })
})

describe('就活の集計', () => {
  const companies: Company[] = [
    { id: 'a', name: 'A社', stage: 'es-draft', interest: 4, facts: {}, ratings: {}, createdAt: '', updatedAt: '' },
    { id: 'b', name: 'B社', stage: 'offer', interest: 3, facts: {}, ratings: {}, createdAt: '', updatedAt: '' },
  ]

  function sel(patch: Partial<SelectionEvent> & { id: string; date: string }): SelectionEvent {
    return { companyId: 'a', kind: 'es', title: 'ES', createdAt: '', ...patch }
  }

  it('ES・説明会・面接の数を分けて数える', () => {
    const s = buildWeekly(
      input({
        companies,
        selections: [
          sel({ id: '1', date: MON, kind: 'es' }),
          sel({ id: '2', date: '2026-09-09', kind: 'briefing' }),
          sel({ id: '3', date: '2026-09-10', kind: 'interview' }),
          sel({ id: '4', date: '2026-09-11', kind: 'interview' }),
        ],
      }),
    )
    expect(s.jobhunt.esCount).toBe(1)
    expect(s.jobhunt.briefingCount).toBe(1)
    expect(s.jobhunt.interviewCount).toBe(2)
    expect(s.jobhunt.activeCompanies).toBe(1)
  })
})

describe('筋トレの集計', () => {
  it('回数・時間・休養日を出す', () => {
    const workouts: WorkoutDay[] = [
      { date: MON, minutes: 55 },
      { date: '2026-09-09', minutes: 40 },
    ]
    const s = buildWeekly(input({ workouts }))
    expect(s.workout.count).toBe(2)
    expect(s.workout.totalMin).toBe(95)
    expect(s.workout.restDays).toBe(5)
    expect(s.workout.available).toBe(true)
  })

  it('連携が読めなければ、そう分かるようにする', () => {
    expect(buildWeekly(input({ workouts: null })).workout.available).toBe(false)
  })
})

describe('来週改善すべきこと', () => {
  it('多くても3つまでしか返さない', () => {
    const s = buildWeekly(
      input({
        plans: [plan(MON, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])],
        reviews: [review(MON, ['a', 'b'])],
        logs: [log({ taskId: 'c', date: MON, plannedMin: 30, actualMin: 90 })],
        nodes: NODES,
        workouts: [
          { date: MON, minutes: 30 },
          { date: '2026-09-08', minutes: 30 },
          { date: '2026-09-09', minutes: 30 },
          { date: '2026-09-10', minutes: 30 },
          { date: '2026-09-11', minutes: 30 },
          { date: '2026-09-12', minutes: 30 },
          { date: '2026-09-13', minutes: 30 },
        ],
      }),
    )
    expect(s.improvements).toHaveLength(3)
  })

  it('完了率が低ければ、量を減らすよう言う', () => {
    const s = buildWeekly(
      input({ plans: [plan(MON, [{ id: 'a', done: true }, { id: 'b' }, { id: 'c' }, { id: 'd' }])] }),
    )
    expect(s.improvements.join()).toContain('減らす')
  })

  it('就活の締切が迫っていれば、いちばん上に出す', () => {
    const s = buildWeekly(
      input({
        plans: [plan(MON, [{ id: 'a', done: true }])],
        companies: [
          { id: 'a', name: 'DIT', stage: 'interview-final', interest: 5, facts: {}, ratings: {}, createdAt: '', updatedAt: '' },
        ],
        selections: [
          { id: 's1', companyId: 'a', kind: 'interview', title: '最終面接', date: '2026-09-14', createdAt: '' },
        ],
      }),
    )
    expect(s.improvements[0]).toContain('就活')
  })

  it('7日連続でトレーニングしていたら休養を勧める', () => {
    const s = buildWeekly(
      input({
        plans: [plan(MON, [{ id: 'a', done: true }])],
        workouts: Array.from({ length: 7 }, (_, i) => ({
          date: `2026-09-${String(7 + i).padStart(2, '0')}`,
          minutes: 40,
        })),
      }),
    )
    expect(s.improvements.join()).toContain('休養日')
  })

  it('学習の記録が無ければ、そこを指摘する', () => {
    const s = buildWeekly(
      input({ plans: [plan(MON, [{ id: 'a', done: true }])], nodes: NODES, sessions: [] }),
    )
    expect(s.improvements.join()).toContain('学習の記録がありません')
  })

  it('分野が偏っていれば知らせる', () => {
    const s = buildWeekly(
      input({
        plans: [plan(MON, [{ id: 'a', done: true }])],
        nodes: NODES,
        sessions: [
          ses({ nodeId: 'open', date: MON, minutes: 200 }),
          ses({ nodeId: 'ip', date: MON, minutes: 20 }),
        ],
      }),
    )
    expect(s.improvements.join()).toContain('寄っています')
  })

  it('大きな崩れが無ければ、そう言う', () => {
    const s = buildWeekly(
      input({
        plans: [plan(MON, [{ id: 'a', done: true }, { id: 'b', done: true }])],
        logs: [log({ taskId: 'a', date: MON, plannedMin: 60, actualMin: 60 })],
        workouts: [
          { date: MON, minutes: 40 },
          { date: '2026-09-09', minutes: 40 },
        ],
      }),
    )
    expect(s.improvements).toHaveLength(1)
    expect(s.improvements[0]).toContain('大きな崩れはありません')
  })

  it('予定を作っていない週は、そこから案内する', () => {
    const s = buildWeekly(input())
    expect(s.improvements[0]).toContain('予定を作っていません')
  })
})

describe('集中したセット数', () => {
  it('タスクと学習の両方から集める', () => {
    const s = buildWeekly(
      input({
        logs: [log({ taskId: 'a', date: MON, pomodoros: 2 })],
        sessions: [ses({ nodeId: 'open', date: TUE, pomodoros: 3 })],
        nodes: NODES,
      }),
    )
    expect(s.focusSets).toBe(5)
  })

  it('手で付けた記録は数えない', () => {
    // pomodoros を持たない = タイマーを使っていない。セットという単位が無い
    const s = buildWeekly(
      input({
        logs: [log({ taskId: 'a', date: MON }), log({ taskId: 'b', date: TUE, pomodoros: 1 })],
      }),
    )
    expect(s.focusSets).toBe(1)
  })

  it('週の外は数えない', () => {
    const s = buildWeekly(
      input({ logs: [log({ taskId: 'a', date: '2026-09-06', pomodoros: 9 })] }),
    )
    expect(s.focusSets).toBe(0)
  })

  it('週の最終日も入る', () => {
    const s = buildWeekly(input({ logs: [log({ taskId: 'a', date: SUN, pomodoros: 4 })] }))
    expect(s.focusSets).toBe(4)
  })
})
