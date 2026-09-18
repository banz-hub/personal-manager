import { describe, expect, it } from 'vitest'
import type { StudyNode, TaskLog } from '../types'
import { newStudyTask, nodesToTasks, removableNodes, studyTotals } from './studylist'

const NOW = '2026-09-19T00:00:00.000Z'

const node = (id: string, patch: Partial<StudyNode> = {}): StudyNode => ({
  id,
  title: id,
  importance: 2,
  estimateMin: 90,
  order: 0,
  createdAt: '',
  ...patch,
})

describe('学習のタスク', () => {
  it('学習の印が付き、続けるものとして作る', () => {
    const t = newStudyTask(' ITパスポート ', 'cert', NOW)
    expect(t).toMatchObject({ title: 'ITパスポート', area: 'cert', study: true, recurring: true, status: 'todo' })
  })
})

describe('前の学習項目を移す', () => {
  it('勉強する単位（葉）だけを移し、分野は親から受け継ぐ', () => {
    const tasks = nodesToTasks(
      [
        node('math', { title: '数学', area: 'math' }),
        node('topo', { title: '位相', parentId: 'math', order: 1 }),
        node('open', { title: '開集合', parentId: 'topo' }),
        node('it', { title: 'ITパスポート', area: 'cert', order: 2 }),
      ],
      NOW,
    )
    expect(tasks.map((t) => [t.title, t.area])).toEqual([
      ['開集合', 'math'],
      ['ITパスポート', 'cert'],
    ])
    expect(tasks.every((t) => t.study)).toBe(true)
  })

  it('記録が付いている項目は消さずに残す', () => {
    const nodes = [node('a'), node('b')]
    const r = removableNodes(nodes, [{ id: 's', nodeId: 'a', date: '2026-09-01', minutes: 30, createdAt: '' }])
    expect(r.map((n) => n.id)).toEqual(['b'])
  })
})

describe('累計時間', () => {
  it('学習のタスクの記録だけを足し、最後にやった日を出す', () => {
    const study = { ...newStudyTask('基本情報', 'cert', NOW), id: 'st' }
    const plain = { ...study, id: 'pl', study: undefined }
    const log = (taskId: string, date: string, actualMin: number): TaskLog => ({
      id: `${taskId}${date}`,
      taskId,
      date,
      area: 'cert',
      plannedMin: 30,
      actualMin,
      createdAt: '',
    })
    const totals = studyTotals([study, plain], [
      log('st', '2026-09-17', 25),
      log('st', '2026-09-18', 50),
      log('pl', '2026-09-18', 99),
    ])
    expect(totals.get('st')).toEqual({ minutes: 75, lastDate: '2026-09-18' })
    expect(totals.has('pl')).toBe(false)
  })
})
