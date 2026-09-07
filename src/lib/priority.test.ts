import { describe, expect, it } from 'vitest'
import type { Task, TaskArea, TaskLog } from '../types'
import { groupByBucket, rankTasks, scoreTask, topThree, type RankInput } from './priority'

const TODAY = '2026-09-07'
/** 18:00 */
const NOW = 18 * 60

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

function input(tasks: Task[], patch: Partial<RankInput> = {}): RankInput {
  return { tasks, logs: [], today: TODAY, now: NOW, availableMin: 240, ...patch }
}

describe('締切と重要度の兼ね合い', () => {
  it('重要度が低くても今日締切なら、重要度が高い1週間後より上に来る', () => {
    const dueToday = task({
      id: 'a',
      title: '重要度低・今日締切',
      importance: 1,
      dueDate: TODAY,
    })
    const importantLater = task({
      id: 'b',
      title: '重要度高・1週間後',
      importance: 3,
      dueDate: '2026-09-14',
    })

    const ranked = rankTasks(input([importantLater, dueToday]))

    expect(ranked[0].task.id).toBe('a')
    expect(ranked[0].reasons).toContain('今日が締切')
  })

  it('締切が同じなら重要度が高いほうが上に来る', () => {
    const low = task({ id: 'low', title: '低', importance: 1, dueDate: '2026-09-10' })
    const high = task({ id: 'high', title: '高', importance: 3, dueDate: '2026-09-10' })

    const ranked = rankTasks(input([low, high]))

    expect(ranked[0].task.id).toBe('high')
  })

  it('期限切れは別のグループに入り、警告が付く', () => {
    const overdue = task({ id: 'over', title: '期限切れ', importance: 1, dueDate: '2026-09-05' })
    const today = task({ id: 'today', title: '今日締切', importance: 3, dueDate: TODAY })

    const g = groupByBucket(rankTasks(input([today, overdue])))

    expect(g.overdue.map((s) => s.task.id)).toEqual(['over'])
    expect(g.urgent.map((s) => s.task.id)).toEqual(['today'])
    expect(g.overdue[0].reasons).toContain('期限を過ぎている')
    expect(g.overdue[0].warnings.join()).toContain('締切を過ぎている')
  })

  it('重要度が同じなら、期限切れのほうが今日締切より上に来る', () => {
    const overdue = task({ id: 'over', title: '期限切れ', importance: 2, dueDate: '2026-09-05' })
    const today = task({ id: 'today', title: '今日締切', importance: 2, dueDate: TODAY })

    const ranked = rankTasks(input([today, overdue]))

    expect(ranked[0].task.id).toBe('over')
  })

  it('締切なしのタスクは締切ありに埋もれる', () => {
    const noDue = task({ id: 'none', title: '締切なし', importance: 3 })
    const soon = task({ id: 'soon', title: '3日後', importance: 2, dueDate: '2026-09-10' })

    const ranked = rankTasks(input([noDue, soon]))

    expect(ranked[0].task.id).toBe('soon')
  })
})

describe('締切の時刻', () => {
  it('時刻の指定が無い締切は、その日いっぱい (23:59) として扱う', () => {
    const t = task({ id: 't', title: '今日中', dueDate: TODAY })
    const s = scoreTask(t, input([t]))
    // 18:00 時点なので 5 時間59分 = 359 分残っている
    expect(s.leftMin).toBe(359)
  })

  it('締切時刻を過ぎていれば、同じ日でも期限切れになる', () => {
    const t = task({ id: 't', title: '17時締切', dueDate: TODAY, dueTime: '17:00' })
    const s = scoreTask(t, input([t]))
    expect(s.leftMin).toBeLessThan(0)
    expect(s.bucket).toBe('overdue')
  })
})

describe('グループ分け', () => {
  it('今日締切は最優先、今週中は重要、継続は継続、それ以外は任意に入る', () => {
    const tasks = [
      task({ id: 'u', title: '今日締切', dueDate: TODAY }),
      task({ id: 'i', title: '3日後', dueDate: '2026-09-10' }),
      task({ id: 'r', title: '英語', recurring: true, chunkMin: 20, estimateMin: 600 }),
      task({ id: 'o', title: 'いつか', importance: 1 }),
    ]

    const g = groupByBucket(rankTasks(input(tasks)))

    expect(g.urgent.map((s) => s.task.id)).toEqual(['u'])
    expect(g.important.map((s) => s.task.id)).toEqual(['i'])
    expect(g.routine.map((s) => s.task.id)).toEqual(['r'])
    expect(g.optional.map((s) => s.task.id)).toEqual(['o'])
  })

  it('今週が締切なら、3日より先でも重要に入る', () => {
    // 4日後。「任意」に落ちると見落とすので重要に入れる
    const t = task({ id: 'w', title: '複素解析学Bの予習', dueDate: '2026-09-11' })
    expect(rankTasks(input([t]))[0].bucket).toBe('important')
  })

  it('締切が遠くても重要度が高ければ任意に落とさない', () => {
    const t = task({ id: 'j', title: 'DIT最終面接の準備', area: 'jobhunt', importance: 3, dueDate: '2026-09-27' })
    expect(rankTasks(input([t]))[0].bucket).toBe('important')
  })

  it('重要度が高くても継続タスクなら継続のまま', () => {
    const t = task({ id: 'k', title: '公務員試験勉強', importance: 3, recurring: true, dueDate: '2027-05-31' })
    expect(rankTasks(input([t]))[0].bucket).toBe('routine')
  })

  it('継続タスクでも今日締切なら最優先に上がる', () => {
    const t = task({ id: 'r', title: '資格', recurring: true, dueDate: TODAY })
    const [s] = rankTasks(input([t]))
    expect(s.bucket).toBe('urgent')
  })

  it('完了とやめたタスクは候補に入らない', () => {
    const tasks = [
      task({ id: 'done', title: '完了', status: 'done', dueDate: TODAY }),
      task({ id: 'drop', title: 'やめた', status: 'dropped', dueDate: TODAY }),
      task({ id: 'live', title: '生きてる' }),
    ]
    expect(rankTasks(input(tasks)).map((s) => s.task.id)).toEqual(['live'])
  })
})

