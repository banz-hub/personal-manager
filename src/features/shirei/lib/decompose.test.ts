import { describe, expect, it } from 'vitest'
import type { Task, TaskRepeat } from '../types'
import { childProgress, decompose, evenSteps, stepsFromText, suggestTemplates } from './decompose'
import { nextDate, nextOccurrence, occursOn, repeatLabel } from './repeat'

const NOW = '2026-09-08T00:00:00.000Z'

function task(patch: Partial<Task> & { id: string; title: string }): Task {
  return {
    area: 'math',
    status: 'todo',
    estimateMin: 100,
    importance: 2,
    createdAt: NOW,
    ...patch,
  }
}

describe('ひな形の選び方', () => {
  it('題名に手がかりがあれば、それを先に勧める', () => {
    expect(suggestTemplates('線形代数のレポート', 'math')[0].id).toBe('report')
    expect(suggestTemplates('複素解析学B 期末試験', 'math')[0].id).toBe('exam')
    expect(suggestTemplates('A社のES', 'jobhunt')[0].id).toBe('es')
    expect(suggestTemplates('ゼミ発表', 'math')[0].id).toBe('presentation')
  })

  it('手がかりが無くても、分野に合うものは出す', () => {
    const out = suggestTemplates('なにか', 'jobhunt')
    expect(out.map((t) => t.id)).toContain('es')
  })

  it('どのひな形も、合計が全体の1になる', () => {
    for (const t of suggestTemplates('レポート', 'math')) {
      const total = t.steps.reduce((sum, s) => sum + s.share, 0)
      expect(total).toBeCloseTo(1)
    }
  })
})

describe('自由に書いた手順', () => {
  it('1行1つとして読み、記号は落とす', () => {
    const steps = stepsFromText('- 資料集め\n2. 下書き\n・清書')
    expect(steps.map((s) => s.title)).toEqual(['資料集め', '下書き', '清書'])
    expect(steps[0].share).toBeCloseTo(1 / 3)
  })

  it('空なら何も作らない', () => {
    expect(stepsFromText('  \n \n')).toHaveLength(0)
  })
})

describe('均等に割る', () => {
  it('指定した数に割る', () => {
    expect(evenSteps(4)).toHaveLength(4)
    expect(evenSteps(4)[0].share).toBe(0.25)
  })

  it('少なすぎ・多すぎは丸める', () => {
    expect(evenSteps(1)).toHaveLength(2)
    expect(evenSteps(50)).toHaveLength(10)
  })
})

describe('分解', () => {
  const parent = () =>
    task({ id: 'p', title: '線形代数のレポート', estimateMin: 300, dueDate: '2026-09-20', dueTime: '23:59' })

  it('見積もりを割合で配る', () => {
    const { children } = decompose(parent(), suggestTemplates('レポート', 'math')[0].steps, NOW)
    const total = children.reduce((sum, c) => sum + c.estimateMin, 0)
    // 5分刻みの丸めぶんだけ誤差が出る
    expect(total).toBeGreaterThan(280)
    expect(total).toBeLessThan(320)
  })

  it('最後の手順が親の締切。手前は1日ずつ前倒しになる', () => {
    const { children } = decompose(parent(), suggestTemplates('レポート', 'math')[0].steps, NOW)
    expect(children.at(-1)!.dueDate).toBe('2026-09-20')
    expect(children.at(-1)!.dueTime).toBe('23:59')
    expect(children.at(-2)!.dueDate).toBe('2026-09-19')
    expect(children[0].dueDate).toBe('2026-09-15')
  })

  it('締切の時刻は最後の手順にだけ付く', () => {
    const { children } = decompose(parent(), evenSteps(3), NOW)
    expect(children[0].dueTime).toBeUndefined()
    expect(children[1].dueTime).toBeUndefined()
    expect(children[2].dueTime).toBe('23:59')
  })

  it('親を紐づけ、分野を引き継ぐ', () => {
    const { children } = decompose(parent(), evenSteps(2), NOW)
    for (const c of children) {
      expect(c.parentId).toBe('p')
      expect(c.area).toBe('math')
      expect(c.title.startsWith('線形代数のレポート — ')).toBe(true)
    }
  })

  it('親は消さずに残す。何をまとめていたか分からなくなるため', () => {
    const { parent: next } = decompose(parent(), evenSteps(2), NOW)
    expect(next.id).toBe('p')
    expect(next.estimateMin).toBe(5)
    expect(next.note).toContain('分解済み')
  })

  it('締切が無い親でも割れる', () => {
    const { children } = decompose(task({ id: 'p', title: 'A' }), evenSteps(2), NOW)
    expect(children[0].dueDate).toBeUndefined()
  })

  it('進み具合を数えられる', () => {
    const p = task({ id: 'p', title: 'P' })
    const all = [
      p,
      task({ id: 'c1', title: 'C1', parentId: 'p', status: 'done' }),
      task({ id: 'c2', title: 'C2', parentId: 'p' }),
      task({ id: 'other', title: 'X' }),
    ]
    expect(childProgress(p, all)).toEqual({ done: 1, total: 2 })
  })
})

