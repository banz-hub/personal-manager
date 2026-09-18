import { describe, expect, it } from 'vitest'
import type { StudyNode } from '../types'
import { areaOf, pathLabel, pathOf } from './study'

const node = (id: string, patch: Partial<StudyNode> = {}): StudyNode => ({
  id,
  title: id,
  importance: 2,
  estimateMin: 60,
  order: 0,
  createdAt: '',
  ...patch,
})

const NODES = [
  node('math', { title: '数学', area: 'math' }),
  node('topo', { title: '位相空間論', parentId: 'math' }),
  node('open', { title: '開集合', parentId: 'topo' }),
]

describe('前の版の学習項目を読む', () => {
  it('ルートまでの道すじと、その表示', () => {
    expect(pathOf(NODES, 'open').map((n) => n.id)).toEqual(['math', 'topo', 'open'])
    expect(pathLabel(NODES, 'open')).toBe('数学 / 位相空間論')
  })

  it('分野は科目から受け継ぐ。見つからなければ「その他」', () => {
    expect(areaOf(NODES, 'open')).toBe('math')
    expect(areaOf(NODES, 'none')).toBe('other')
  })

  it('親子が輪になっていても止まる', () => {
    const loop = [node('a', { parentId: 'b' }), node('b', { parentId: 'a' })]
    expect(pathOf(loop, 'a')).toHaveLength(2)
  })
})
