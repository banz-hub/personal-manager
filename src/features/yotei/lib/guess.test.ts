import { describe, expect, it } from 'vitest'
import { guessCategory, normalize } from './guess'

const g = (title: string, extra = {}) => guessCategory({ title, ...extra })

describe('題名から種類を当てる', () => {
  it('言葉の表から当てる', () => {
    expect(g('最終面接(DIT)')?.category).toBe('jobhunt')
    expect(g('期末試験 数学')?.category).toBe('exam')
    expect(g('バイト 早番')?.category).toBe('baito')
    expect(g('京都旅行')?.category).toBe('trip')
    expect(g('歯医者')?.category).toBe('private')
  })

  it('なぜそうしたかを返す', () => {
    expect(g('説明会(A社)')?.reason).toBe('「説明会」')
  })

  it('大文字・全角・カタカナの違いは無視する', () => {
    expect(normalize('ＥＳ 提出')).toBe('es提出')
    expect(g('ＥＳ提出')?.category).toBe('jobhunt')
    expect(g('ばいと')?.category).toBe('baito')
    expect(g('TOEIC')?.category).toBe('exam')
  })

  it('バイト先・旅行の名前は言葉の表より先に見る', () => {
    expect(g('明光義塾 面接', { jobNames: ['明光義塾'] })).toEqual({
      category: 'baito',
      reason: 'バイト先の「明光義塾」',
    })
    expect(g('沖縄の下見', { tripNames: ['沖縄'] })?.category).toBe('trip')
  })

  it('強い手がかりを先に採る（試験 → 就活 → バイト）', () => {
    // 「適性検査」は就活だが「検定」は試験。試験のほうを先に見る
    expect(g('適性検査の勉強')?.category).toBe('jobhunt')
    expect(g('バイトの面接')?.category).toBe('jobhunt')
  })

  it('手がかりが無ければ何も返さない（勝手に決めない）', () => {
    expect(g('打ち合わせ')).toBeNull()
    expect(g('   ')).toBeNull()
    expect(g('')).toBeNull()
  })
})
