import { describe, expect, it } from 'vitest'
import type { Exam, Mastery, StudyNode, StudySession } from '../types'
import {
  allLeaves,
  areaOf,
  ATTENTION_CAP,
  canMoveTo,
  moveNode,
  moveTargets,
  buildExamPlan,
  buildProgress,
  childrenOf,
  isLeaf,
  leavesOf,
  pathLabel,
  rankStudy,
  recentDailyStudyMin,
  staleLeaves,
  summarizeMastery,
  withDescendants,
  type RankStudyInput,
} from './study'

const TODAY = '2026-09-07'

function node(patch: Partial<StudyNode> & { id: string; title: string }): StudyNode {
  return {
    importance: 2,
    estimateMin: 60,
    order: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...patch,
  }
}

/** 仕様書の例そのまま: 数学 → 位相空間論 → 開集合 / 閉集合 / 連結性 / コンパクト性 */
function topologyTree(): StudyNode[] {
  return [
    node({ id: 'math', title: '数学', area: 'math' }),
    node({ id: 'topo', title: '位相空間論', parentId: 'math' }),
    node({ id: 'open', title: '開集合', parentId: 'topo', order: 0 }),
    node({ id: 'closed', title: '閉集合', parentId: 'topo', order: 1 }),
    node({ id: 'conn', title: '連結性', parentId: 'topo', order: 2 }),
    node({ id: 'compact', title: 'コンパクト性', parentId: 'topo', order: 3 }),
  ]
}

function session(patch: Partial<StudySession> & { nodeId: string; date: string }): StudySession {
  return { id: `s_${patch.nodeId}_${patch.date}`, minutes: 30, createdAt: '', ...patch }
}

function rankInput(nodes: StudyNode[], patch: Partial<RankStudyInput> = {}): RankStudyInput {
  return { nodes, exams: [], sessions: [], today: TODAY, chunkMin: 30, ...patch }
}

describe('階層', () => {
  const nodes = topologyTree()

  it('段数を決め打ちせずに親子をたどれる', () => {
    expect(childrenOf(nodes, 'math').map((n) => n.id)).toEqual(['topo'])
    expect(childrenOf(nodes, 'topo').map((n) => n.id)).toEqual(['open', 'closed', 'conn', 'compact'])
  })

  it('子を持たないものが学習項目 (葉) になる', () => {
    expect(isLeaf(nodes, nodes.find((n) => n.id === 'topo')!)).toBe(false)
    expect(isLeaf(nodes, nodes.find((n) => n.id === 'open')!)).toBe(true)
    expect(allLeaves(nodes).map((n) => n.id)).toEqual(['open', 'closed', 'conn', 'compact'])
  })

  it('科目の配下の葉をまとめて取れる', () => {
    expect(leavesOf(nodes, 'math')).toHaveLength(4)
    expect(withDescendants(nodes, 'math')).toHaveLength(6)
  })

  it('どこにある項目かを道すじで示せる', () => {
    expect(pathLabel(nodes, 'open')).toBe('数学 / 位相空間論')
  })

  it('分野は科目から受け継ぐ', () => {
    expect(areaOf(nodes, 'open')).toBe('math')
  })

  it('親子の指定が輪になっていても止まる', () => {
    const broken = [
      node({ id: 'a', title: 'A', parentId: 'b' }),
      node({ id: 'b', title: 'B', parentId: 'a' }),
    ]
    expect(withDescendants(broken, 'a').length).toBeLessThanOrEqual(2)
    expect(pathLabel(broken, 'a').length).toBeGreaterThanOrEqual(0)
  })

  it('4段でも2段でも同じように扱える', () => {
    const deep = [
      node({ id: 'r', title: '教職', area: 'teaching' }),
      node({ id: 'u', title: '教育心理', parentId: 'r' }),
      node({ id: 't', title: '発達段階', parentId: 'u' }),
      node({ id: 'i', title: 'ピアジェ', parentId: 't' }),
    ]
    expect(allLeaves(deep).map((n) => n.id)).toEqual(['i'])
    expect(pathLabel(deep, 'i')).toBe('教職 / 教育心理 / 発達段階')
  })
})

