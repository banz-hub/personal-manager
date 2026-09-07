/** アプリ全体で使うデータ型。すべて端末ローカル (IndexedDB) に保存される。 */

/** 何かをするのに向いた場所の種類。空き時間の提案とやることの照合に使う */
export type SpotKind =
  | 'anywhere'
  | 'home'
  | 'outside'
  | 'campus'
  | 'cafe'
  | 'transit'
  | 'gym'
  | 'library'

export const SPOT_LABELS: Record<SpotKind, string> = {
  anywhere: 'どこでも',
  home: '自宅',
  outside: '外出先',
  campus: '大学',
  cafe: 'カフェ',
  transit: '移動中',
  gym: 'ジム',
  library: '図書館',
}

/** よく行く場所。予定に紐づけると駅と徒歩時間が自動で入る */
export interface Place {
  id: string
  name: string
  /** 最寄り駅 */
  station: string
  /** 駅から現地までの徒歩分 */
  walkMinutes: number
  category: 'home' | 'campus' | 'work' | 'other'
  /** そこにいるとき何ができるか (提案に使う) */
  spot: SpotKind
  memo?: string
}

/**
 * 登録済みの区間 (駅→駅)。
 * 経路探索APIを使わない代わりに、一度調べた区間をここに貯めて再利用する。
 * 向きは区別しない (往復で同じ時間・運賃とみなす)。
 */
export interface RouteLeg {
  id: string
  from: string
  to: string
  /** 乗車時間 (分) */
  minutes: number
  /** IC運賃 (円) */
  fareYen: number
  /** 乗換回数 */
  transfers: number
  /** 「JR◯◯線経由」などのメモ */
  via?: string
  /** from → to 方向の終電 (出発駅を出る時刻)。0時台は 00:30 のように書く */
  lastTrainFrom?: string
  /** to → from 方向の終電 */
  lastTrainTo?: string
}

/**
 * 時刻表の路線。どの駅を列として並べるかを路線ごとに覚えておく。
 * 常磐線と東武アーバンパークラインのように、扱う駅の違う路線を並行して持てる。
 */
export interface TimetableLine {
  id: string
  /** 「常磐線 上り」のように向きまで含めた呼び名 */
  name: string
  /** 時刻を入れる駅を、停車順に並べたもの */
  stations: string[]
  memo?: string
}

/** どの日に走る便か */
export type ServiceDays = 'weekday' | 'holiday' | 'all'

export const SERVICE_LABELS: Record<ServiceDays, string> = {
  weekday: '平日',
  holiday: '土休日',
  all: '毎日',
}

/**
 * 列車1本ぶんの時刻。
 *
 * 本数の少ない路線（常磐線など）だけ持てばよい。山手線のように数分間隔で来る路線は
 * 待ち時間がほとんど出ないので、区間の所要時間で計算したほうが実態に合う。
 */
export interface TrainRun {
  id: string
  /** 路線と向きの呼び名。「常磐線 上り」など */
  line: string
  serviceDays: ServiceDays
  /** 種別。「快速」「特別快速」など */
  kind?: string
  /** 行き先。「品川」など。ここで終わる便は、その先へは乗り換えが要る */
  destination?: string
  /** 特急など、追加料金が要る便 */
  surcharge?: boolean
  /** 停車駅と時刻。上流から下流の順に並べる */
  stops: Array<{ station: string; time: string }>
}

/** 定期券。区間に含まれる駅どうしの移動は運賃0円として計算する */
export interface Pass {
  id: string
  name: string
  /** 区間に含まれる駅を順に並べたもの */
  stations: string[]
  startDate: string
  endDate: string
  costYen: number
}

/** 趣味・関心。空き時間に何を提案するかの材料になる */
export interface Interest {
  id: string
  name: string
  /** これをやるのに最低限ほしい時間 (分) */
  minMinutes: number
  /** どこでできるか */
  spots: SpotKind[]
  /** 気分の乗る時間帯 (時)。空なら終日 */
  hours?: [number, number]
  memo?: string
}

/** やること・やりたいことリスト。空き時間に照合して提案する */
export interface Todo {
  id: string
  title: string
  /** 想定所要時間 (分) */
  minutes: number
  spots: SpotKind[]
  /** 1=いつでも 2=そのうち 3=優先 */
  priority: 1 | 2 | 3
  dueDate?: string
  interestId?: string
  doneAt?: string
  memo?: string
}

/** 大学の時限の時刻表。大学ごとに違うので設定で変えられる */
export interface PeriodTime {
  period: number
  start: string
  end: string
}

/** 半年間固定の授業 */
export interface Course {
  id: string
  name: string
  /** 0=日 〜 6=土 */
  day: number
  period: number
  room?: string
  placeId?: string
  startDate: string
  endDate: string
  /** 休講の日 (YYYY-MM-DD) */
  skipDates: string[]
  color?: string
}

export type EventCategory = 'baito' | 'trip' | 'jobhunt' | 'private' | 'other'

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  baito: 'バイト',
  trip: '旅行',
  jobhunt: '就活',
  private: '大事な予定',
  other: 'その他',
}

