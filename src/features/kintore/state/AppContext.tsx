import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { EXERCISES, buildExerciseMap, type ExerciseMap } from '../data/exercises'
import { dedupeWeights, repository } from '../lib/storage'
import type { BodyWeightEntry, Exercise, Goal, Profile, WorkoutSession } from '../types'

interface AppState {
  ready: boolean
  profile: Profile | null
  goal: Goal | null
  sessions: WorkoutSession[]
  weights: BodyWeightEntry[]
  /** ユーザーが追加した種目 */
  customExercises: Exercise[]
  /** 組み込み + ユーザー追加。メニュー生成や表示はこちらを使う */
  exercises: Exercise[]
  exerciseMap: ExerciseMap
  saveProfile: (p: Omit<Profile, 'updatedAt'>) => Promise<void>
  saveGoal: (g: Omit<Goal, 'updatedAt'>) => Promise<void>
  upsertSession: (s: WorkoutSession) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  /** 体重を記録する。最新日ならプロフィールの体重も合わせて更新する */
  logWeight: (date: string, weightKg: number) => Promise<void>
  deleteWeight: (date: string) => Promise<void>
  saveCustomExercise: (exercise: Exercise) => Promise<void>
  deleteCustomExercise: (id: string) => Promise<void>
  reload: () => Promise<void>
  resetAll: () => Promise<void>
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [goal, setGoal] = useState<Goal | null>(null)
  const [sessions, setSessions] = useState<WorkoutSession[]>([])
  const [weights, setWeights] = useState<BodyWeightEntry[]>([])
  const [customExercises, setCustomExercises] = useState<Exercise[]>([])

  const reload = useCallback(async () => {
    const [p, g, s, w, ce] = await Promise.all([
      repository.loadProfile(),
      repository.loadGoal(),
      repository.loadSessions(),
      repository.loadWeights(),
      repository.loadCustomExercises(),
    ])
    setProfile(p)
    setGoal(g)
    setSessions(s)
    setWeights(dedupeWeights(w))
    setCustomExercises(ce)
    setReady(true)
  }, [])

  useEffect(() => {
    reload().catch((err) => {
      console.error('データの読み込みに失敗しました', err)
      setReady(true)
    })
  }, [reload])

  const saveProfile = useCallback(async (p: Omit<Profile, 'updatedAt'>) => {
    const next: Profile = { ...p, updatedAt: new Date().toISOString() }
    await repository.saveProfile(next)
    setProfile(next)
  }, [])

  const saveGoal = useCallback(async (g: Omit<Goal, 'updatedAt'>) => {
    const next: Goal = { ...g, updatedAt: new Date().toISOString() }
    await repository.saveGoal(next)
    setGoal(next)
  }, [])

  const upsertSession = useCallback(async (s: WorkoutSession) => {
    setSessions((prev) => {
      const idx = prev.findIndex((x) => x.id === s.id)
      const next = idx >= 0 ? prev.map((x) => (x.id === s.id ? s : x)) : [...prev, s]
      // 記録日を後から変更しても一覧の並びが崩れないよう、日付を優先して並べる
      next.sort((a, b) => b.date.localeCompare(a.date) || b.startedAt.localeCompare(a.startedAt))
      void repository.saveSessions(next)
      return next
    })
  }, [])

  const deleteSession = useCallback(async (id: string) => {
    setSessions((prev) => {
      const next = prev.filter((x) => x.id !== id)
      void repository.saveSessions(next)
      return next
    })
  }, [])

  const logWeight = useCallback(async (date: string, weightKg: number) => {
    if (!Number.isFinite(weightKg) || weightKg <= 0) return
    let latest = false
    setWeights((prev) => {
      const next = dedupeWeights([...prev, { date, weightKg }])
      latest = next[next.length - 1]?.date === date
      void repository.saveWeights(next)
      return next
    })
    // 最新の記録ならプロフィールの体重にも反映し、BMI や目標計算を現在値に保つ
    if (latest) {
      setProfile((prev) => {
        if (!prev || prev.weightKg === weightKg) return prev
        const next = { ...prev, weightKg, updatedAt: new Date().toISOString() }
        void repository.saveProfile(next)
        return next
      })
    }
  }, [])

  const deleteWeight = useCallback(async (date: string) => {
    setWeights((prev) => {
      const next = prev.filter((w) => w.date !== date)
      void repository.saveWeights(next)
      return next
    })
  }, [])

  const saveCustomExercise = useCallback(async (exercise: Exercise) => {
    setCustomExercises((prev) => {
      const idx = prev.findIndex((e) => e.id === exercise.id)
      const next = idx >= 0 ? prev.map((e) => (e.id === exercise.id ? exercise : e)) : [...prev, exercise]
      void repository.saveCustomExercises(next)
      return next
    })
  }, [])

  const deleteCustomExercise = useCallback(async (id: string) => {
    setCustomExercises((prev) => {
      const next = prev.filter((e) => e.id !== id)
      void repository.saveCustomExercises(next)
      return next
    })
  }, [])

  const resetAll = useCallback(async () => {
    await repository.clearAll()
    setProfile(null)
    setGoal(null)
    setSessions([])
    setWeights([])
    setCustomExercises([])
  }, [])

  // 組み込み種目とユーザー追加ぶんを1つのリストにまとめる。ID が衝突したらユーザー側を優先
  const exercises = useMemo(() => {
    const customIds = new Set(customExercises.map((e) => e.id))
    return [...EXERCISES.filter((e) => !customIds.has(e.id)), ...customExercises]
  }, [customExercises])
  const exerciseMap = useMemo(() => buildExerciseMap(exercises), [exercises])

  const value = useMemo<AppState>(
    () => ({
      ready,
      profile,
      goal,
      sessions,
      weights,
      customExercises,
      exercises,
      exerciseMap,
      saveProfile,
      saveGoal,
      upsertSession,
      deleteSession,
      logWeight,
      deleteWeight,
      saveCustomExercise,
      deleteCustomExercise,
      reload,
      resetAll,
    }),
    [
      ready,
      profile,
      goal,
      sessions,
      weights,
      customExercises,
      exercises,
      exerciseMap,
      saveProfile,
      saveGoal,
      upsertSession,
      deleteSession,
      logWeight,
      deleteWeight,
      saveCustomExercise,
      deleteCustomExercise,
      reload,
      resetAll,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