describe('進捗の集計', () => {
  const nodes = topologyTree()

  it('学習時間・復習回数・最終学習日を記録から出す', () => {
    const sessions = [
      session({ nodeId: 'open', date: '2026-09-01', minutes: 40 }),
      session({ nodeId: 'open', date: '2026-09-04', minutes: 20 }),
      session({ nodeId: 'open', date: '2026-09-05', minutes: 30 }),
    ]
    const p = buildProgress(nodes, sessions, TODAY).get('open')!

    expect(p.totalMin).toBe(90)
    expect(p.sessionCount).toBe(3)
    expect(p.reviewCount).toBe(2)
    expect(p.lastStudiedOn).toBe('2026-09-05')
    expect(p.staleDays).toBe(2)
  })

  it('親には配下の記録が合算される', () => {
    const sessions = [
      session({ nodeId: 'open', date: '2026-09-05', minutes: 30 }),
      session({ nodeId: 'closed', date: '2026-09-06', minutes: 45 }),
    ]
    const p = buildProgress(nodes, sessions, TODAY)
    expect(p.get('topo')!.totalMin).toBe(75)
    expect(p.get('math')!.totalMin).toBe(75)
  })

  it('正答率を出す。解いていなければ null', () => {
    const sessions = [
      session({ nodeId: 'open', date: '2026-09-05', correct: 6, attempted: 10 }),
      session({ nodeId: 'open', date: '2026-09-06', correct: 8, attempted: 10 }),
    ]
    const p = buildProgress(nodes, sessions, TODAY)
    expect(p.get('open')!.accuracy).toBeCloseTo(0.7)
    expect(p.get('closed')!.accuracy).toBeNull()
  })

  it('理解度に応じて次の復習日が決まる', () => {
    const withMastery = nodes.map((n) =>
      n.id === 'open' ? { ...n, mastery: 'understood' as Mastery } : n,
    )
    const p = buildProgress(withMastery, [session({ nodeId: 'open', date: '2026-09-05' })], TODAY)
    // 理解 = 5日後
    expect(p.get('open')!.nextReviewOn).toBe('2026-09-10')
  })

  it('未学習は復習の予定日を持たない', () => {
    const p = buildProgress(nodes, [session({ nodeId: 'open', date: '2026-09-05' })], TODAY)
    expect(p.get('open')!.nextReviewOn).toBeUndefined()
  })

  it('一度もやっていなければ経過日数は無し', () => {
    expect(buildProgress(nodes, [], TODAY).get('open')!.staleDays).toBeNull()
  })
})

describe('最近やっていないものの検出', () => {
  it('しばらく空いた項目を、空いた順に挙げる', () => {
    const nodes = topologyTree().map((n) =>
      ['open', 'closed', 'conn'].includes(n.id) ? { ...n, mastery: 'learning' as Mastery } : n,
    )
    const sessions = [
      session({ nodeId: 'open', date: '2026-08-20' }),
      session({ nodeId: 'closed', date: '2026-08-28' }),
      session({ nodeId: 'conn', date: '2026-09-06' }),
    ]
    const p = buildProgress(nodes, sessions, TODAY)
    expect(staleLeaves(nodes, p).map((n) => n.id)).toEqual(['open', 'closed'])
  })

  it('未学習と習得済みは対象にしない', () => {
    const nodes = topologyTree().map((n) =>
      n.id === 'open' ? { ...n, mastery: 'mastered' as Mastery } : n,
    )
    const p = buildProgress(nodes, [session({ nodeId: 'open', date: '2026-08-01' })], TODAY)
    expect(staleLeaves(nodes, p)).toHaveLength(0)
  })
})

describe('理解度の集計', () => {
  it('項目ごとの状態を数え、進み具合を出す', () => {
    const leaves = [
      node({ id: 'a', title: 'A', mastery: 'mastered' }),
      node({ id: 'b', title: 'B', mastery: 'mastered' }),
      node({ id: 'c', title: 'C', mastery: 'new' }),
      node({ id: 'd', title: 'D', mastery: 'learning' }),
    ]
    const s = summarizeMastery(leaves)
    expect(s.total).toBe(4)
    expect(s.counts.mastered).toBe(2)
    expect(s.counts.new).toBe(1)
    // (1 + 1 + 0 + 0.3) / 4
    expect(s.progress).toBeCloseTo(0.575)
  })
})

