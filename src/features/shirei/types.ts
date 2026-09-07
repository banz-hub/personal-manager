/**
 * アプリ全体で使うデータ型。すべて端末ローカル (IndexedDB) に保存される。
 *
 * Phase 1 は 5 つ (Task / DayPlan / TaskLog / DailyReview / Settings)。
 * Phase 2 で学習 OS の 3 つ (StudyNode / Exam / StudySession) を足した。
 * 就活の企業は、実際に作る Phase 4 まで型を足さない。
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

/**
 * 繰り返しの決まり。
 * 「毎週月曜の課題」のように、終わってもまた出てくるものを表す。
 * 継続タスク (recurring) とは別物で、あちらは毎日すこしずつ進めるもの。
 */
export interface TaskRepeat {
  kind: 'daily' | 'weekly' | 'monthly'
  /** weekly のとき。0=日 〜 6=土 */
  days?: number[]
  /** monthly のとき。1〜31 */
  dayOfMonth?: number
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
  /** どの企業のタスクか (就活のとき) */
  companyId?: string
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
  /** 決まった曜日に出てくるタスク。完了すると次の日付で作り直す */
  repeat?: TaskRepeat
  note?: string
}

/** 予定表の 1 コマ */
export type BlockKind = 'task' | 'study' | 'workout' | 'break' | 'buffer' | 'fixed'

export interface PlanBlock {
  id: string
  /** HH:MM */
  start: string
  end: string
  kind: BlockKind
  taskId?: string
  /** 学習項目を置いたとき (kind === 'study') */
  nodeId?: string
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
  /** 予定に入れた学習項目のうち、記録がついたもの / つかなかったもの */
  doneNodeIds: string[]
  undoneNodeIds: string[]
  plannedMin: number
  actualMin: number
  /** そのうち学習にあてた分 */
  studyMin: number
  /** 筋トレの実績 (分)。正本は筋トレログなので、こちらは読んだ値を写すだけ */
  workoutMin: number
  workoutDone: boolean
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
  /** 学習 1 回あたりの長さの上限 (分) */
  studyChunkMin: number
  /** 1 日に予定へ載せる学習項目の上限。多すぎると今日の話でなくなる */
  studyPerDayMax: number
  /** 筋トレログから今日のトレーニングを読むか */
  useKintore: boolean
  /** 前日の負荷が高い日は、詰め込みの上限を自動で下げるか */
  easeAfterWorkout: boolean
  /** 通知を出すか */
  notifyEnabled: boolean
  /** コマの何分前に知らせるか */
  notifyBeforeMin: number
  /** 最後にデータを書き出した日 (YYYY-MM-DD)。催促の判定に使う */
  lastBackupOn?: string
  /** 朝と夜の案内を出すか */
  showRoutine: boolean
  /** 起きた時刻・寝る目標に合わせて今日の予定を組み直すか */
  useSleep: boolean
  /** 目標の睡眠時間 (分) */
  targetSleepMin: number
  /** 目標の就寝時刻。ここから逆算して夜の作業の終わりを決める */
  targetBedtime: string
  /** 起きてから作業に入るまでの支度 (分) */
  wakeBufferMin: number
  /** 寝る前に必要な支度 (分) */
  bedtimeBufferMin: number
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
  studyChunkMin: 30,
  studyPerDayMax: 4,
  useKintore: true,
  easeAfterWorkout: true,
  notifyEnabled: true,
  notifyBeforeMin: 10,
  useSleep: true,
  // 大学生の必要量として一般に言われる 7〜9 時間の下寄り
  targetSleepMin: 450,
  targetBedtime: '23:30',
  wakeBufferMin: 30,
  bedtimeBufferMin: 30,
  showRoutine: true,
  updatedAt: '',
}

// ==================== 学習 OS (Phase 2) ====================

/**
 * 学習の階層のノード。科目・単元・テーマ・学習項目をこの 1 つの型で表す。
 *
 * 4 段の型を別々に作らず parentId でつないだのは、
 * 段数が科目によって違うため。「数学 → 位相空間論 → 開集合」で足りるものもあれば、
 * 「教職 → 教育心理 → 発達段階 → ピアジェ」まで要るものもある。
 * 型を段ごとに分けると、浅い科目に空の段ができるか、深い科目が入らなくなる。
 */
