import { describe, expect, it } from 'vitest'
import type { Company, SelectionEvent, SelectionStage } from '../types'
import {
  activeCompanies,
  applicationTaskDrafts,
  buildComparison,
  draftsFor,
  groupByUrgency,
  interviewTaskDrafts,
  nextActionFor,
  selectionSummary,
  sortComparison,
  taskFromDraft,
  upcomingSelections,
  urgencyOf,
} from './jobhunt'

const TODAY = '2026-09-08'

function company(patch: Partial<Company> & { id: string; name: string }): Company {
  return {
    stage: 'none',
    interest: 3,
    facts: {},
    ratings: {},
    createdAt: '',
    updatedAt: '',
    ...patch,
  }
}

function event(patch: Partial<SelectionEvent> & { id: string; companyId: string; date: string }): SelectionEvent {
  return { kind: 'es', title: 'ES', createdAt: '', ...patch }
}

describe('締切の近さ', () => {
  it('過ぎ・今日・明日・3日以内・それ以降を分ける', () => {
    expect(urgencyOf(-1)).toBe('overdue')
    expect(urgencyOf(0)).toBe('today')
    expect(urgencyOf(1)).toBe('tomorrow')
    expect(urgencyOf(3)).toBe('soon')
    expect(urgencyOf(4)).toBe('later')
  })

  it('近い順に並べ、期限切れを別のグループに出す', () => {
    const companies = [company({ id: 'a', name: 'A社' }), company({ id: 'b', name: 'B社' })]
    const events = [
      event({ id: '1', companyId: 'a', date: '2026-09-12', kind: 'es' }),
      event({ id: '2', companyId: 'b', date: '2026-09-05', kind: 'briefing' }),
      event({ id: '3', companyId: 'a', date: TODAY, kind: 'interview' }),
    ]

    const list = upcomingSelections(events, companies, TODAY)
    expect(list.map((d) => d.event.id)).toEqual(['2', '3', '1'])

    const g = groupByUrgency(list)
    expect(g.overdue.map((d) => d.event.id)).toEqual(['2'])
    expect(g.today.map((d) => d.event.id)).toEqual(['3'])
    expect(g.later.map((d) => d.event.id)).toEqual(['1'])
  })

  it('済んだ予定は出さない', () => {
    const events = [event({ id: '1', companyId: 'a', date: TODAY, doneAt: 'x' })]
    expect(upcomingSelections(events, [], TODAY)).toHaveLength(0)
  })

  it('同じ日なら時刻の早い順', () => {
    const events = [
      event({ id: 'late', companyId: 'a', date: TODAY, time: '17:00' }),
      event({ id: 'early', companyId: 'a', date: TODAY, time: '09:00' }),
    ]
    expect(upcomingSelections(events, [], TODAY).map((d) => d.event.id)).toEqual(['early', 'late'])
  })

  it('企業が消えていても落ちない', () => {
    const list = upcomingSelections([event({ id: '1', companyId: 'missing', date: TODAY })], [], TODAY)
    expect(list[0].label).toContain('企業未設定')
  })

  it('要約に、いつ・あと何日かが入る', () => {
    const companies = [company({ id: 'a', name: 'DIT' })]
    const list = upcomingSelections(
      [event({ id: '1', companyId: 'a', date: '2026-09-28', kind: 'interview', time: '11:00' })],
      companies,
      TODAY,
    )
    const s = selectionSummary(list[0])
    expect(s).toContain('DIT 面接')
    expect(s).toContain('11:00')
    expect(s).toContain('あと20日')
  })

  it('過ぎた予定は何日前かを言う', () => {
    const list = upcomingSelections([event({ id: '1', companyId: 'a', date: '2026-09-05' })], [], TODAY)
    expect(selectionSummary(list[0])).toContain('3日前に過ぎている')
  })
})

describe('次にやること', () => {
  it('選考段階から決まる', () => {
    expect(nextActionFor(company({ id: 'a', name: 'A', stage: 'none' }))).toContain('企業研究')
    expect(nextActionFor(company({ id: 'a', name: 'A', stage: 'es-draft' }))).toContain('提出')
    expect(nextActionFor(company({ id: 'a', name: 'A', stage: 'interview1' }))).toContain('模擬面接')
  })

  it('終わった選考には出さない', () => {
    for (const stage of ['offer', 'declined', 'rejected'] as SelectionStage[]) {
      expect(nextActionFor(company({ id: 'a', name: 'A', stage }))).toBeNull()
    }
  })

  it('動いている企業だけを取り出せる', () => {
    const list = [
      company({ id: 'a', name: 'A', stage: 'es-draft' }),
      company({ id: 'b', name: 'B', stage: 'offer' }),
      company({ id: 'c', name: 'C', stage: 'rejected' }),
    ]
    expect(activeCompanies(list).map((c) => c.id)).toEqual(['a'])
  })
})

