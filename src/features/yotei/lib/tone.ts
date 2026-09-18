/**
 * 予定の色分け。**色はここでしか決めない。**
 *
 * 予定の画面（週・月）とエージェントの今日の画面の両方がここを通す。
 * 2 か所で決めると、同じバイトが片方では水色、片方では灰色になる。
 *
 *   授業 … 緑 / 私用・旅行 … ピンク / バイト … 水色 / 就活 … オレンジ / 試験 … 赤
 *
 * 色は CSS の `--c-<tone>` に置いてある。ここは「どの色の組か」を返すだけ。
 * 色だけで区別させないよう、画面では必ず `labelOf` の文字と一緒に出す。
 */

export type Tone = 'class' | 'private' | 'baito' | 'job' | 'exam' | 'other'

const EVENT_TONES: Record<string, Tone> = {
  baito: 'baito',
  jobhunt: 'job',
  exam: 'exam',
  private: 'private',
  trip: 'private',
  other: 'other',
}

const EVENT_LABELS: Record<string, string> = {
  baito: 'バイト',
  jobhunt: '就活',
  exam: '試験',
  private: '私用',
  trip: '旅行',
  other: 'その他',
}

/**
 * 授業は種類 (`course`)、それ以外は予定の分類で決まる。
 * 知らない分類（あとで増えたもの・古いデータ）は「その他」の灰色にする。
 */
export function toneOf(kind: 'course' | 'event' | 'exam', category?: string): Tone {
  if (kind === 'course') return 'class'
  if (kind === 'exam') return 'exam'
  return EVENT_TONES[category ?? 'other'] ?? 'other'
}

export function labelOf(kind: 'course' | 'event' | 'exam', category?: string): string {
  if (kind === 'course') return '授業'
  if (kind === 'exam') return '試験'
  return EVENT_LABELS[category ?? 'other'] ?? 'その他'
}