export interface StudyNode {
  id: string
  /** 親のノード id。無ければ科目 (いちばん上) */
  parentId?: string
  title: string
  /** 科目 (ルート) にだけ入れる。子は親をたどって受け継ぐ */
  area?: TaskArea
  /**
   * 理解度。子を持つノードには入れない (子から集計して出す)。
   * 葉 = 実際に勉強する単位、という区別をここでつけている。
   */
  mastery?: Mastery
  /** 学習上の重要度 */
  importance: Importance
  /** ひととおり終えるのに要る見込み (分)。1 回の学習の長さの目安にもする */
  estimateMin: number
  /** 表示順 */
  order: number
  createdAt: string
  note?: string
}

/** 学習項目の状態 */
export type Mastery = 'new' | 'learning' | 'understood' | 'needs-review' | 'mastered'

export const MASTERY_LABELS: Record<Mastery, string> = {
  new: '未学習',
  learning: '学習中',
  understood: '理解',
  'needs-review': '要復習',
  mastered: '習得',
}

/** 表示や集計で使う並び順 (弱いものが先) */
export const MASTERY_ORDER: Mastery[] = [
  'new',
  'needs-review',
  'learning',
  'understood',
  'mastered',
]

/**
 * 理解度ごとの「残りどれくらい手が要るか」の係数。
 * 必要学習時間の逆算に使う。習得済みは 0 (もう時間を積まない)。
 */
export const MASTERY_REMAINING: Record<Mastery, number> = {
  new: 1,
  'needs-review': 0.6,
  learning: 0.7,
  understood: 0.35,
  mastered: 0,
}

/**
 * 次に復習するまでの間隔 (日)。
 * 忘れかけた頃に出すのが目的なので、理解が進むほど間隔を空ける。
 * new は「まだ復習ではなく初回学習」なので間隔を持たない。
 */
export const REVIEW_INTERVAL_DAYS: Record<Mastery, number | null> = {
  new: null,
  'needs-review': 1,
  learning: 2,
  understood: 5,
  mastered: 14,
}

export interface Exam {
  id: string
  title: string
  /** YYYY-MM-DD */
  date: string
  /** 試験範囲。ここに挙げたノードとその配下すべてが範囲になる */
  scopeNodeIds: string[]
  importance: Importance
  createdAt: string
  note?: string
}

/**
 * 学習の記録。1 回勉強するごとに 1 件。
 *
 * 最終学習日・学習時間・復習回数・正答率はここから集計して出す。
 * ノードに書き戻すと、記録と表示が食い違ったときに直せなくなるため。
 */
export interface StudySession {
  id: string
  nodeId: string
  /** YYYY-MM-DD */
  date: string
  minutes: number
  /** 終えたときの手応え。ノードの mastery もこれで更新する */
  mastery?: Mastery
  /** 問題を解いたときだけ */
  correct?: number
  attempted?: number
  createdAt: string
  note?: string
}

// ==================== 就活 OS (Phase 4) ====================

/** 選考の段階。順番に進む前提で並べてある */
export type SelectionStage =
  | 'none'
  | 'research'
  | 'es-draft'
  | 'es-sent'
  | 'briefing'
  | 'test'
  | 'interview1'
  | 'interview2'
  | 'interview-final'
  | 'offer'
  | 'declined'
  | 'rejected'

export const STAGE_LABELS: Record<SelectionStage, string> = {
  none: '未応募',
  research: '企業研究',
  'es-draft': 'ES準備',
  'es-sent': 'ES提出',
  briefing: '説明会',
  test: '適性検査',
  interview1: '一次面接',
  interview2: '二次面接',
  'interview-final': '最終面接',
  offer: '内定',
  declined: '辞退',
  rejected: 'お祈り',
}

/** 進行中の段階。ここに居る企業だけ「次にやること」を出す */
export const ACTIVE_STAGES: SelectionStage[] = [
  'none',
  'research',
  'es-draft',
  'es-sent',
  'briefing',
  'test',
  'interview1',
  'interview2',
  'interview-final',
]

/** 選考が終わった段階 */
export const CLOSED_STAGES: SelectionStage[] = ['offer', 'declined', 'rejected']

/**
 * 企業について調べた「事実」。
 *
 * 評価 (ratings) と必ず分けて持つ。
 * 「年間休日125日」は調べれば分かる事実、「ワークライフバランス ★★★★★」は自分の見立て。
 * 同じ欄に混ぜると、あとで見返したときにどちらだったのか分からなくなる。
 */
