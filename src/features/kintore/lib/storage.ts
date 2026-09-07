import { del, get, set } from 'idb-keyval'
import { kintoreStore } from '../bridge'
import type { BodyWeightEntry, Exercise, Goal, Profile, WorkoutSession } from '../types'

/**
 * データ永続化層。
 * 現在は IndexedDB (端末ローカル) 実装のみだが、Repository インターフェース越しに
 * 使うことで将来クラウド同期実装に差し替えられるようにしている。
 */
export interface Repository {
  loadProfile(): Promise<Profile | null>
  saveProfile(profile: Profile): Promise<void>
  loadGoal(): Promise<Goal | null>
  saveGoal(goal: Goal): Promise<void>
  loadSessions(): Promise<WorkoutSession[]>
  saveSessions(sessions: WorkoutSession[]): Promise<void>
  loadWeights(): Promise<BodyWeightEntry[]>
  saveWeights(weights: BodyWeightEntry[]): Promise<void>
  loadCustomExercises(): Promise<Exercise[]>
  saveCustomExercises(list: Exercise[]): Promise<void>
  clearAll(): Promise<void>
}

const KEY_PROFILE = 'profile'
const KEY_GOAL = 'goal'
const KEY_SESSIONS = 'sessions'
const KEY_WEIGHTS = 'weights'
const KEY_CUSTOM_EXERCISES = 'customExercises'

/** 置き場の名前はここでは決めない。ほかの機能からも同じものを使うため */
const store = kintoreStore

class IndexedDbRepository implements Repository {
  async loadProfile() {
    return (await get<Profile>(KEY_PROFILE, store)) ?? null
  }
  async saveProfile(profile: Profile) {
    await set(KEY_PROFILE, profile, store)
  }
  async loadGoal() {
    return (await get<Goal>(KEY_GOAL, store)) ?? null
  }
  async saveGoal(goal: Goal) {
    await set(KEY_GOAL, goal, store)
  }
  async loadSessions() {
    return (await get<WorkoutSession[]>(KEY_SESSIONS, store)) ?? []
  }
  async saveSessions(sessions: WorkoutSession[]) {
    await set(KEY_SESSIONS, sessions, store)
  }
  async loadWeights() {
    return (await get<BodyWeightEntry[]>(KEY_WEIGHTS, store)) ?? []
  }
  async saveWeights(weights: BodyWeightEntry[]) {
    await set(KEY_WEIGHTS, weights, store)
  }
  async loadCustomExercises() {
    return (await get<Exercise[]>(KEY_CUSTOM_EXERCISES, store)) ?? []
  }
  async saveCustomExercises(list: Exercise[]) {
    await set(KEY_CUSTOM_EXERCISES, list, store)
  }
  async clearAll() {
    await Promise.all([
      del(KEY_PROFILE, store),
      del(KEY_GOAL, store),
      del(KEY_SESSIONS, store),
      del(KEY_WEIGHTS, store),
      del(KEY_CUSTOM_EXERCISES, store),
    ])
  }
}

export const repository: Repository = new IndexedDbRepository()

export interface BackupPayload {
  version: 1 | 2 | 3
  exportedAt: string
  profile: Profile | null
  goal: Goal | null
  sessions: WorkoutSession[]
  /** version 2 から。古いバックアップには存在しない */
  weights?: BodyWeightEntry[]
  /** version 3 から。ユーザーが追加した種目 */
  customExercises?: Exercise[]
}

export async function exportBackup(): Promise<BackupPayload> {
  const [profile, goal, sessions, weights, customExercises] = await Promise.all([
    repository.loadProfile(),
    repository.loadGoal(),
    repository.loadSessions(),
    repository.loadWeights(),
    repository.loadCustomExercises(),
  ])
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    profile,
    goal,
    sessions,
    weights,
    customExercises,
  }
}

export async function importBackup(raw: unknown): Promise<void> {
  const data = raw as Partial<BackupPayload>
  if (!data || ![1, 2, 3].includes(data.version as number)) {
    throw new Error('対応していないバックアップ形式です')
  }
  if (data.profile) await repository.saveProfile(data.profile)
  if (data.goal) await repository.saveGoal(data.goal)
  await repository.saveSessions(data.sessions ?? [])
  await repository.saveCustomExercises(data.customExercises ?? [])
  // version 1 には体重ログが無いので、記録に残っている体重から復元する
  const weights =
    data.weights ??
    (data.sessions ?? [])
      .filter((s) => s.bodyWeightKg != null)
      .map((s) => ({ date: s.date, weightKg: s.bodyWeightKg as number }))
  await repository.saveWeights(dedupeWeights(weights))
}

/** 同じ日付は後勝ちで1件にまとめ、日付順に並べる */
export function dedupeWeights(entries: BodyWeightEntry[]): BodyWeightEntry[] {
  const map = new Map<string, number>()
  for (const e of entries) map.set(e.date, e.weightKg)
  return [...map.entries()]
    .map(([date, weightKg]) => ({ date, weightKg }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
