/**
 * 3 つまとめての書き出し・読み込み。
 *
 * ここを間違えるとデータが消える。
 * 「入っていないぶんは触らない」がいちばん大事なので、そこを厚く見ている。
 */

import { describe, expect, it, vi } from 'vitest'
import { exportAll, importAll } from './backup'
import type { Feature } from './types'

function feature(id: string, key: string, opts: Partial<{ data: unknown; fail: string }> = {}): Feature {
  return {
    id,
    label: id,
    nav: [],
    routes: [],
    backup: {
      key,
      export: async () => opts.data ?? { from: id },
      import: async () => {
        if (opts.fail) throw new Error(opts.fail)
      },
      filename: () => `${key}.json`,
    },
  }
}

/** 書き出しの窓口を持たない機能 */
function plain(id: string): Feature {
  return { id, label: id, nav: [], routes: [] }
}

describe('まとめて書き出す', () => {
  it('機能ごとに分けたまま 1 つに入れる', async () => {
    const got = await exportAll([feature('a', 'ka'), feature('b', 'kb')])
    expect(got.app).toBe('agent')
    expect(got.version).toBe(1)
    expect(got.parts).toEqual({ ka: { from: 'a' }, kb: { from: 'b' } })
  })

  it('窓口を持たない機能は入らない', async () => {
    const got = await exportAll([feature('a', 'ka'), plain('b')])
    expect(Object.keys(got.parts)).toEqual(['ka'])
  })
})

describe('まとめて読み込む', () => {
  const file = (parts: Record<string, unknown>) => ({
    version: 1,
    app: 'agent',
    exportedAt: '2026-09-08T00:00:00.000Z',
    parts,
  })

  it('入っているぶんを読み込む', async () => {
    const a = feature('a', 'ka')
    const b = feature('b', 'kb')
    const spyA = vi.spyOn(a.backup!, 'import')
    const spyB = vi.spyOn(b.backup!, 'import')

    const report = await importAll(file({ ka: { x: 1 }, kb: { y: 2 } }), [a, b])

    expect(report.done).toEqual(['a', 'b'])
    expect(spyA).toHaveBeenCalledWith({ x: 1 })
    expect(spyB).toHaveBeenCalledWith({ y: 2 })
  })

  it('**入っていない機能には触らない**', async () => {
    const a = feature('a', 'ka')
    const b = feature('b', 'kb')
    const spyB = vi.spyOn(b.backup!, 'import')

    const report = await importAll(file({ ka: { x: 1 } }), [a, b])

    expect(report.done).toEqual(['a'])
    expect(report.missing).toEqual(['b'])
    // 呼ばれていない = 消されていない
    expect(spyB).not.toHaveBeenCalled()
  })

  it('1 つ失敗しても残りは読み込む', async () => {
    const a = feature('a', 'ka', { fail: '形式が違います' })
    const b = feature('b', 'kb')
    const spyB = vi.spyOn(b.backup!, 'import')

    const report = await importAll(file({ ka: {}, kb: {} }), [a, b])

    expect(report.failed).toEqual([{ label: 'a', reason: '形式が違います' }])
    expect(report.done).toEqual(['b'])
    expect(spyB).toHaveBeenCalled()
  })

  it('中身が空でも「入っている」として扱う', async () => {
    // 何も登録していない機能を書き出すと空の配列になる。
    // これを「入っていない」と混同すると、空にしたつもりが戻らない
    const a = feature('a', 'ka')
    const spyA = vi.spyOn(a.backup!, 'import')
    const report = await importAll(file({ ka: null }), [a])
    expect(report.done).toEqual(['a'])
    expect(spyA).toHaveBeenCalledWith(null)
  })
})

describe('別のファイルを読ませたとき', () => {
  it('形式が違えば何もせずに止まる', async () => {
    const a = feature('a', 'ka')
    const spyA = vi.spyOn(a.backup!, 'import')

    // よてい帳 1 つぶんのバックアップを、まとめて読み込みに入れた場合
    await expect(importAll({ version: 1, app: 'yoteicho', events: [] }, [a])).rejects.toThrow()
    expect(spyA).not.toHaveBeenCalled()
  })

  it('null でも落ちない', async () => {
    await expect(importAll(null, [])).rejects.toThrow()
  })
})
