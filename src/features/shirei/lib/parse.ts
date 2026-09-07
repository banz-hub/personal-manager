/**
 * 入力した一文からタスクの項目を読み取る。
 *
 * 「金曜までに線形代数のレポート」と書いただけで、締切・分野・所要時間を埋めるためのもの。
 * 外部サービスは使わず、日本語の書き方のパターンを順に当てているだけ。
 * **読み取れなかったものは埋めずに unknown で返す。**推測で埋めると、
 * 間違った締切のまま気づかずに使うことになるため。
 */

import type { Importance, TaskArea } from '../types'
import { addDays, parseDate, todayKey } from './date'

export interface ParsedTask {
  title: string
  area: TaskArea
  dueDate?: string
  dueTime?: string
  estimateMin?: number
  importance: Importance
  recurring?: boolean
  chunkMin?: number
  /** 読み取れた項目。画面で「ここは自動で入れた」と示すのに使う */
  detected: string[]
  /** 読み取れなかった項目。ユーザーに確認する */
  unknown: string[]
}

const WEEKDAYS: Record<string, number> = {
  日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6,
}

/** 分野のキーワード。上から順に当てるので、細かいものを先に置く */
const AREA_KEYWORDS: Array<[TaskArea, RegExp]> = [
  ['jobhunt', /ES|エントリーシート|面接|説明会|企業研究|インターン|選考|OB訪問|履歴書|就活|内定|適性検査|SPI/i],
  ['cert', /ITパスポート|基本情報|応用情報|公務員|簿記|宅建|TOEIC対策|資格|検定|過去問/],
  ['english', /英語|TOEIC|TOEFL|英単語|リスニング|英文|洋書/],
  ['teaching', /教職|教育実習|指導案|模擬授業|教育心理|学習指導要領|教育法規/],
  ['math', /数学|線形代数|微積|解析|代数|複素|位相|幾何|統計|確率|証明|レポート課題|演習/],
  ['life', /掃除|洗濯|買い物|片付け|病院|銀行|役所|振込|筋トレ|運動|散歩/],
]

const IMPORTANT = /最優先|絶対|必ず|重要|大事|マスト/
const TRIVIAL = /余裕があれば|いつか|そのうち|できれば|暇なら/

function detectArea(text: string): TaskArea | null {
  for (const [area, re] of AREA_KEYWORDS) {
    if (re.test(text)) return area
  }
  return null
}

/** 「1時間30分」「90分」「2h」「1時間半」を分に直す */
function detectDuration(text: string): { minutes: number; matched: string } | null {
  const hm = text.match(/(\d+(?:\.\d+)?)\s*(?:時間|h|H)\s*(?:(\d+)\s*分|半)?/)
  if (hm) {
    const hours = Number(hm[1])
    const extra = hm[2] ? Number(hm[2]) : hm[0].includes('半') ? 30 : 0
    return { minutes: Math.round(hours * 60) + extra, matched: hm[0] }
  }
  const m = text.match(/(\d+)\s*分(?!野)/)
  if (m) return { minutes: Number(m[1]), matched: m[0] }
  return null
}

/** 「毎日20分」「1日30分ずつ」のような、続けてやる書き方 */
function detectRecurring(text: string): { chunkMin?: number; matched: string } | null {
  const m = text.match(/(毎日|1日|一日|毎朝|毎晩|コツコツ|ずつ)/)
  if (!m) return null
  const d = detectDuration(text)
  return { chunkMin: d?.minutes, matched: m[0] }
}

function detectTime(text: string): { time: string; matched: string } | null {
  const m = text.match(/(\d{1,2})\s*[:時]\s*(\d{1,2})?\s*分?まで/)
  if (!m) return null
  const h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  if (h > 23 || min > 59) return null
  return { time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, matched: m[0] }
}

/**
 * 締切の読み取り。
 * 「金曜までに」は、今日を含めて次に来る金曜。今日が金曜なら今日。
 */
function detectDue(text: string, today: string): { date: string; matched: string } | null {
  const rel: Array<[RegExp, number]> = [
    [/今日中|本日中|今日まで/, 0],
    [/明日まで|明日中|あすまで/, 1],
    [/明後日|あさって/, 2],
  ]
  for (const [re, offset] of rel) {
    const m = text.match(re)
    if (m) return { date: addDays(today, offset), matched: m[0] }
  }

  const inDays = text.match(/(\d+)\s*日後/)
  if (inDays) return { date: addDays(today, Number(inDays[1])), matched: inDays[0] }

  const inWeeks = text.match(/(\d+)\s*週間後/)
  if (inWeeks) return { date: addDays(today, Number(inWeeks[1]) * 7), matched: inWeeks[0] }

  // 9/12 まで / 9月12日まで
  const md = text.match(/(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?(?:まで|〆|締切)?/)
  if (md) {
    const month = Number(md[1])
    const day = Number(md[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const base = parseDate(today)
      let year = base.getFullYear()
      // 過ぎた月日なら来年のこととみなす
      const candidate = new Date(year, month - 1, day)
      if (candidate.getTime() < base.getTime()) year += 1
      const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      return { date: key, matched: md[0] }
    }
  }

  // 「来週の金曜まで」のように間に「の」が入る書き方も拾う
  const wd = text.match(/(来週|再来週)?\s*の?\s*([日月火水木金土])曜?日?(?:まで|〆|締切)/)
  if (wd) {
    const target = WEEKDAYS[wd[2]]
    const base = parseDate(today).getDay()
    let offset = (target - base + 7) % 7
    if (wd[1] === '来週') offset += 7
    if (wd[1] === '再来週') offset += 14
    return { date: addDays(today, offset), matched: wd[0] }
  }

  return null
}

/** 読み取りに使った文言をタイトルから取り除く */
function stripAll(text: string, parts: string[]): string {
  let out = text
  for (const p of parts) out = out.replace(p, ' ')
  return out
    .replace(/^[\s、。,.・]+|[\s、。,.・]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^(までに|まで|に|の)\s*/, '')
    .trim()
}

export function parseTaskInput(raw: string, today: string = todayKey()): ParsedTask {
  const text = raw.trim()
  const detected: string[] = []
  const unknown: string[] = []
  const consumed: string[] = []

  const due = detectDue(text, today)
  if (due) {
    detected.push('締切')
    consumed.push(due.matched)
  } else {
    unknown.push('締切')
  }

  const time = detectTime(text)
  if (time) {
    detected.push('締切時刻')
    consumed.push(time.matched)
  }

  const recurring = detectRecurring(text)
  const duration = detectDuration(text)
  if (duration) {
    detected.push('所要時間')
    consumed.push(duration.matched)
  } else {
    unknown.push('所要時間')
  }
  if (recurring) {
    detected.push('継続タスク')
    consumed.push(recurring.matched)
  }

  const area = detectArea(text)
  if (area) detected.push('分野')
  else unknown.push('分野')

  let importance: Importance = 2
  if (IMPORTANT.test(text)) {
    importance = 3
    detected.push('重要度')
    consumed.push(text.match(IMPORTANT)![0])
  } else if (TRIVIAL.test(text)) {
    importance = 1
    detected.push('重要度')
    consumed.push(text.match(TRIVIAL)![0])
  }

  const title = stripAll(text, consumed) || text

  return {
    title,
    area: area ?? 'other',
    dueDate: due?.date,
    dueTime: time?.time,
    estimateMin: duration?.minutes,
    importance,
    recurring: recurring ? true : undefined,
    chunkMin: recurring?.chunkMin,
    detected,
    unknown,
  }
}