describe('試験からの逆算', () => {
  function examOn(date: string, scope = ['topo']): Exam {
    return {
      id: 'e1',
      title: '位相空間論 期末',
      date,
      scopeNodeIds: scope,
      importance: 3,
      createdAt: '',
    }
  }

  it('残り日数と必要学習時間から1日あたりを出す', () => {
    // 4項目 × 60分がすべて未学習 = 240分。10日後の試験
    const plan = buildExamPlan(examOn('2026-09-17'), topologyTree(), [], TODAY)
    expect(plan.daysLeft).toBe(10)
    expect(plan.requiredMin).toBe(240)
    expect(plan.perDayMin).toBe(24)
    expect(plan.findings.join()).toContain('試験まであと10日')
  })

  it('理解が進んでいる項目は必要時間が減る', () => {
    const nodes = topologyTree().map((n) =>
      n.id === 'open' ? { ...n, mastery: 'mastered' as Mastery } : n,
    )
    // 習得の1項目ぶん60分が丸ごと減る
    expect(buildExamPlan(examOn('2026-09-17'), nodes, [], TODAY).requiredMin).toBe(180)
  })

  it('全部習得済みなら、維持だけでよいと言う', () => {
    const nodes = topologyTree().map((n) =>
      n.parentId === 'topo' ? { ...n, mastery: 'mastered' as Mastery } : n,
    )
    const plan = buildExamPlan(examOn('2026-09-17'), nodes, [], TODAY)
    expect(plan.requiredMin).toBe(0)
    expect(plan.findings.join()).toContain('すべて習得済み')
  })

  it('今のペースで間に合わないなら、そう言う', () => {
    // 3日後に240分必要 = 1日80分。実績は1日10分ほど
    const sessions = [session({ nodeId: 'open', date: '2026-09-06', minutes: 140 })]
    const plan = buildExamPlan(examOn('2026-09-10'), topologyTree(), sessions, TODAY)
    expect(plan.findings.join()).toContain('間に合わない')
  })

  it('直前は弱点復習を優先する段階になる', () => {
    const plan = buildExamPlan(examOn('2026-09-09'), topologyTree(), [], TODAY)
    expect(plan.reviewPhase).toBe(true)
    expect(plan.findings.join()).toContain('弱点の復習を優先')
  })

  it('まだ先の試験は直前扱いにしない', () => {
    expect(buildExamPlan(examOn('2026-09-20'), topologyTree(), [], TODAY).reviewPhase).toBe(false)
  })

  it('範囲が空なら、その旨だけ返す', () => {
    const plan = buildExamPlan(examOn('2026-09-17', []), topologyTree(), [], TODAY)
    expect(plan.findings.join()).toContain('試験範囲が未設定')
  })

  it('過ぎた試験は逆算しない', () => {
    expect(buildExamPlan(examOn('2026-09-01'), topologyTree(), [], TODAY).findings.join()).toContain(
      '過ぎています',
    )
  })

  it('直近の学習ペースを日あたりで出す', () => {
    const sessions = [
      session({ nodeId: 'open', date: '2026-09-06', minutes: 70 }),
      session({ nodeId: 'open', date: '2026-09-07', minutes: 70 }),
    ]
    // 140分 / 14日 = 10分
    expect(recentDailyStudyMin(sessions, TODAY)).toBe(10)
  })
})