describe('繰り返し', () => {
  const weekly = (days: number[]): TaskRepeat => ({ kind: 'weekly', days })

  it('毎日は翌日', () => {
    expect(nextDate({ kind: 'daily' }, '2026-09-08')).toBe('2026-09-09')
  })

  it('毎週は次にその曜日が来る日', () => {
    // 2026-09-08 は火曜。次の月曜は 9/14
    expect(nextDate(weekly([1]), '2026-09-08')).toBe('2026-09-14')
    // 木曜は 9/10
    expect(nextDate(weekly([4]), '2026-09-08')).toBe('2026-09-10')
  })

  it('複数の曜日なら、いちばん近い日', () => {
    expect(nextDate(weekly([1, 4]), '2026-09-08')).toBe('2026-09-10')
  })

  it('曜日を選んでいなければ作らない', () => {
    expect(nextDate(weekly([]), '2026-09-08')).toBeNull()
  })

  it('毎月は次の月の同じ日', () => {
    expect(nextDate({ kind: 'monthly', dayOfMonth: 15 }, '2026-09-08')).toBe('2026-09-15')
    expect(nextDate({ kind: 'monthly', dayOfMonth: 5 }, '2026-09-08')).toBe('2026-10-05')
  })

  it('その月に無い日は、月末に寄せる', () => {
    // 2027-02 は 28 日まで
    expect(nextDate({ kind: 'monthly', dayOfMonth: 31 }, '2027-01-31')).toBe('2027-02-28')
  })

  it('終えたら次の回が生まれ、実績は引き継がない', () => {
    const t = task({
      id: 'p',
      title: '週報',
      dueDate: '2026-09-14',
      repeat: weekly([1]),
      deferCount: 3,
      status: 'done',
      doneAt: 'x',
    })
    const next = nextOccurrence(t, '2026-09-14', NOW)!

    expect(next.id).not.toBe('p')
    expect(next.dueDate).toBe('2026-09-21')
    expect(next.status).toBe('todo')
    expect(next.deferCount).toBeUndefined()
    expect(next.doneAt).toBeUndefined()
    expect(next.title).toBe('週報')
  })

  it('繰り返しでないタスクは次の回を作らない', () => {
    expect(nextOccurrence(task({ id: 'a', title: 'A' }), '2026-09-08', NOW)).toBeNull()
  })

  it('その日が繰り返しの日かを判定できる', () => {
    // 2026-09-14 は月曜
    expect(occursOn(weekly([1]), '2026-09-14')).toBe(true)
    expect(occursOn(weekly([1]), '2026-09-15')).toBe(false)
    expect(occursOn({ kind: 'daily' }, '2026-09-15')).toBe(true)
  })

  it('読める名前になる', () => {
    expect(repeatLabel(weekly([1, 5]))).toBe('毎週月・金')
    expect(repeatLabel({ kind: 'monthly', dayOfMonth: 10 })).toBe('毎月10日')
    expect(repeatLabel({ kind: 'daily' })).toBe('毎日')
  })
})