export interface CompanyFacts {
  /** 初任給・想定年収 (万円) */
  salaryManYen?: number
  /** 勤務地 */
  location?: string
  /** 年間休日 */
  holidaysPerYear?: number
  /** 平均残業 (時間/月) */
  overtimeHoursPerMonth?: number
  /** 福利厚生。調べて書き写したもの */
  benefits?: string
  /** 離職率 (%) */
  turnoverRate?: number
  /** 従業員数 */
  employees?: number
  /** どこで調べたか。事実には出どころを残す */
  source?: string
}

/** 自分の見立て。1〜5 で、根拠は memo に書く */
export interface CompanyRatings {
  workLife?: number
  growth?: number
  culture?: number
  stability?: number
  /** 自分との適合度 */
  fit?: number
}

export const RATING_LABELS: Record<keyof CompanyRatings, string> = {
  workLife: 'ワークライフ',
  growth: '成長',
  culture: '社風',
  stability: '安定性',
  fit: '自分との相性',
}

export interface Company {
  id: string
  name: string
  industry?: string
  /** 職種 */
  role?: string
  stage: SelectionStage
  /** 志望度 1〜5 */
  interest: number
  url?: string
  memo?: string
  facts: CompanyFacts
  ratings: CompanyRatings
  createdAt: string
  updatedAt: string
}

/** 選考の予定 1 件。ES の締切も説明会も面接もこれで表す */
export type SelectionKind = 'es' | 'briefing' | 'test' | 'interview' | 'other'

export const SELECTION_KIND_LABELS: Record<SelectionKind, string> = {
  es: 'ES締切',
  briefing: '説明会',
  test: '適性検査',
  interview: '面接',
  other: 'その他',
}

export interface SelectionEvent {
  id: string
  companyId: string
  kind: SelectionKind
  title: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM。締切なら締切時刻、面接なら開始時刻 */
  time?: string
  place?: string
  note?: string
  /** 済んだか */
  doneAt?: string
  createdAt: string
}

// ==================== 週次レビュー (Phase 5) ====================

export interface WeeklyReview {
  /** 週の開始日 (月曜) をそのまま id にする */
  id: string
  weekStart: string
  weekEnd: string
  /** その週に計算した内容をそのまま残す。あとでデータが変わっても当時の姿が見える */
  summary: WeeklySummary
  note?: string
  createdAt: string
}

export interface WeeklySummary {
  weekStart: string
  weekEnd: string
  tasks: {
    planned: number
    done: number
    deferred: number
    /** 0〜1 */
    completionRate: number
    deferRate: number
    plannedMin: number
    actualMin: number
    /** 実績 ÷ 予定。1 より大きいと見積もりが甘い。ログが無ければ null */
    estimateRatio: number | null
  }
  study: {
    totalMin: number
    sessions: number
    /** 分野ごとの学習時間。多い順 */
    byArea: Array<[TaskArea, number]>
    /** その週に習得まで進んだ項目数 */
    masteredCount: number
  }
  jobhunt: {
    esCount: number
    briefingCount: number
    interviewCount: number
    /** 選考が動いている企業数 */
    activeCompanies: number
    /** 3 日以内に迫っている予定 */
    upcomingCount: number
  }
  workout: {
    count: number
    totalMin: number
    restDays: number
    /** 読めなかったときは null */
    available: boolean
  }
  improvements: string[]
}

// ---------- 睡眠 ----------

/**
 * ひと晩ぶんの睡眠。
 *
 * 二度寝を別の記録にせず、同じ晩の中の 2 つ目の区間として持つ。
 * 「6時に起きて6時10分に二度寝して7時半に起きた」を
 * 「2回寝た」ではなく「1晩のうちに1回起きた」として数えたいため。
 */
export interface SleepLog {
  id: string
  /** 起きた日 (YYYY-MM-DD)。日付をまたぐので、寝た日ではなく起きた日で数える */
  date: string
  /** 寝ていた区間。`to` が無いものは、いま寝ている最中 */
  spans: Array<{ from: string; to?: string }>
  note?: string
}

/** 睡眠の評価 */
export type SleepRating = 'good' | 'fair' | 'short' | 'broken'

export const SLEEP_RATING_LABELS: Record<SleepRating, string> = {
  good: 'よく眠れている',
  fair: 'まずまず',
  short: '足りていない',
  broken: '細切れ',
}