describe('タスクの下書き', () => {
  it('応募の一式を締切から逆算して並べる', () => {
    const drafts = applicationTaskDrafts('2026-09-20')
    expect(drafts).toHaveLength(7)
    expect(drafts[0].title).toBe('企業研究')
    expect(drafts[0].dueDate).toBe('2026-09-13')
    expect(drafts[drafts.length - 1].title).toBe('ESを提出')
    expect(drafts[drafts.length - 1].dueDate).toBe('2026-09-20')
  })

  it('締切が無ければ日付も入れない', () => {
    expect(applicationTaskDrafts()[0].dueDate).toBeUndefined()
  })

  it('面接には面接用の一式を出す', () => {
    const drafts = interviewTaskDrafts('2026-09-28')
    expect(drafts.map((d) => d.title)).toContain('想定質問の準備')
    expect(drafts.map((d) => d.title)).toContain('模擬面接')
  })

  it('種類に応じた下書きを返し、該当しなければ空', () => {
    expect(draftsFor('interview', TODAY).length).toBeGreaterThan(0)
    expect(draftsFor('es', TODAY).length).toBeGreaterThan(0)
    expect(draftsFor('briefing', TODAY)).toHaveLength(0)
  })

  it('下書きからタスクを作ると、企業名と分野が入る', () => {
    const c = company({ id: 'c1', name: 'DIT' })
    const t = taskFromDraft(interviewTaskDrafts('2026-09-28')[0], c, '2026-09-08T00:00:00.000Z')
    expect(t.title).toBe('DIT 企業研究の見直し')
    expect(t.area).toBe('jobhunt')
    expect(t.companyId).toBe('c1')
    expect(t.status).toBe('todo')
  })
})

describe('企業比較', () => {
  const rows = () =>
    buildComparison([
      company({
        id: 'a',
        name: 'A社',
        interest: 5,
        facts: { salaryManYen: 400, holidaysPerYear: 125, overtimeHoursPerMonth: 30 },
        ratings: { workLife: 3, growth: 5 },
      }),
      company({
        id: 'b',
        name: 'B社',
        interest: 3,
        facts: { salaryManYen: 450, holidaysPerYear: 120, overtimeHoursPerMonth: 10 },
        ratings: { workLife: 5, growth: 5 },
      }),
      company({ id: 'c', name: 'C社', interest: 4 }),
    ])

  it('事実と見立てを別々に持つ', () => {
    const a = rows().find((r) => r.company.id === 'a')!
    expect(a.facts.salaryManYen).toBe(400)
    expect(a.ratingAverage).toBe(4)
  })

  it('記入の無い項目は 0 ではなく null になる', () => {
    const c = rows().find((r) => r.company.id === 'c')!
    expect(c.facts.salaryManYen).toBeNull()
    expect(c.ratingAverage).toBeNull()
  })

  it('事実で並べ替えられる', () => {
    expect(sortComparison(rows(), 'salaryManYen').map((r) => r.company.id)).toEqual(['b', 'a', 'c'])
  })

  it('少ないほうが良い項目は昇順で並ぶ', () => {
    expect(sortComparison(rows(), 'overtimeHoursPerMonth').map((r) => r.company.id)).toEqual([
      'b',
      'a',
      'c',
    ])
  })

  it('見立てでも並べ替えられる', () => {
    expect(sortComparison(rows(), 'ratingAverage').map((r) => r.company.id)).toEqual(['b', 'a', 'c'])
  })

  it('志望度で並べ替えられる', () => {
    expect(sortComparison(rows(), 'interest').map((r) => r.company.id)).toEqual(['a', 'c', 'b'])
  })

  it('値の無い企業は、どの並びでも最後に来る', () => {
    for (const key of ['salaryManYen', 'holidaysPerYear', 'ratingAverage'] as const) {
      expect(sortComparison(rows(), key).at(-1)!.company.id).toBe('c')
    }
  })
})
