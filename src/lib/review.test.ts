import { describe, expect, it } from 'vitest'
import type { DayPlan, StudyNode, StudySession, Task, TaskLog } from '../types'
import { buildReview, carryOver, completeStudy, completeWork } from './review'

const TODAY = '2026-09-07'

function task(patch: Partial<Task> & { id: string; title: string }): Task {
  return {
    area: 'math',
    status: 'todo',
    estimateMin: 60,
    importance: 2,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...patch,
  }
}

function planWith(taskIds: string[]): DayPlan {
  return {
    id: TODAY,
    date: TODAY,
    blocks: taskIds.map((id, i) => ({
      id: `b${i}`,
      start: `${String(18 + i).padStart(2, '0')}:00`,
      end: `${String(19 + i).padStart(2, '0')}:00`,
      kind: 'task' as const,
      taskId: id,
      title: id,
    })),
    generatedAt: '',
    freeMin: 300,
    fillRatio: 0.6,
    notes: [],
  }
}

function log(patch: Partial<TaskLog> & { taskId: string }): TaskLog {
  return {
    id: `l_${patch.taskId}`,
    date: TODAY,
    area: 'math',
    plannedMin: 60,
    actualMin: 60,
    createdAt: '',
    ...patch,
  }
}

describe('完了の記録', () => {
  it('ふつうのタスクは完了になり、実績がログに残る', () => {
    const t = task({ id: 'a', title: '数学課題', estimateMin: 60 })
    const { task: next, log: l } = completeWork(t, 75, 60, TODAY, true)

    expect(next.status).toBe('done')
    expect(next.doneAt).toBeTruthy()
    expect(next.lastWorkedOn).toBe(TODAY)
    expect(l.plannedMin).toBe(60)
    expect(l.actualMin).toBe(75)
  })

  it('長期タスクは1回やっても完了にならず、残りが減る', () => {
    const t = task({ id: 'b', title: '公務員試験', estimateMin: 30_000, chunkMin: 30 })
    const { task: next } = completeWork(t, 30, 30, TODAY, false)

    expect(next.status).toBe('doing')
    expect(next.estimateMin).toBe(29_970)
    expect(next.lastWorkedOn).toBe(TODAY)
  })

  it('継続タスクは残りを減らさない', () => {
    const t = task({ id: 'c', title: '英語', estimateMin: 600, chunkMin: 20, recurring: true })
    const { task: next } = completeWork(t, 20, 20, TODAY, false)

    expect(next.estimateMin).toBe(600)
    expect(next.status).toBe('doing')
  })

  it('途中でも「完了にする」を選べば完了になる', () => {
    const t = task({ id: 'd', title: '長いやつ', estimateMin: 30_000, chunkMin: 30 })
    expect(completeWork(t, 30, 30, TODAY, true).task.status).toBe('done')
  })
})

describe('未完了の繰越', () => {
  it('予定に入っていて終わらなかったタスクは先送り回数が増える', () => {
    const tasks = [
      task({ id: 'done', title: '終わった', status: 'done' }),
      task({ id: 'left', title: '残った' }),
      task({ id: 'unplanned', title: '予定外' }),
    ]
    const { tasks: next, carried } = carryOver(tasks, planWith(['done', 'left']), TODAY)

    expect(carried).toEqual(['left'])
    expect(next.find((t) => t.id === 'left')?.deferCount).toBe(1)
    expect(next.find((t) => t.id === 'done')?.deferCount).toBeUndefined()
    expect(next.find((t) => t.id === 'unplanned')?.deferCount).toBeUndefined()
  })

  it('締切は勝手に動かさない', () => {
    const tasks = [task({ id: 'left', title: '残った', dueDate: '2026-09-09' })]
    const { tasks: next } = carryOver(tasks, planWith(['left']), TODAY)
    expect(next[0].dueDate).toBe('2026-09-09')
  })

  it('同じ日に2回繰り越しても二重に数えない', () => {
    const tasks = [task({ id: 'left', title: '残った' })]
    const once = carryOver(tasks, planWith(['left']), TODAY)
    const twice = carryOver(once.tasks, planWith(['left']), TODAY)

    expect(twice.carried).toEqual([])
    expect(twice.tasks[0].deferCount).toBe(1)
  })
})

