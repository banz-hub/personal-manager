import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { AppData } from '../lib/storage'
import { EMPTY_DATA, repository } from '../lib/storage'
import type { Profile } from '../types'

/** id を持つ配列のキー (profile 以外) */
export type ListKey = Exclude<keyof AppData, 'profile'>

type Entity = { id: string }

interface AppState {
  ready: boolean
  data: AppData
  setProfile: (patch: Partial<Profile>) => void
  /** id が一致すれば置き換え、無ければ末尾に追加 */
  upsert: <K extends ListKey>(key: K, item: AppData[K][number]) => void
  remove: (key: ListKey, id: string) => void
  /** 複数件をまとめて置き換える */
  replaceList: <K extends ListKey>(key: K, items: AppData[K]) => void
  /** バックアップの読み込みなど、全体をまるごと差し替える */
  replaceAll: (data: AppData) => Promise<void>
  reset: () => Promise<void>
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(EMPTY_DATA)
  const [ready, setReady] = useState(false)
  /**
   * 直近の値。state の更新は次の描画までしか反映されないので、
   * ひとつの処理の中で続けて保存したときに取りこぼさないよう、ここを同期的に更新する。
   */
  const latest = useRef(data)

  useEffect(() => {
    let alive = true
    repository
      .loadAll()
      .then((loaded) => {
        if (!alive) return
        latest.current = loaded
        setData(loaded)
        setReady(true)
      })
      .catch(() => setReady(true))
    return () => {
      alive = false
    }
  }, [])

  const persist = useCallback(<K extends keyof AppData>(key: K, value: AppData[K]) => {
    // 先に参照を更新しておかないと、続けて呼ばれたときに古い一覧を土台にしてしまい
    // 最後の1件しか残らない (まとめて登録や、授業の期間の一括変更で効く)
    latest.current = { ...latest.current, [key]: value }
    setData(latest.current)
    void repository.save(key, value)
  }, [])

  const setProfile = useCallback(
    (patch: Partial<Profile>) => {
      persist('profile', { ...latest.current.profile, ...patch })
    },
    [persist],
  )

  const upsert = useCallback(
    <K extends ListKey>(key: K, item: AppData[K][number]) => {
      const list = latest.current[key] as unknown as Entity[]
      const entity = item as unknown as Entity
      const index = list.findIndex((x) => x.id === entity.id)
      const next = index >= 0 ? list.map((x, i) => (i === index ? entity : x)) : [...list, entity]
      persist(key, next as unknown as AppData[K])
    },
    [persist],
  )

  const remove = useCallback(
    (key: ListKey, id: string) => {
      const list = latest.current[key] as unknown as Entity[]
      persist(key, list.filter((x) => x.id !== id) as unknown as AppData[typeof key])
    },
    [persist],
  )

  const replaceList = useCallback(
    <K extends ListKey>(key: K, items: AppData[K]) => {
      persist(key, items)
    },
    [persist],
  )

  const replaceAll = useCallback(async (next: AppData) => {
    setData(next)
    latest.current = next
    for (const key of Object.keys(next) as Array<keyof AppData>) {
      await repository.save(key, next[key])
    }
  }, [])

  const reset = useCallback(async () => {
    await repository.clearAll()
    setData(EMPTY_DATA)
    latest.current = EMPTY_DATA
  }, [])

  const value = useMemo<AppState>(
    () => ({ ready, data, setProfile, upsert, remove, replaceList, replaceAll, reset }),
    [ready, data, setProfile, upsert, remove, replaceList, replaceAll, reset],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('AppProvider の中で使ってください')
  return ctx
}