describe('学習の優先順位', () => {
  const exam = (date: string, scope = ['topo']): Exam => ({
    id: 'e1',
    title: '期末',
    date,
    scopeNodeIds: scope,
    importance: 3,
    createdAt: '',
  })

  it('試験が近く、理解度が低く、重要な範囲がいちばん上に来る', () => {
    const nodes = topologyTree().map((n) => {
      if (n.id === 'open') return { ...n, mastery: 'needs-review' as Mastery, importance: 3 as const }
      if (n.id === 'closed') return { ...n, mastery: 'mastered' as Mastery }
      return n
    })
    const ranked = rankStudy(rankInput(nodes, { exams: [exam('2026-09-09')] }))
    expect(ranked[0].node.id).toBe('open')
    expect(ranked[0].reasons).toContain('要復習になっている')
    expect(ranked[0].reasons).toContain('試験まであと2日')
    expect(ranked[0].reasons).toContain('重要な範囲')
  })

  it('復習の予定日を過ぎたものは上がる', () => {
    const nodes = topologyTree().map((n) =>
      n.id === 'conn' ? { ...n, mastery: 'learning' as Mastery } : n,
    )
    // 学習中 = 2日間隔。9/3 にやったので 9/5 が予定日 → 過ぎている
    const sessions = [session({ nodeId: 'conn', date: '2026-09-03' })]
    const ranked = rankStudy(rankInput(nodes, { sessions }))
    const conn = ranked.find((s) => s.node.id === 'conn')!
    expect(conn.reviewDue).toBe(true)
    expect(conn.reasons).toContain('復習の予定日を過ぎている')
  })

  it('正答率が低い項目は上がる。数が少ないうちは効かせない', () => {
    const nodes = topologyTree().map((n) =>
      ['open', 'closed'].includes(n.id) ? { ...n, mastery: 'learning' as Mastery } : n,
    )
    const sessions = [
      session({ nodeId: 'open', date: '2026-09-06', correct: 2, attempted: 10 }),
      session({ nodeId: 'closed', date: '2026-09-06', correct: 1, attempted: 3 }),
    ]
    const ranked = rankStudy(rankInput(nodes, { sessions }))
    expect(ranked.find((s) => s.node.id === 'open')!.reasons.join()).toContain('正答率20%')
    expect(ranked.find((s) => s.node.id === 'closed')!.reasons.join()).not.toContain('正答率')
  })

  it('試験直前は、未学習より復習を優先する', () => {
    const nodes = topologyTree().map((n) => {
      if (n.id === 'open') return { ...n, mastery: 'new' as Mastery }
      if (n.id === 'closed') return { ...n, mastery: 'needs-review' as Mastery }
      return n
    })
    const ranked = rankStudy(rankInput(nodes, { exams: [exam('2026-09-08')] }))
    const openIdx = ranked.findIndex((s) => s.node.id === 'open')
    const closedIdx = ranked.findIndex((s) => s.node.id === 'closed')

    expect(closedIdx).toBeLessThan(openIdx)
    expect(ranked[openIdx].reasons.join()).toContain('新しい範囲より復習を優先')
  })

  it('試験まで余裕があれば未学習を後回しにしない', () => {
    const nodes = topologyTree().map((n) =>
      n.id === 'open' ? { ...n, mastery: 'new' as Mastery } : n,
    )
    const ranked = rankStudy(rankInput(nodes, { exams: [exam('2026-10-30')] }))
    expect(ranked.find((s) => s.node.id === 'open')!.reasons.join()).not.toContain('復習を優先')
  })

  it('習得済みは、復習の日でなければ今日の候補から外れる', () => {
    const nodes = topologyTree().map((n) =>
      n.parentId === 'topo' ? { ...n, mastery: 'mastered' as Mastery } : n,
    )
    expect(rankStudy(rankInput(nodes))).toHaveLength(0)
  })

  it('習得済みでも復習の日が来ていれば候補に残る', () => {
    const nodes = topologyTree().map((n) =>
      n.id === 'open' ? { ...n, mastery: 'mastered' as Mastery } : n,
    )
    // 習得 = 14日間隔。8/1 にやったのでとっくに過ぎている
    const sessions = [session({ nodeId: 'open', date: '2026-08-01' })]
    const ranked = rankStudy(rankInput(nodes, { sessions }))
    expect(ranked.some((s) => s.node.id === 'open')).toBe(true)
  })

  it('1回に充てる時間は上限で頭打ちにする', () => {
    const nodes = topologyTree().map((n) =>
      n.id === 'open' ? { ...n, estimateMin: 600 } : n,
    )
    expect(rankStudy(rankInput(nodes, { chunkMin: 30 }))[0].todayMin).toBeLessThanOrEqual(30)
  })

  it('理解が進んだ項目は1回の時間が短くなる', () => {
    const nodes = topologyTree().map((n) =>
      n.id === 'open' ? { ...n, mastery: 'understood' as Mastery, estimateMin: 60 } : n,
    )
    // 60分 × 0.35 = 21分 → 5分刻みで20分
    const open = rankStudy(rankInput(nodes, { chunkMin: 60 })).find((s) => s.node.id === 'open')!
    expect(open.todayMin).toBe(20)
  })

  it('同じ入力なら毎回同じ順序になる', () => {
    const nodes = topologyTree()
    const a = rankStudy(rankInput(nodes)).map((s) => s.node.id)
    const b = rankStudy(rankInput([...nodes].reverse())).map((s) => s.node.id)
    expect(a).toEqual(b)
  })

  it('学習項目が無ければ、その案内を返す', () => {
    expect(rankStudy(rankInput([]))).toHaveLength(0)
  })
})

