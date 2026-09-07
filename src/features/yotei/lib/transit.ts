/**
 * 乗換案内へのリンクを組み立てる。
 *
 * 登録していない区間は自前では探索できないので、行き先と時刻を渡した状態で
 * 乗換案内アプリ/サイトを開けるようにしておく。調べた結果の運賃は
 * 「この経路を登録」からアプリに取り込む。
 *
 * 時刻つきのURLはヤフーの検索フォームの形に合わせてある。
 * 仕様が変わる可能性があるので、時刻が反映されないときのために
 * 駅名だけの簡易リンクも一緒に出している。
 */

const p2 = (n: number) => String(n).padStart(2, '0')

export interface TransitLink {
  label: string
  url: string
  note?: string
}

/** 到着時刻を指定してヤフー乗換案内を開く */
export function yahooTransitUrl(
  from: string,
  to: string,
  dateKey?: string,
  time?: string,
  mode: 'arrive' | 'depart' = 'arrive',
): string {
  const params = new URLSearchParams({ from: from.trim(), to: to.trim() })
  if (dateKey && time) {
    const [y, m, d] = dateKey.split('-')
    const [hh, mm] = time.split(':')
    params.set('y', y)
    params.set('m', m)
    params.set('d', d)
    params.set('hh', hh)
    // 分は十の位と一の位に分けて渡す形式
    params.set('m1', String(Math.floor(Number(mm) / 10)))
    params.set('m2', String(Number(mm) % 10))
    params.set('type', mode === 'arrive' ? '4' : '1')
  }
  return `https://transit.yahoo.co.jp/search/result?${params.toString()}`
}

/** Google マップの経路検索 (電車)。時刻指定はURLでは渡せない */
export function googleTransitUrl(from: string, to: string): string {
  const params = new URLSearchParams({
    api: '1',
    origin: from.trim(),
    destination: to.trim(),
    travelmode: 'transit',
  })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export function transitLinks(
  from: string,
  to: string,
  dateKey?: string,
  time?: string,
  mode: 'arrive' | 'depart' = 'arrive',
): TransitLink[] {
  if (!from.trim() || !to.trim()) return []
  const links: TransitLink[] = []
  if (dateKey && time) {
    links.push({
      label: mode === 'arrive' ? `${time} 着で検索` : `${time} 発で検索`,
      url: yahooTransitUrl(from, to, dateKey, time, mode),
      note: 'ヤフー乗換案内',
    })
  }
  links.push({ label: '時刻を指定せず検索', url: yahooTransitUrl(from, to), note: 'ヤフー乗換案内' })
  links.push({ label: 'Google マップで見る', url: googleTransitUrl(from, to) })
  return links
}

/** 端末のカレンダーに入れる単発の予定 (.ics) */
export function buildEventIcs(params: {
  title: string
  dateKey: string
  start: string
  end: string
  location?: string
  description?: string
  alarmMinutesBefore?: number
}): string {
  const stamp = (dateKey: string, time: string) => {
    const [y, m, d] = dateKey.split('-')
    const [hh, mm] = time.split(':')
    return `${y}${m}${d}T${p2(Number(hh))}${p2(Number(mm))}00`
  }
  const now = new Date()
  const nowStamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}T${p2(
    now.getHours(),
  )}${p2(now.getMinutes())}00`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//yoteicho//JP',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:yoteicho-${Date.now()}@local`,
    `DTSTAMP:${nowStamp}`,
    `DTSTART:${stamp(params.dateKey, params.start)}`,
    `DTEND:${stamp(params.dateKey, params.end)}`,
    `SUMMARY:${escapeIcs(params.title)}`,
  ]
  if (params.location) lines.push(`LOCATION:${escapeIcs(params.location)}`)
  if (params.description) lines.push(`DESCRIPTION:${escapeIcs(params.description)}`)
  if (params.alarmMinutesBefore != null) {
    lines.push(
      'BEGIN:VALARM',
      `TRIGGER:-PT${Math.max(0, Math.round(params.alarmMinutesBefore))}M`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcs(params.title)}`,
      'END:VALARM',
    )
  }
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

function escapeIcs(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/** 文字列をファイルとしてダウンロードさせる */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
