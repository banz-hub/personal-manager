import { describe, expect, it } from 'vitest'
import type { Company, DayPlan, SelectionEvent, Settings, StudyNode, Task } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { ask, topicOf } from './ask'
import { toMinutes } from './date'
import { needsTriage, nextStep } from './routine'
import { groupHits, normalize, search } from './search'
import { buildStats, dayBuckets, monthBuckets, ratios, totalOf, trendOf, yearBuckets } from './stats'
import { buildToday, type BuildInput } from './today'

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

describe('聞かれたことへの答え', () => {
  function ctx(patch: Partial<BuildInput> = {}) {
    return buildToday({
      date: TODAY,
      now: toMinutes('18:00'),
      tasks: [],
      logs: [],
      nodes: [],
      exams: [],
      sessions: [],
      companies: [],
      selections: [],
      sleepLogs: [],
      fixed: [],
      slots: [{ startMin: toMinutes('18:00'), endMin: toMinutes('23:00') }],
      settings: DEFAULT_SETTINGS,
      ...patch,
    })
  }

  it('聞き方から話題を選ぶ', () => {
    expect(topicOf('今日どうすればいい？')).toBe('today')
    expect(topicOf('締切やばい？')).toBe('deadline')
    expect(topicOf('勉強は何から？')).toBe('study')
    expect(topicOf('就活の予定は？')).toBe('jobhunt')
    expect(topicOf('筋トレは？')).toBe('workout')
    expect(topicOf('今日の予定は？')).toBe('plan')
  })

  it('分からない聞き方には、作り話をせず答えられる範囲を並べる', () => {
    const a = ask('あしたの天気は？', ctx())
    expect(a.topic).toBe('unknown')
    expect(a.headline).toContain('聞き取れませんでした')
    expect(a.lines.join()).toContain('今日どうすればいい')
  })

  it('今日の答えには、何からやるかと理由が入る', () => {
    const a = ask('今日どうすればいい？', ctx({ tasks: [task({ id: 't', title: '数学課題', dueDate: TODAY })] }))
    expect(a.headline).toContain('数学課題')
    expect(a.headline).toContain('今日が締切')
    expect(a.lines.join()).toContain('使える時間')
  })

  it('タスクが無ければ、そこから案内する', () => {
    const a = ask('今日どうすればいい？', ctx())
    expect(a.headline).toContain('登録されていません')
    expect(a.to).toBe('/tasks')
  })

  it('期限切れがあれば必ず触れる', () => {
    const a = ask('今日どうすればいい？', ctx({ tasks: [task({ id: 't', title: '遅れてる', dueDate: '2026-09-01' })] }))
    expect(a.lines.join()).toContain('期限切れ')
  })

  it('締切を聞かれたら、期限切れ・今日・今週を並べる', () => {
    const a = ask('締切は？', ctx({ tasks: [task({ id: 't', title: 'ES', dueDate: TODAY, dueTime: '23:59' })] }))
    expect(a.lines.join()).toContain('ES')
    expect(a.lines.join()).toContain('23:59まで')
  })

  it('締切が無ければ、無いと言う', () => {
    expect(ask('締切は？', ctx()).headline).toContain('差し迫った締切はありません')
  })

  it('就活を聞かれたら、次の予定と次にやることを返す', () => {
    const a = ask('就活は？', ctx({ companies: COMPANIES, selections: SELECTIONS }))
    expect(a.headline).toContain('DIT')
    expect(a.lines.join()).toContain('次にやること')
  })

  it('予定表がまだ無ければ、作るよう促す', () => {
    expect(ask('今日の予定は？', ctx()).headline).toContain('作っていません')
  })
})

describe('朝と夜の流れ', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, updatedAt: '2026-09-01T00:00:00.000Z' }

  function plan(blocks: Array<{ id: string; done?: boolean }>): DayPlan {
    return {
      id: TODAY,
      date: TODAY,
      blocks: blocks.map((b, i) => ({
        id: b.id,
        start: `${String(9 + i).padStart(2, '0')}:00`,
        end: `${String(10 + i).padStart(2, '0')}:00`,
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

  const base = { today: TODAY, reviewed: false, hasUndone: false, settings, hasTasks: true }

  it('タスクが無ければ、まず入れるよう言う', () => {
    const s = nextStep({ ...base, now: toMinutes('09:00'), hasTasks: false })
    expect(s.kind).toBe('plan')
    expect(s.title).toContain('タスクを 1 つ')
  })

  it('朝、予定がまだ無ければ作るよう促す', () => {
    const s = nextStep({ ...base, now: toMinutes('08:00') })
    expect(s.kind).toBe('plan')
    expect(s.action).toBe('今日の予定を作る')
  })

  it('日中は次のコマを知らせる', () => {
    const s = nextStep({ ...base, now: toMinutes('12:00'), plan: plan([{ id: 'a', done: true }, { id: 'b' }]) })
    expect(s.kind).toBe('work')
    expect(s.title).toContain('b')
  })

  it('夜はふりかえりを促す', () => {
    const s = nextStep({ ...base, now: toMinutes('22:00'), plan: plan([{ id: 'a' }]) })
    expect(s.kind).toBe('review')
  })

  it('全部終わっていれば、夜でなくてもふりかえりに進む', () => {
    const s = nextStep({ ...base, now: toMinutes('15:00'), plan: plan([{ id: 'a', done: true }]) })
    expect(s.kind).toBe('review')
  })

  it('ふりかえり済みで未完了があれば、繰り越しを勧める', () => {
    const s = nextStep({
      ...base,
      now: toMinutes('22:00'),
      plan: plan([{ id: 'a' }]),
      reviewed: true,
      hasUndone: true,
    })
    expect(s.kind).toBe('carry')
  })

  it('やることが無ければ何も出さない', () => {
    const s = nextStep({
      ...base,
      now: toMinutes('22:00'),
      plan: plan([{ id: 'a', done: true }]),
      reviewed: true,
    })
    expect(s.kind).toBe('none')
  })

  it('案内を切っていれば何も出さない', () => {
    const s = nextStep({ ...base, now: toMinutes('08:00'), settings: { ...settings, showRoutine: false } })
    expect(s.kind).toBe('none')
  })

  it('書き出しから日が空いていれば、何より先に催促する', () => {
    const s = nextStep({
      ...base,
      now: toMinutes('08:00'),
      settings: { ...settings, lastBackupOn: '2026-07-01' },
    })
    expect(s.kind).toBe('backup')
  })

  it('最近書き出していれば催促しない', () => {
    const s = nextStep({
      ...base,
      now: toMinutes('08:00'),
      settings: { ...settings, lastBackupOn: '2026-09-05' },
    })
    expect(s.kind).not.toBe('backup')
  })

  it('使い始めてすぐは催促しない', () => {
    const s = nextStep({
      ...base,
      now: toMinutes('08:00'),
      settings: { ...settings, updatedAt: '2026-09-07T00:00:00.000Z' },
    })
    expect(s.kind).not.toBe('backup')
  })
})

describe('期限切れの棚卸し', () => {
  it('件数が多いほど強く言う', () => {
    expect(needsTriage(0)).toBeNull()
    expect(needsTriage(2)).toContain('2件')
    expect(needsTriage(6)).toContain('たまっています')
  })
})
