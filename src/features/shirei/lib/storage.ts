import { clear, createStore, get, set } from 'idb-keyval'
import type {
  DailyReview,
  DayPlan,
  Exam,
  Company,
  SelectionEvent,
  Settings,
  StudyNode,
  SleepLog,
  StudySession,
  Task,
  TaskLog,
  WeeklyReview,
} from '../types'
import { DEFAULT_SETTINGS } from '../types'

/** アプリが持つデータ一式 */
export interface AppData {
  settings: Settings
  tasks: Task[]
  plans: DayPlan[]
  logs: TaskLog[]
  reviews: DailyReview[]
  // --- 学習 OS (Phase 2) ---
  nodes: StudyNode[]
  exams: Exam[]
  sessions: StudySession[]
  // --- 就活 OS (Phase 4) ---
  companies: Company[]
  selections: SelectionEvent[]
  // --- 週次レビュー (Phase 5) ---
  weeklyReviews: WeeklyReview[]
  // --- 睡眠 ---
  sleepLogs: SleepLog[]
}

export const EMPTY_DATA: AppData = {
  settings: DEFAULT_SETTINGS,
  tasks: [],
  plans: [],
  logs: [],
  reviews: [],
  nodes: [],
  exams: [],
  sessions: [],
  companies: [],
  selections: [],
  weeklyReviews: [],
  sleepLogs: [],
}

/**
 * データ永続化層。
 * 今は IndexedDB (端末ローカル) だけだが、Repository 越しに使うことで
 * 将来クラウド同期の実装に差し替えられるようにしている。よてい帳・筋トレログと同じ形。
 */
export interface Repository {
  loadAll(): Promise<AppData>
  save<K extends keyof AppData>(key: K, value: AppData[K]): Promise<void>
  clearAll(): Promise<void>
}

/**
 * DB 名はアプリごとに分ける。
 * 同じオリジン (banz-hub.github.io) に 3 アプリが同居するので、
 * ここが衝突しないことが連携の前提になっている。
 */
const store = createStore('personal-manager', 'state')

const KEYS = Object.keys(EMPTY_DATA) as Array<keyof AppData>

class IndexedDbRepository implements Repository {
  async loadAll(): Promise<AppData> {
    const entries = await Promise.all(
      KEYS.map(async (key) => [key, await get(key as string, store)] as const),
    )
    const data: AppData = { ...EMPTY_DATA }
    for (const [key, value] of entries) {
      if (value === undefined) continue
      if (key === 'settings') {
        // 項目が増えることがあるので、既定値に上書きする形で読む
        data.settings = { ...DEFAULT_SETTINGS, ...(value as Partial<Settings>) }
      } else {
        Object.assign(data, { [key]: value })
      }
    }
    return data
  }

  async save<K extends keyof AppData>(key: K, value: AppData[K]): Promise<void> {
    await set(key as string, value, store)
  }

  async clearAll(): Promise<void> {
    await clear(store)
  }
}

export const repository: Repository = new IndexedDbRepository()

// ---------- バックアップ ----------

export interface BackupPayload extends AppData {
  version: 1
  app: 'personal-manager'
  exportedAt: string
}

export function buildBackup(data: AppData): BackupPayload {
  return { version: 1, app: 'personal-manager', exportedAt: new Date().toISOString(), ...data }
}

export function parseBackup(raw: unknown): AppData {
  const data = raw as Partial<BackupPayload> | null
  if (!data || data.app !== 'personal-manager' || data.version !== 1) {
    throw new Error('エージェントのバックアップの形式ではありません')
  }
  return {
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
    tasks: data.tasks ?? [],
    plans: data.plans ?? [],
    logs: data.logs ?? [],
    reviews: data.reviews ?? [],
    // 学習 OS より前のバックアップには入っていない
    nodes: data.nodes ?? [],
    exams: data.exams ?? [],
    sessions: data.sessions ?? [],
    companies: data.companies ?? [],
    selections: data.selections ?? [],
    weeklyReviews: data.weeklyReviews ?? [],
    // 睡眠より前のバックアップには入っていない
    sleepLogs: data.sleepLogs ?? [],
  }
}

export function backupFilename(): string {
  const d = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `agent-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}.json`
}

/**
 * 読み込んだものを置き場へ書く。まるごと上書き。
 * まとめて読み込むときの窓口 (src/app/backup.ts) から呼ぶ。
 */
export async function restoreAll(data: AppData): Promise<void> {
  for (const key of KEYS) {
    await repository.save(key, data[key])
  }
}
