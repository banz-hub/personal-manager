/**
 * アプリ全体で使うデータ型。すべて端末ローカル (IndexedDB) に保存される。
 *
 * MVP では 5 つだけに絞ってある (Task / DayPlan / TaskLog / DailyReview / Settings)。
 * 学習 OS の科目や就活の企業は、実際に作る Phase まで型を足さない。
 * 先に作ると、使う頃には形が合わなくなるため。
 */

/** タスクの分野。優先順位の説明と、日次レビューの内訳に使う */
export type TaskArea = 'math' | 'teaching' | 'cert' | 'english' | 'jobhunt' | 'life' | 'other'

export const AREA_LABELS: Record<TaskArea, string> = {
  math: '数学',
  teaching: '教職',
  cert: '資格',
  english: '英語',
  jobhunt: '就活',
  life: '生活',
  other: 'その他',
}

export type TaskStatus = 'todo' | 'doing' | 'done' | 'dropped'

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '未着手',
  doing: '着手済み',
  done: '完了',
  dropped: 'やめた',
}

/** 3=高 2=中 1=低 */
export type Importance = 1 | 2 | 3

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  3: '高',
  2: '中',
  1: '低',
}

export interface Task {
  id: string
  title: string
  area: TaskArea
  status: TaskStatus
  /** 締切の日 (YYYY-MM-DD)。無ければ締切なし */
  dueDate?: string
  /** 締切の時刻 (HH:MM)。dueDate があって未設定なら 23:59 として扱う */
  dueTime?: string
  /**
   * 残りの見積もり (分)。
   * 長期タスク (公務員試験 30000 分など) もここに全体を入れ、
   * 1 回に取り組む長さは chunkMin で決める。
   */
  estimateMin: number
  /**
   * 1 回に取り組む長さ (分)。未設定なら estimateMin をそのまま 1 回で行う。
   * 「英語 20 分」のような継続タスクや、長期タスクの分割に使う。
   */
  chunkMin?: number
  importance: Importance
  /** 毎日・定期的に少しずつ進めるタスク。今日の一覧では「継続」に入る */
  recurring?: boolean
  /** 分解した親タスクの id */
  parentId?: string
  createdAt: string
  startedAt?: string
  doneAt?: string
  /** この日は必ず今日の一覧に出す (YYYY-MM-DD) */
  pinnedDate?: string
  /** 先送りした回数。多いほど優先順位が上がる */
  deferCount?: number
  /** 最後に先送りした日 (YYYY-MM-DD) */
  deferredOn?: string
  /** 最後に取り組んだ日 (YYYY-MM-DD)。継続タスクの間隔を見るのに使う */
  lastWorkedOn?: string
  note?: string
}

/** 予定表の 1 コマ */
export type BlockKind = 'task' | 'break' | 'buffer' | 'fixed'

export interface PlanBlock {
  id: string
  /** HH:MM */
  start: string
  end: string
  kind: BlockKind
  taskId?: string
  title: string
  /** なぜここに置いたか。ユーザーが納得して実行できるように必ず入れる */
  reason?: string
  doneAt?: string
  /** 実績時間 (分)。完了時に入る */
  actualMin?: number
}

/** ある日のために生成した予定表。日付ごとに 1 つ */
export interface DayPlan {
  /** YYYY-MM-DD。1 日 1 つなので日付をそのまま id にする */
  id: string
  date: string
  blocks: PlanBlock[]
  generatedAt: string
  /** ユーザーが「これでいく」と決めた時刻。未承認なら未設定 */
  approvedAt?: string
  /** 生成に使った空き時間の合計 (分) */
  freeMin: number
  /** そのうち作業に割り当てた分の割合 */
  fillRatio: number
  /** 生成時の所見。「5 時間は入らないので 3 時間半にした」など */
  notes: string[]
}

/**
 * 実績の記録。見積もりの精度を上げるためだけに使う。
 * 予定と実績の比を貯めておき、次回の見積もりを補正する。
 */
export interface TaskLog {
  id: string
  taskId: string
  /** YYYY-MM-DD */
  date: string
  area: TaskArea
  /** そのとき予定していた分数 */
  plannedMin: number
  /** 実際にかかった分数 */
  actualMin: number
  createdAt: string
}

export interface DailyReview {
  /** YYYY-MM-DD。1 日 1 つ */
  id: string
  date: string
  doneTaskIds: string[]
  undoneTaskIds: string[]
  /** 明日以降に送ったタスク */
  deferredTaskIds: string[]
  plannedMin: number
  actualMin: number
  /** ルールで導いた所見。「見積もりが甘い」「開始が遅かった」など */
  findings: string[]
  note?: string
  createdAt: string
}

export interface Settings {
  /** 活動を始める時刻 */
  dayStart: string
  /** 活動を終える時刻 */
  dayEnd: string
  /**
   * 空き時間のうち作業に使う上限の割合。
   * 残りはバッファとして空けておく。詰め込みすぎを防ぐための上限。
   */
  fillRatio: number
  /** 何分続けたら休憩を挟むか */
  workBeforeBreakMin: number
  /** 休憩の長さ (分) */
  breakMin: number
  /** これより短い空き時間は使わない */
  minSlotMin: number
  /** よてい帳から今日の予定を読むか */
  useYoteicho: boolean
  /**
   * 場所が変わる予定の間で見込む移動時間 (分)。
   * 経路の計算はよてい帳の担当なので、こちらは粗く引き当てるだけ。
   */
  travelAllowanceMin: number
  updatedAt: string
}

export const DEFAULT_SETTINGS: Settings = {
  dayStart: '08:00',
  dayEnd: '23:00',
  // 8 割まで。残り 2 割は必ず空けておく
  fillRatio: 0.8,
  workBeforeBreakMin: 60,
  breakMin: 10,
  minSlotMin: 20,
  useYoteicho: true,
  travelAllowanceMin: 60,
  updatedAt: '',
}