/** 単発の予定 */
export interface EventItem {
  id: string
  title: string
  category: EventCategory
  /** YYYY-MM-DD */
  date: string
  /** HH:MM */
  start: string
  end: string
  /** 登録済みの場所を使う場合 */
  placeId?: string
  /** 単発の行き先。駅名と駅からの徒歩分 */
  station?: string
  walkMinutes?: number
  /** 移動時間を逆算するか (自宅で完結する予定なら false) */
  needsTravel: boolean
  memo?: string
  tripId?: string
  /** バイトのとき */
  jobId?: string
  breakMinutes?: number
  /** コマ給制のバイトで、その日に受け持ったコマ数 */
  classCount?: number
  /** 選んだコマ (ClassSlot の id)。ここから時刻とコマ数が決まる */
  classSlotIds?: string[]
  /** 何分前に知らせるか。未設定なら通知しない */
  remindMinutesBefore?: number
}

/**
 * 給与の出し方。
 * hourly  … ふつうの時給制
 * perClass… 塾などのコマ給制（1コマいくら＋日当＋時間外の事務給）
 */
export type PayType = 'hourly' | 'perClass'

/** バイト先ごとのコマの定義。予定を作るとき、この中から選ぶと時刻が入る */
export interface ClassSlot {
  id: string
  /** コマの呼び名。X / Y / A / B など */
  label: string
  /** 授業の開始・終了 */
  start: string
  end: string
}

/**
 * ある日から適用される単価。昇給のたびに1件足す。
 * 書かれていない項目は、それより前の単価（最終的にはバイト先の初期値）を引き継ぐ。
 */
export interface JobRate {
  id: string
  /** この日から適用 (YYYY-MM-DD) */
  effectiveFrom: string
  hourlyYen?: number
  nightRate?: number
  perClassYen?: number
  classMinutes?: number
  dailyAllowanceYen?: number
  allowanceMinutes?: number
  officeHourlyYen?: number
  memo?: string
}

/** バイト先 */
export interface Job {
  id: string
  name: string
  /** 未設定の古いデータは時給制として扱う */
  payType?: PayType
  hourlyYen: number
  /** 深夜割増の倍率 (1.25 など) */
  nightRate: number
  /** 深夜帯の開始・終了 (HH:MM)。またぎを許す */
  nightStart: string
  nightEnd: string
  // --- コマ給制のとき ---
  /** 1コマあたりの金額 */
  perClassYen?: number
  /** 1コマの長さ(分) */
  classMinutes?: number
  /** 出勤1日につく日当 */
  dailyAllowanceYen?: number
  /** 日当がカバーする準備・片付けの時間(分) */
  allowanceMinutes?: number
  /** 授業でも日当でもカバーされない事務作業の時給 */
  officeHourlyYen?: number

  /** コマの定義。コマ給制のときに使う */
  classSlots?: ClassSlot[]
  /** 授業の何分前から在校するか */
  attendBeforeMinutes?: number
  /** 授業の何分後まで在校するか */
  attendAfterMinutes?: number

  /** 昇給の履歴。適用日の古い順に持つ */
  rates?: JobRate[]

  /** 交通費が支給されるか */
  transportPaid: boolean
  /** 1日あたりの支給額 (支給ありのとき) */
  transportPerDayYen: number
  /** 締め日。31 は月末扱い */
  closingDay: number
  /** 給料日 */
  payDay: number
  /** 締めから何か月後に支払われるか (翌月なら 1) */
  payMonthOffset: number
  placeId?: string
}

/** 旅行。交通費や宿代をまとめて集計する単位 */
export interface Trip {
  id: string
  name: string
  startDate: string
  endDate: string
  budgetYen?: number
  memo?: string
}

export type ExpenseCategory = 'commute' | 'jobhunt' | 'trip' | 'baito' | 'other'

export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  commute: '通学',
  jobhunt: '就活',
  trip: '旅行',
  baito: 'バイト',
  other: 'その他',
}

export type ExpenseKind = 'transport' | 'stay' | 'food' | 'ticket' | 'other'

export const KIND_LABELS: Record<ExpenseKind, string> = {
  transport: '交通',
  stay: '宿泊',
  food: '飲食',
  ticket: '入場料など',
  other: 'その他',
}

/** 支出1件 */
export interface Expense {
  id: string
  date: string
  amountYen: number
  category: ExpenseCategory
  kind: ExpenseKind
  label: string
  /** 電車 / 新幹線 / バス / 飛行機 など */
  means?: string
  tripId?: string
  /** 支給・精算されるぶんか (就活の交通費支給など)。実質負担から除く */
  reimbursed: boolean
  /** アプリが登録区間から自動で作った記録か */
  auto: boolean
  memo?: string
}

/** 自分の設定 */
export interface Profile {
  /** 自宅の最寄り駅 */
  homeStation: string
  /** 家から最寄り駅までの時間 (分) */
  homeToStationMinutes: number
  /** その手段 (徒歩 / 自転車 / バス) */
  homeToStationMethod: string
  /** 乗り遅れないための余裕 (分) */
  bufferMinutes: number
  /** 家を出る前の準備時間 (分) */
  prepMinutes: number
  /** 今の状況。提案の材料にする自由記述 */
  situation: string
  /** 学期の期間。時間割を作るときの既定値として使う */
  termStart?: string
  termEnd?: string
  periods: PeriodTime[]
}

export const DEFAULT_PROFILE: Profile = {
  homeStation: '',
  homeToStationMinutes: 10,
  homeToStationMethod: '徒歩',
  bufferMinutes: 10,
  prepMinutes: 30,
  situation: '',
  periods: [
    { period: 1, start: '09:00', end: '10:30' },
    { period: 2, start: '10:40', end: '12:10' },
    { period: 3, start: '13:00', end: '14:30' },
    { period: 4, start: '14:40', end: '16:10' },
    { period: 5, start: '16:20', end: '17:50' },
    { period: 6, start: '18:00', end: '19:30' },
  ],
}
