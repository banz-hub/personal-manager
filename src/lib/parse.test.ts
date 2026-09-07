import { describe, expect, it } from 'vitest'
import { parseTaskInput } from './parse'

// 2026-09-07 は月曜日
const TODAY = '2026-09-07'

describe('締切の読み取り', () => {
  it('曜日は、今日を含めて次に来るその曜日になる', () => {
    expect(parseTaskInput('金曜までに線形代数のレポート', TODAY).dueDate).toBe('2026-09-11')
  })

  it('今日が同じ曜日なら今日になる', () => {
    expect(parseTaskInput('月曜までに提出', TODAY).dueDate).toBe(TODAY)
  })

  it('来週をつけると1週間ずれる', () => {
    expect(parseTaskInput('来週の金曜まで', TODAY).dueDate).toBe('2026-09-18')
  })

  it('今日・明日・明後日を読める', () => {
    expect(parseTaskInput('今日中に出す', TODAY).dueDate).toBe('2026-09-07')
    expect(parseTaskInput('明日までに読む', TODAY).dueDate).toBe('2026-09-08')
    expect(parseTaskInput('明後日の準備', TODAY).dueDate).toBe('2026-09-09')
  })

  it('N日後・N週間後を読める', () => {
    expect(parseTaskInput('3日後までに提出', TODAY).dueDate).toBe('2026-09-10')
    expect(parseTaskInput('2週間後が締切', TODAY).dueDate).toBe('2026-09-21')
  })

  it('月日を読める', () => {
    expect(parseTaskInput('9/28までにES', TODAY).dueDate).toBe('2026-09-28')
    expect(parseTaskInput('11月30日まで', TODAY).dueDate).toBe('2026-11-30')
  })

  it('過ぎた月日は来年とみなす', () => {
    expect(parseTaskInput('3月10日まで', TODAY).dueDate).toBe('2027-03-10')
  })

  it('締切の時刻も読める', () => {
    const p = parseTaskInput('今日中に17時までに提出', TODAY)
    expect(p.dueDate).toBe(TODAY)
    expect(p.dueTime).toBe('17:00')
  })

  it('締切が書いていなければ埋めず、確認事項として返す', () => {
    const p = parseTaskInput('本を読む', TODAY)
    expect(p.dueDate).toBeUndefined()
    expect(p.unknown).toContain('締切')
  })
})

describe('所要時間の読み取り', () => {
  it('分・時間・時間分・時間半を読める', () => {
    expect(parseTaskInput('45分で終わる作業', TODAY).estimateMin).toBe(45)
    expect(parseTaskInput('2時間かかる', TODAY).estimateMin).toBe(120)
    expect(parseTaskInput('1時間30分の作業', TODAY).estimateMin).toBe(90)
    expect(parseTaskInput('1時間半かかる', TODAY).estimateMin).toBe(90)
  })

  it('書いていなければ確認事項に入る', () => {
    expect(parseTaskInput('レポートを書く', TODAY).unknown).toContain('所要時間')
  })
})

describe('分野の判定', () => {
  it('就活・資格・英語・教職・数学・生活を見分ける', () => {
    expect(parseTaskInput('A社のESを書く', TODAY).area).toBe('jobhunt')
    expect(parseTaskInput('ITパスポートの勉強', TODAY).area).toBe('cert')
    expect(parseTaskInput('英単語を覚える', TODAY).area).toBe('english')
    expect(parseTaskInput('模擬授業の指導案', TODAY).area).toBe('teaching')
    expect(parseTaskInput('線形代数の演習', TODAY).area).toBe('math')
    expect(parseTaskInput('部屋の掃除', TODAY).area).toBe('life')
  })

  it('分からなければ other にして確認事項に入れる', () => {
    const p = parseTaskInput('あれをやる', TODAY)
    expect(p.area).toBe('other')
    expect(p.unknown).toContain('分野')
  })
})

describe('継続タスク', () => {
  it('毎日◯分は継続タスクとして1回分の長さを持つ', () => {
    const p = parseTaskInput('毎日20分の英語', TODAY)
    expect(p.recurring).toBe(true)
    expect(p.chunkMin).toBe(20)
    expect(p.area).toBe('english')
  })
})

describe('重要度', () => {
  it('最優先・重要は高、余裕があればは低になる', () => {
    expect(parseTaskInput('絶対にやる作業', TODAY).importance).toBe(3)
    expect(parseTaskInput('余裕があれば読む本', TODAY).importance).toBe(1)
    expect(parseTaskInput('ふつうの作業', TODAY).importance).toBe(2)
  })
})

describe('タイトル', () => {
  it('読み取りに使った言葉はタイトルから外れる', () => {
    expect(parseTaskInput('金曜までに線形代数のレポート', TODAY).title).toBe('線形代数のレポート')
  })

  it('全部が読み取り対象でも、タイトルは空にならない', () => {
    expect(parseTaskInput('明日まで', TODAY).title.length).toBeGreaterThan(0)
  })

  it('仕様書の例がそのまま通る', () => {
    const p = parseTaskInput('金曜までに線形代数のレポート', TODAY)
    expect(p.title).toBe('線形代数のレポート')
    expect(p.area).toBe('math')
    expect(p.dueDate).toBe('2026-09-11')
    expect(p.importance).toBe(2)
    expect(p.unknown).toContain('所要時間')
  })
})