describe('日次レビュー', () => {
  it('完了・未完了・実績時間を集計する', () => {
    const tasks = [
      task({ id: 'a', title: 'A', status: 'done' }),
      task({ id: 'b', title: 'B' }),
    ]
    const r = buildReview({
      date: TODAY,
      plan: planWith(['a', 'b']),
      tasks,
      logs: [log({ taskId: 'a', actualMin: 75 })],
      nodes: [],
      sessions: [],
    })

    expect(r.doneTaskIds).toEqual(['a'])
    expect(r.undoneTaskIds).toEqual(['b'])
    expect(r.plannedMin).toBe(120)
    expect(r.actualMin).toBe(75)
  })

  it('手をつけなかったタスクだけを繰越候補として挙げる', () => {
    const tasks = [
      task({ id: 'a', title: '途中まで' }),
      task({ id: 'b', title: '手つかず' }),
    ]
    const r = buildReview({
      date: TODAY,
      plan: planWith(['a', 'b']),
      tasks,
      logs: [log({ taskId: 'a', actualMin: 30 })],
      nodes: [],
      sessions: [],
    })

    expect(r.deferredTaskIds).toEqual(['b'])
    expect(r.findings.join()).toContain('手つかず')
  })

  it('見積もりを大きく超えたタスクを名指しで挙げる', () => {
    const tasks = [task({ id: 'a', title: '数学課題', status: 'done' })]
    const r = buildReview({
      date: TODAY,
      plan: planWith(['a']),
      tasks,
      logs: [log({ taskId: 'a', plannedMin: 60, actualMin: 90 })],
      nodes: [],
      sessions: [],
    })

    expect(r.findings.join()).toContain('数学課題')
    expect(r.findings.join()).toContain('次回の見積もり')
  })

  it('実績が予定の半分以下なら、詰め込みすぎを疑う所見を出す', () => {
    const tasks = [
      task({ id: 'a', title: 'A', status: 'done' }),
      task({ id: 'b', title: 'B' }),
      task({ id: 'c', title: 'C' }),
    ]
    const r = buildReview({
      date: TODAY,
      plan: planWith(['a', 'b', 'c']),
      tasks,
      logs: [log({ taskId: 'a', plannedMin: 60, actualMin: 20 })],
      nodes: [],
      sessions: [],
    })

    expect(r.findings.join()).toContain('上位3件に絞る')
  })

  it('全部終わったら、その旨を返す', () => {
    const tasks = [task({ id: 'a', title: 'A', status: 'done' })]
    const r = buildReview({
      date: TODAY,
      plan: planWith(['a']),
      tasks,
      logs: [log({ taskId: 'a' })],
      nodes: [],
      sessions: [],
    })
    expect(r.findings[0]).toContain('すべて終えました')
  })

  it('予定を作っていない日は、その案内だけを返す', () => {
    const r = buildReview({ date: TODAY, plan: undefined, tasks: [], logs: [], nodes: [], sessions: [] })
    expect(r.findings.join()).toContain('予定を作っていません')
  })

  it('分野ごとの内訳を出す', () => {
    const tasks = [task({ id: 'a', title: 'A', status: 'done' })]
    const r = buildReview({
      date: TODAY,
      plan: planWith(['a']),
      tasks,
      logs: [log({ taskId: 'a', area: 'math', actualMin: 60 }), log({ taskId: 'a', area: 'english', actualMin: 20 })],
      nodes: [],
      sessions: [],
    })
    expect(r.findings.join()).toContain('数学 1時間')
    expect(r.findings.join()).toContain('英語 20分')
  })
})

