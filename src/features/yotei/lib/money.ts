/** 交通費・旅行費の集計。実質負担 (支給されるぶんを除いた額) を主役にする。 */

import type { Expense, ExpenseCategory, ExpenseKind } from '../types'
import { monthKey, yearKey } from './date'

export interface Totals {
  /** かかった額 */
  total: number
  /** 支給・精算されるぶん */
  reimbursed: number
  /** 実質の自己負担 */
  net: number
  count: number
}

export function sumExpenses(list: Expense[]): Totals {
  let total = 0
  let reimbursed = 0
  for (const e of list) {
    total += e.amountYen
    if (e.reimbursed) reimbursed += e.amountYen
  }
  return { total, reimbursed, net: total - reimbursed, count: list.length }
}

export function inMonth(list: Expense[], ym: string): Expense[] {
  return list.filter((e) => monthKey(e.date) === ym)
}

export function inYear(list: Expense[], year: string): Expense[] {
  return list.filter((e) => yearKey(e.date) === year)
}

export function byCategory(list: Expense[]): Array<{ category: ExpenseCategory; totals: Totals }> {
  const map = new Map<ExpenseCategory, Expense[]>()
  for (const e of list) {
    const arr = map.get(e.category) ?? []
    arr.push(e)
    map.set(e.category, arr)
  }
  return [...map.entries()]
    .map(([category, items]) => ({ category, totals: sumExpenses(items) }))
    .sort((a, b) => b.totals.net - a.totals.net)
}

export function byKind(list: Expense[]): Array<{ kind: ExpenseKind; totals: Totals }> {
  const map = new Map<ExpenseKind, Expense[]>()
  for (const e of list) {
    const arr = map.get(e.kind) ?? []
    arr.push(e)
    map.set(e.kind, arr)
  }
  return [...map.entries()]
    .map(([kind, items]) => ({ kind, totals: sumExpenses(items) }))
    .sort((a, b) => b.totals.net - a.totals.net)
}

/** 1年ぶんの月別推移 (1月から12月) */
export function monthlySeries(list: Expense[], year: string): Array<{ month: number; totals: Totals }> {
  return Array.from({ length: 12 }, (_, i) => {
    const ym = `${year}-${String(i + 1).padStart(2, '0')}`
    return { month: i + 1, totals: sumExpenses(inMonth(list, ym)) }
  })
}

export function forTrip(list: Expense[], tripId: string): Expense[] {
  return list.filter((e) => e.tripId === tripId)
}

/** 記録のある年を新しい順に */
export function yearsWithData(list: Expense[]): string[] {
  const set = new Set(list.map((e) => yearKey(e.date)))
  if (set.size === 0) set.add(String(new Date().getFullYear()))
  return [...set].sort((a, b) => b.localeCompare(a))
}
