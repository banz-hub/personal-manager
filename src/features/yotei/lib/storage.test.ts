/**
 * 読み込むときのデータの揃え方。
 *
 * 作りを変えたあとも、前に入れた予定がそのまま使えることを見ている。
 */

import { describe, expect, it } from 'vitest'
import type { EventItem } from '../types'
import { dropShiftPrefix } from './storage'

const ev = (patch: Partial<EventItem> & { id: string }): EventItem => ({
  title: '',
  category: 'baito',
  date: '2026-11-04',
  start: '16:20',
  end: '21:30',
  needsTravel: false,
  ...patch,
})

describe('古いバイトの予定の名前を揃える', () => {
  it('「バイト BCD」はコマだけにする', () => {
    const [e] = dropShiftPrefix([ev({ id: 'a', title: 'バイト BCD' })])
    expect(e.title).toBe('BCD')
  })

  it('もう新しい書き方のものは触らない', () => {
    const [e] = dropShiftPrefix([ev({ id: 'a', title: 'BCD' })])
    expect(e.title).toBe('BCD')
  })

  it('コマの付いていない「バイト」はそのまま', () => {
    const [e] = dropShiftPrefix([ev({ id: 'a', title: 'バイト' })])
    expect(e.title).toBe('バイト')
  })

  it('自分で書いた名前は変えない', () => {
    const [e] = dropShiftPrefix([ev({ id: 'a', title: '明光 テスト対策' })])
    expect(e.title).toBe('明光 テスト対策')
  })

  it('バイト以外の種類には手を出さない', () => {
    const [e] = dropShiftPrefix([
      ev({ id: 'a', title: 'バイト先の説明会', category: 'jobhunt' }),
    ])
    expect(e.title).toBe('バイト先の説明会')
  })

  it('元の配列を書き換えない', () => {
    const list = [ev({ id: 'a', title: 'バイト BCD' })]
    dropShiftPrefix(list)
    expect(list[0].title).toBe('バイト BCD')
  })
})