describe('学習も含めたレビュー', () => {
  const nodes: StudyNode[] = [
    { id: 'math', title: '数学', area: 'math', importance: 2, estimateMin: 0, order: 0, createdAt: '' },
    { id: 'open', title: '開集合', parentId: 'math', importance: 2, estimateMin: 60, order: 0, createdAt: '' },
    { id: 'closed', title: '閉集合', parentId: 'math', importance: 2, estimateMin: 60, order: 1, createdAt: '' },
  ]

  function planWithStudy(taskIds: string[], nodeIds: string[]): DayPlan {
    const base = planWith(taskIds)
    return {
      ...base,
      blocks: [
        ...base.blocks,
        ...nodeIds.map((id, i) => ({
          id: `s${i}`,
          start: `${String(20 + i).padStart(2, '0')}:00`,
          end: `${String(20 + i).padStart(2, '0')}:30`,
          kind: 'study' as const,
          nodeId: id,
          title: id,
        })),
      ],
    }
  }

  function ses(patch: Partial<StudySession> & { nodeId: string }): StudySession {
    return { id: `s_${patch.nodeId}`, date: TODAY, minutes: 30, createdAt: '', ...patch }
  }

  it('学習の予定と記録を突き合わせる', () => {
    const r = buildReview({
      date: TODAY,
      plan: planWithStudy([], ['open', 'closed']),
      tasks: [],
      logs: [],
      nodes,
      sessions: [ses({ nodeId: 'open' })],
    })

    expect(r.doneNodeIds).toEqual(['open'])
    expect(r.undoneNodeIds).toEqual(['closed'])
    expect(r.studyMin).toBe(30)
    expect(r.findings.join()).toContain('閉集合')
  })

  it('学習時間が実績と内訳に入る', () => {
    const r = buildReview({
      date: TODAY,
      plan: planWithStudy(['a'], ['open']),
      tasks: [task({ id: 'a', title: 'A', status: 'done' })],
      logs: [log({ taskId: 'a', area: 'english', actualMin: 20 })],
      nodes,
      sessions: [ses({ nodeId: 'open', minutes: 45 })],
    })

    expect(r.actualMin).toBe(65)
    expect(r.studyMin).toBe(45)
    expect(r.findings.join()).toContain('数学 45分')
    expect(r.findings.join()).toContain('英語 20分')
  })

  it('理解度が進んだ項目を挙げる', () => {
    const r = buildReview({
      date: TODAY,
      plan: planWithStudy([], ['open']),
      tasks: [],
      logs: [],
      nodes,
      sessions: [ses({ nodeId: 'open', mastery: 'mastered' })],
    })
    expect(r.findings.join()).toContain('開集合→習得')
  })

  it('正答率が低かった項目は、復習に回す案内を出す', () => {
    const r = buildReview({
      date: TODAY,
      plan: planWithStudy([], ['open']),
      tasks: [],
      logs: [],
      nodes,
      sessions: [ses({ nodeId: 'open', correct: 3, attempted: 10 })],
    })
    expect(r.findings.join()).toContain('正答率は30%')
    expect(r.findings.join()).toContain('要復習')
  })

  it('学習だけの日でも完了率を数える', () => {
    const r = buildReview({
      date: TODAY,
      plan: planWithStudy([], ['open', 'closed']),
      tasks: [],
      logs: [],
      nodes,
      sessions: [ses({ nodeId: 'open' }), ses({ nodeId: 'closed' })],
    })
    expect(r.findings[0]).toContain('2件をすべて終えました')
  })
})

describe('学習の完了記録', () => {
  const node: StudyNode = {
    id: 'open',
    title: '開集合',
    importance: 2,
    estimateMin: 60,
    order: 0,
    createdAt: '',
  }

  it('手応えを選べば理解度が変わる', () => {
    const { node: next, session } = completeStudy(node, 30, TODAY, 'understood')
    expect(next.mastery).toBe('understood')
    expect(session.minutes).toBe(30)
    expect(session.date).toBe(TODAY)
  })

  it('手応えを選ばなければ理解度は変えない', () => {
    const { node: next } = completeStudy(node, 30, TODAY)
    expect(next.mastery).toBeUndefined()
  })

  it('正答数を残せる', () => {
    const { session } = completeStudy(node, 30, TODAY, 'learning', { correct: 7, attempted: 10 })
    expect(session.correct).toBe(7)
    expect(session.attempted).toBe(10)
  })
})