describe('放置と先送り', () => {
  it('先送りを繰り返したタスクは順位が上がり、その理由が出る', () => {
    const fresh = task({ id: 'fresh', title: '新しい' })
    const stale = task({ id: 'stale', title: '3回先送り', deferCount: 3 })

    const ranked = rankTasks(input([fresh, stale]))

    expect(ranked[0].task.id).toBe('stale')
    expect(ranked[0].reasons).toContain('3回先送りしている')
  })

  it('しばらくやっていない継続タスクほど上に来る', () => {
    const recent = task({
      id: 'recent',
      title: '昨日やった',
      recurring: true,
      lastWorkedOn: '2026-09-06',
    })
    const old = task({
      id: 'old',
      title: '5日前',
      recurring: true,
      lastWorkedOn: '2026-09-02',
    })

    const ranked = rankTasks(input([recent, old]))

    expect(ranked[0].task.id).toBe('old')
    expect(ranked[0].reasons).toContain('5日やっていない')
  })
})

describe('今日やれるかの判定', () => {
  it('今日締切なのに空き時間で終わらないタスクには警告を出す', () => {
    const t = task({ id: 'big', title: '大物', dueDate: TODAY, estimateMin: 600 })
    const [s] = rankTasks(input([t], { availableMin: 120 }))
    expect(s.warnings.join()).toContain('終えられない')
  })

  it('chunkMin があれば、今日充てるのは 1 回分だけ', () => {
    const t = task({
      id: 'long',
      title: '公務員試験',
      estimateMin: 30_000,
      chunkMin: 30,
      recurring: true,
    })
    const [s] = rankTasks(input([t]))
    expect(s.todayMin).toBe(30)
  })
})

describe('見積もりの補正', () => {
  function log(patch: Partial<TaskLog> & { taskId: string }): TaskLog {
    return {
      id: `l_${Math.random()}`,
      date: '2026-09-05',
      area: 'math' as TaskArea,
      plannedMin: 60,
      actualMin: 90,
      createdAt: '',
      ...patch,
    }
  }

  it('実績が見積もりを超え続けたら、今日の割り当てを伸ばす', () => {
    const t = task({ id: 'math', title: '数学課題', area: 'math', estimateMin: 60 })
    const logs = [
      log({ taskId: 'math', date: '2026-09-03' }),
      log({ taskId: 'math', date: '2026-09-04' }),
      log({ taskId: 'math', date: '2026-09-05' }),
    ]

    const [s] = rankTasks(input([t], { logs }))

    expect(s.todayMin).toBe(90)
    expect(s.estimateNote).toContain('伸ばした')
  })

  it('ログが1件だけなら補正しない', () => {
    const t = task({ id: 'math', title: '数学課題', area: 'math', estimateMin: 60 })
    const [s] = rankTasks(input([t], { logs: [log({ taskId: 'math' })] }))
    expect(s.todayMin).toBe(60)
  })

  it('そのタスクのログが無ければ同じ分野のログで代用する', () => {
    const t = task({ id: 'new', title: '別の数学課題', area: 'math', estimateMin: 60 })
    const logs = [
      log({ taskId: 'other1', date: '2026-09-03' }),
      log({ taskId: 'other2', date: '2026-09-04' }),
      log({ taskId: 'other3', date: '2026-09-05' }),
    ]
    const [s] = rankTasks(input([t], { logs }))
    expect(s.todayMin).toBe(90)
    expect(s.estimateNote).toContain('同じ分野')
  })

  it('補正が暴走しないよう上限で頭打ちにする', () => {
    const t = task({ id: 'x', title: '暴走', area: 'math', estimateMin: 60 })
    const logs = [1, 2, 3].map((i) =>
      log({ taskId: 'x', date: `2026-09-0${i}`, plannedMin: 10, actualMin: 300 }),
    )
    const [s] = rankTasks(input([t], { logs }))
    // 30 倍のログでも 2 倍で止まる
    expect(s.todayMin).toBe(120)
  })
})

describe('並びの安定性', () => {
  it('同じ入力なら毎回同じ順序になる', () => {
    const tasks = [
      task({ id: 'c', title: 'C' }),
      task({ id: 'a', title: 'A' }),
      task({ id: 'b', title: 'B' }),
    ]
    const once = rankTasks(input(tasks)).map((s) => s.task.id)
    const twice = rankTasks(input([...tasks].reverse())).map((s) => s.task.id)
    expect(once).toEqual(twice)
  })
})

describe('最重要3項目', () => {
  it('最優先と重要から最大3件を返し、任意は含めない', () => {
    const tasks = [
      task({ id: 'u1', title: 'u1', dueDate: TODAY }),
      task({ id: 'u2', title: 'u2', dueDate: TODAY }),
      task({ id: 'i1', title: 'i1', dueDate: '2026-09-09' }),
      task({ id: 'i2', title: 'i2', dueDate: '2026-09-10' }),
      task({ id: 'o1', title: 'o1', importance: 1 }),
    ]
    const three = topThree(rankTasks(input(tasks)))
    expect(three).toHaveLength(3)
    expect(three.map((s) => s.task.id)).not.toContain('o1')
  })
})
