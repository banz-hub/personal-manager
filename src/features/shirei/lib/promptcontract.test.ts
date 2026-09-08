/**
 * docs/claude-prompt.md に書いた決まりが、取り込み側の実装と合っているかを見る。
 *
 * プロンプトは「アプリが受け付ける形」を言葉で説明したもの。
 * 取り込み側 (importplan.ts) を変えるとプロンプトが嘘になるので、ここで縛っておく。
 * このテストが落ちたら docs/claude-prompt.md も直すこと。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { linkedCount, parsePlanText } from './importplan'
import { CLAUDE_PROMPT } from './prompt'
import type { StudyNode, Task } from '../types'

const tasks = [
  { id: 't1', title: '複素解析のレポート', area: 'math', status: 'todo', importance: 3, estimateMin: 120, createdAt: '' },
  { id: 't2', title: 'ES 第2稿', area: 'job', status: 'todo', importance: 3, estimateMin: 60, createdAt: '' },
] as Task[]
const nodes = [{ id: 'n1', title: '開集合', importance: 3, createdAt: '' }] as StudyNode[]

// プロンプトどおりに書いた返事
const reply = `09:30〜10:30 複素解析のレポート
10:30〜10:40 休憩
10:40〜11:40 開集合
13:00〜14:00 ES 第2稿

- 締切がいちばん近いレポートを午前の頭に置きました
- 昼をはさんで就活に切り替えます
- 空き時間の8割までにとどめ、夕方は空けてあります`

describe('プロンプトどおりの返事', () => {
  it('全行が読めて、タスクと結びつく', () => {
    const r = parsePlanText(reply, tasks, nodes)
    expect(r.skipped).toEqual([])
    expect(r.overlapping).toBe(false)
    expect(r.lines).toHaveLength(4)
    expect(linkedCount(r.lines)).toBe(3)
    expect(r.lines[2]).toMatchObject({ title: '開集合', nodeId: 'n1', kind: 'study' })
  })

  it('題名に飾りが付くと結びつかない（プロンプトで禁じている理由）', () => {
    const r = parsePlanText('09:30〜10:30 [今日中] 複素解析のレポート (数学)', tasks, nodes)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].taskId).toBeUndefined()
  })

  it('理由に時刻を書くと読めなかった行になる（プロンプトで禁じている理由）', () => {
    const r = parsePlanText('- 09:30 から始めると良いです', tasks, nodes)
    expect(r.skipped).toEqual(['- 09:30 から始めると良いです'])
  })

  it('1桁の時でも読める（保険）', () => {
    const r = parsePlanText('9:30〜10:30 複素解析のレポート', tasks, nodes)
    expect(r.lines[0]).toMatchObject({ start: '09:30', taskId: 't1' })
  })
})

describe('指示の文', () => {
  it('取り込み側が受け付ける例だけを載せている', () => {
    // 指示の中の「09:30〜10:30 複素解析のレポート」などが、本当に読める形かを見る。
    // 例が読めない形になっていると、Claude はそれを真似て返してくる
    const examples = CLAUDE_PROMPT.split('\n')
      .map((l) => l.trim())
      .filter((l) => /^\d{1,2}:\d{2}\s*〜/.test(l))
    expect(examples.length).toBeGreaterThan(0)
    for (const line of examples) {
      const r = parsePlanText(line, tasks, nodes)
      expect(r.skipped).toEqual([])
      expect(r.lines).toHaveLength(1)
    }
  })

  it('本文をここだけで持っている', () => {
    // docs 側に本文を写すと、必ずどちらかが古くなる。写していないことを見る
    const doc = readFileSync(new URL('../../../../docs/claude-prompt.md', import.meta.url), 'utf8')
    expect(doc).toContain('prompt.ts')
    expect(doc).not.toContain('あなたは私の1日の予定を組む係です')
  })
})