describe('重複加算を防ぐ', () => {
  it('復習期日超過・放置・低正答率が重なっても、加点は上限で止まる', () => {
    const nodes = topologyTree().map((n) =>
      n.id === 'open' ? { ...n, mastery: 'needs-review' as Mastery } : n,
    )
    // 3つとも立つ状態: 要復習(1日間隔)を20日放置、正答率20%
    const all = [
      session({ nodeId: 'open', date: '2026-08-18', correct: 2, attempted: 10 }),
    ]
    // 1つだけ立つ状態: 期日は過ぎているが、放置日数も正答率も条件を満たさない
    const oneOnly = [session({ nodeId: 'open', date: '2026-09-05' })]

    const withAll = rankStudy(rankInput(nodes, { sessions: all }))[0]
    const withOne = rankStudy(rankInput(nodes, { sessions: oneOnly }))[0]

    expect(withAll.reasons.length).toBeGreaterThan(withOne.reasons.length)
    // 35 + 20 + 25 = 80 ではなく、上限の 45 で止まる
    expect(withAll.score - withOne.score).toBe(ATTENTION_CAP - 35)
  })

  it('弱っている学習項目が、締切の近いタスクを押しのけるほどにはならない', () => {
    const nodes = topologyTree().map((n) =>
      n.id === 'open'
        ? { ...n, mastery: 'needs-review' as Mastery, importance: 3 as const }
        : n,
    )
    const sessions = [session({ nodeId: 'open', date: '2026-08-18', correct: 2, attempted: 10 })]
    // 試験は43日先。それでも上限が無いと 200 を超えてしまっていた
    const exams: Exam[] = [
      { id: 'e', title: '中間', date: '2026-10-20', scopeNodeIds: ['topo'], importance: 3, createdAt: '' },
    ]
    const top = rankStudy(rankInput(nodes, { sessions, exams }))[0]

    expect(top.score).toBeLessThan(180)
  })
})

describe('親の付け替え', () => {
  const tree = (): StudyNode[] => [
    node({ id: 'math', title: '数学', area: 'math' }),
    node({ id: 'topo', title: '位相空間論', parentId: 'math', order: 0 }),
    node({ id: 'open', title: '開集合', parentId: 'topo', order: 0 }),
    node({ id: 'closed', title: '閉集合', parentId: 'topo', order: 1 }),
    node({ id: 'cert', title: '資格', area: 'cert', order: 1 }),
  ]

  it('別の親の下へ動かせる', () => {
    const next = moveNode(tree(), 'open', 'cert')
    expect(next.find((n) => n.id === 'open')!.parentId).toBe('cert')
  })

  it('自分自身の下には動かせない', () => {
    expect(canMoveTo(tree(), 'topo', 'topo')).toBe(false)
    expect(moveNode(tree(), 'topo', 'topo').find((n) => n.id === 'topo')!.parentId).toBe('math')
  })

  it('自分の配下には動かせない。輪ができてしまうため', () => {
    expect(canMoveTo(tree(), 'topo', 'open')).toBe(false)
    expect(moveNode(tree(), 'topo', 'open').find((n) => n.id === 'topo')!.parentId).toBe('math')
  })

  it('いちばん上（科目）に上げられる', () => {
    const next = moveNode(tree(), 'topo', undefined)
    const moved = next.find((n) => n.id === 'topo')!
    expect(moved.parentId).toBeUndefined()
    // 科目には分野が要るので、元の親から受け継ぐ
    expect(moved.area).toBe('math')
  })

  it('下に入れると分野は持たなくなる。親からたどるため', () => {
    const next = moveNode(tree(), 'cert', 'math')
    expect(next.find((n) => n.id === 'cert')!.area).toBeUndefined()
    expect(areaOf(next, 'cert')).toBe('math')
  })

  it('移動先の末尾に入る', () => {
    const next = moveNode(tree(), 'open', 'math')
    // math の下には topo(0) があるので、open は 1
    expect(next.find((n) => n.id === 'open')!.order).toBe(1)
  })

  it('元いた場所の並びは詰め直される', () => {
    const next = moveNode(tree(), 'open', 'cert')
    // topo に残った closed は 0 になる
    expect(next.find((n) => n.id === 'closed')!.order).toBe(0)
  })

  it('同じ親に動かしても何も変わらない', () => {
    const before = tree()
    expect(moveNode(before, 'open', 'topo')).toBe(before)
  })

  it('付け替え先の候補から、自分と自分の配下は外れる', () => {
    const ids = moveTargets(tree(), 'topo').map((n) => n.id)
    expect(ids).not.toContain('topo')
    expect(ids).not.toContain('open')
    expect(ids).toContain('cert')
  })
})
