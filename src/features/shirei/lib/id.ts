/** 端末内でだけ一意ならよいので、時刻と乱数をつなげただけの id を使う。 */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
