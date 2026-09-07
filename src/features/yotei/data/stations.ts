/**
 * よく使う路線の駅の並び。
 *
 * ここに入れているのは「駅名と並び順」だけで、所要時間と運賃は持たない。
 * 運賃は路線や区間によって規則が入り組んでいて、正確な表を持たないまま
 * 概算を出すと交通費の記録が静かにずれてしまうため、実際に調べた値だけを使う方針にしている。
 *
 * この一覧は
 *   - 駅名の入力補助（どの画面でも候補に出る）
 *   - 「まとめて登録」画面の行き先リスト
 * に使う。
 */

export interface LineDef {
  id: string
  name: string
  /** 起点から終点に向かって並べた駅名 */
  stations: string[]
  note?: string
}

/** 常磐線（快速・中距離電車の停車駅）。上野東京ライン経由で品川まで */
export const JOBAN: LineDef = {
  id: 'joban',
  name: 'JR常磐線（快速）',
  note: '上野東京ライン経由で東京・品川まで直通',
  stations: [
    '品川',
    '新橋',
    '東京',
    '上野',
    '日暮里',
    '三河島',
    '南千住',
    '北千住',
    '松戸',
    '柏',
    '我孫子',
    '天王台',
    '取手',
    '藤代',
    '龍ケ崎市',
    '牛久',
    'ひたち野うしく',
    '荒川沖',
    '土浦',
  ],
}

/** 山手線。東京から内回りの順に一周 */
export const YAMANOTE: LineDef = {
  id: 'yamanote',
  name: 'JR山手線',
  stations: [
    '東京',
    '神田',
    '秋葉原',
    '御徒町',
    '上野',
    '鶯谷',
    '日暮里',
    '西日暮里',
    '田端',
    '駒込',
    '巣鴨',
    '大塚',
    '池袋',
    '目白',
    '高田馬場',
    '新大久保',
    '新宿',
    '代々木',
    '原宿',
    '渋谷',
    '恵比寿',
    '目黒',
    '五反田',
    '大崎',
    '品川',
    '高輪ゲートウェイ',
    '田町',
    '浜松町',
    '新橋',
    '有楽町',
  ],
}

/** 東武アーバンパークライン（野田線）の柏〜運河 */
export const URBAN_PARK: LineDef = {
  id: 'urbanpark',
  name: '東武アーバンパークライン',
  stations: ['柏', '豊四季', '流山おおたかの森', '初石', '江戸川台', '運河'],
}

/**
 * 武蔵野線（常磐線から接続する東側だけ）。
 * 常磐線からは新松戸で乗り換える。ただし常磐線の快速は新松戸に停まらないので、
 * 松戸か柏で各駅停車に乗り換えてから新松戸へ向かうことになる。
 */
export const MUSASHINO: LineDef = {
  id: 'musashino',
  name: 'JR武蔵野線（東側）',
  note: '常磐線からは新松戸で接続。西船橋から京葉線に直通する列車がある',
  stations: ['南流山', '新松戸', '新八柱', '東松戸', '市川大野', '船橋法典', '西船橋'],
}

/** 京葉線。舞浜（ディズニー）へはここを使う */
export const KEIYO: LineDef = {
  id: 'keiyo',
  name: 'JR京葉線',
  note: '武蔵野線から西船橋経由で直通する列車がある。東京駅の京葉線ホームは他の路線から遠い',
  stations: [
    '東京',
    '八丁堀',
    '越中島',
    '潮見',
    '新木場',
    '葛西臨海公園',
    '舞浜',
    '新浦安',
    '市川塩浜',
    '二俣新町',
    '南船橋',
    '新習志野',
    '幕張豊砂',
    '海浜幕張',
  ],
}

export const LINES: LineDef[] = [JOBAN, YAMANOTE, URBAN_PARK, MUSASHINO, KEIYO]

/**
 * その駅が、常磐線の上り方向で上野より手前（＝土浦側）にあるか。
 * 上野止まりの便でも、ここで降りるなら乗り換えは要らない。
 */
export function isBeforeUeno(station: string): boolean {
  const order = JOBAN.stations
  const ueno = order.indexOf('上野')
  const index = order.indexOf(station)
  // 常磐線に無い駅は判断できないので false（注意を出す側に倒す）
  if (index < 0 || ueno < 0) return false
  return index > ueno
}

/** 全路線の駅名（重複を除く） */
export function allStations(): string[] {
  const set = new Set<string>()
  for (const line of LINES) for (const s of line.stations) set.add(s)
  return [...set]
}

/** その駅が通っている路線 */
export function linesOf(station: string): LineDef[] {
  return LINES.filter((l) => l.stations.includes(station))
}

/**
 * まとめて登録するときの行き先候補。
 * 出発駅そのものは除く。上野・東京・柏のように複数の路線が通る駅は
 * 二重に出すと入力欄が混乱するので、先に出てきた路線の側にだけ載せる。
 */
export function destinationGroups(from: string): Array<{ line: LineDef; stations: string[] }> {
  const seen = new Set<string>([from])
  const groups: Array<{ line: LineDef; stations: string[] }> = []
  for (const line of LINES) {
    const stations = line.stations.filter((s) => !seen.has(s))
    for (const s of stations) seen.add(s)
    if (stations.length > 0) groups.push({ line, stations })
  }
  return groups
}
