import { clear, get, set } from 'idb-keyval'
import { yoteiStore } from '../bridge'
import type {
  Course,
  EventItem,
  Expense,
  Interest,
  Job,
  Pass,
  Place,
  Profile,
  RouteLeg,
  Todo,
  TimetableLine,
  TrainRun,
  Trip,
} from '../types'
import { DEFAULT_PROFILE } from '../types'
import { shiftLabelsOf } from './classSlots'

/** アプリが持つデータ一式 */
export interface AppData {
  profile: Profile
  places: Place[]
  legs: RouteLeg[]
  runs: TrainRun[]
  timetableLines: TimetableLine[]
  passes: Pass[]
  courses: Course[]
  events: EventItem[]
  jobs: Job[]
  trips: Trip[]
  expenses: Expense[]
  todos: Todo[]
  interests: Interest[]
}

export const EMPTY_DATA: AppData = {
  profile: DEFAULT_PROFILE,
  places: [],
  legs: [],
  runs: [],
  timetableLines: [],
  passes: [],
  courses: [],
  events: [],
  jobs: [],
  trips: [],
  expenses: [],
  todos: [],
  interests: [],
}

/**
 * 古いバイトの予定の名前を、いまの書き方に揃える。
 *
 * 以前は「バイト BCD」と名前を付けていた。いまはコマだけ（バイトかどうかは色で分かる）。
 * すでに入っている予定まで直せないと、同じ画面に 2 つの書き方が並ぶので、**読むときに揃える。**
 * 直すのは読む側だけで、次にその予定を保存したときに新しい書き方で残る。
 * 自分で書いた名前（「明光 テスト対策」）は「バイト」で始まらないので触らない。
 */
export function dropShiftPrefix(events: EventItem[]): EventItem[] {
  return events.map((e) => {
    if (e.category !== 'baito') return e
    const labels = shiftLabelsOf(e.title)
    return labels ? { ...e, title: labels } : e
  })
}

/**
 * データ永続化層。
 * 今は IndexedDB (端末ローカル) だけだが、Repository 越しに使うことで
 * 将来クラウド同期の実装に差し替えられるようにしている。
 */
export interface Repository {
  loadAll(): Promise<AppData>
  save<K extends keyof AppData>(key: K, value: AppData[K]): Promise<void>
  clearAll(): Promise<void>
}

/** 置き場の名前はここでは決めない。ほかの機能からも同じものを使うため */
const store = yoteiStore

const KEYS = Object.keys(EMPTY_DATA) as Array<keyof AppData>

class IndexedDbRepository implements Repository {
  async loadAll(): Promise<AppData> {
    const entries = await Promise.all(
      KEYS.map(async (key) => [key, await get(key as string, store)] as const),
    )
    const data = { ...EMPTY_DATA }
    for (const [key, value] of entries) {
      if (value === undefined) continue
      // profile は項目が増えることがあるので、既定値に上書きする形で読む
      if (key === 'profile') {
        data.profile = { ...DEFAULT_PROFILE, ...(value as Partial<Profile>) }
        if (!data.profile.periods?.length) data.profile.periods = DEFAULT_PROFILE.periods
      } else {
        // キーごとの型は KEYS の対応で保証されている
        Object.assign(data, { [key]: value })
      }
    }
    data.events = dropShiftPrefix(data.events)
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
  app: 'yoteicho'
  exportedAt: string
}

export function buildBackup(data: AppData): BackupPayload {
  return { version: 1, app: 'yoteicho', exportedAt: new Date().toISOString(), ...data }
}

/**
 * バックアップを読み込んで AppData に戻す。
 * 端末を替えたとき (iPhone → Android など) の引っ越しはこれで行う。
 */
export function parseBackup(raw: unknown): AppData {
  const data = raw as Partial<BackupPayload> | null
  if (!data || data.app !== 'yoteicho' || data.version !== 1) {
    throw new Error('よてい帳のバックアップの形式ではありません')
  }
  return {
    profile: { ...DEFAULT_PROFILE, ...data.profile },
    places: data.places ?? [],
    legs: data.legs ?? [],
    runs: data.runs ?? [],
    timetableLines: data.timetableLines ?? [],
    passes: data.passes ?? [],
    courses: data.courses ?? [],
    events: dropShiftPrefix(data.events ?? []),
    jobs: data.jobs ?? [],
    trips: data.trips ?? [],
    expenses: data.expenses ?? [],
    todos: data.todos ?? [],
    interests: data.interests ?? [],
  }
}

export function backupFilename(): string {
  const d = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `yoteicho-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}.json`
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
