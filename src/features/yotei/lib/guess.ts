/**
 * 予定の種類（＝色）を題名から当てる。
 *
 * **当てるだけで、決めつけない。**自動で入れたことと、なぜそうしたかを画面に出し、
 * 自分で選び直したあとは二度と書き換えない。
 * 外した種類のまま保存されると、色が信用できなくなるため。
 *
 * 外の AI は使わない。決まった言葉の表で判定する。
 * オフラインで動き、毎回同じ答えになり、テストが書ける。
 */

import type { EventCategory } from '../types'

export interface Guess {
  category: EventCategory
  /** なぜそう判断したか。画面にそのまま出す */
  reason: string
}

/**
 * 比べる前に形をそろえる。
 * 大文字・全角・カタカナの違いで当たらなくなるのを防ぐ（「ＥＳ」「es」「バイト」「ばいと」）。
 */
export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '')
}

/**
 * 種類ごとの手がかり。**上から順に見て、最初に当たったものを採る。**
 * 迷う言葉（「説明会」はバイトの説明会もありうる）は、強いほうを上に置いてある。
 */
const RULES: Array<{ category: EventCategory; words: string[] }> = [
  {
    category: 'exam',
    words: ['試験', 'テスト', '受験', '検定', '模試', '期末', '中間', 'toeic', '英検', '小テスト'],
  },
  {
    category: 'jobhunt',
    words: [
      '面接',
      '説明会',
      '選考',
      'es',
      'エントリー',
      'インターン',
      'ob訪問',
      'og訪問',
      '適性検査',
      'webテスト',
      '座談会',
      '内定',
      '面談',
      '就活',
      '合同企業',
    ],
  },
  {
    category: 'baito',
    words: ['バイト', 'アルバイト', 'シフト', '勤務', '出勤', '塾', '講師', '夜勤', '早番', '遅番'],
  },
  {
    category: 'trip',
    words: ['旅行', '旅', '帰省', '温泉', 'キャンプ', '合宿', 'ディズニー', 'usj', '泊', '遠征'],
  },
  {
    category: 'private',
    words: [
      '病院',
      '歯医者',
      '歯科',
      '美容院',
      '美容室',
      '床屋',
      'ライブ',
      '映画',
      '飲み会',
      '誕生日',
      '買い物',
      'ジム',
      '免許',
      '結婚式',
      '法事',
      '帰り',
    ],
  },
]

/**
 * 手がかりの言葉も、題名と同じ形にそろえておく。
 * 表はカタカナで書いてあるので、そろえないと「ばいと」と書いたときに当たらない。
 */
const NORMALIZED = RULES.map((r) => ({
  category: r.category,
  words: r.words.map((w) => ({ word: w, key: normalize(w) })),
}))

export interface GuessInput {
  title: string
  /** バイト先の名前。題名に入っていればバイトとみなす */
  jobNames?: string[]
  /** 旅行の名前。題名に入っていれば旅行とみなす */
  tripNames?: string[]
}

/**
 * 題名から種類を当てる。手がかりが無ければ null（そのときは何も変えない）。
 *
 * バイト先・旅行の名前は、言葉の表より先に見る。
 * 「明光義塾」は本人が登録した事実で、こちらの言葉の表より確かなため。
 */
export function guessCategory(input: GuessInput): Guess | null {
  const title = normalize(input.title)
  if (!title) return null

  for (const name of input.jobNames ?? []) {
    const n = normalize(name)
    if (n && title.includes(n)) return { category: 'baito', reason: `バイト先の「${name}」` }
  }
  for (const name of input.tripNames ?? []) {
    const n = normalize(name)
    if (n && title.includes(n)) return { category: 'trip', reason: `旅行の「${name}」` }
  }

  for (const rule of NORMALIZED) {
    const hit = rule.words.find((w) => title.includes(w.key))
    if (hit) return { category: rule.category, reason: `「${hit.word}」` }
  }
  return null
}
