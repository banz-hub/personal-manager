/**
 * エージェント本体 (今日・タスク・学習・就活・ふりかえり・設定)。
 *
 * この機能が何を持っているかは、下の `shirei` だけを見れば分かる。
 * 画面を 1 つ足すときは pages にファイルを作り、`routes` に 1 行足す。
 */

import { lazy, type ReactNode } from 'react'
import type { Feature } from '../../app/types'
const JobPage = lazy(() => import('./pages/JobPage'))
const ReviewPage = lazy(() => import('./pages/ReviewPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const StudyPage = lazy(() => import('./pages/StudyPage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const TodayPage = lazy(() => import('./pages/TodayPage'))
import { buildBackup, parseBackup, repository, restoreAll } from './lib/storage'
import { AppProvider, useApp } from './state/AppContext'

/**
 * 読み込みが終わるまで待つ。
 * Provider ではなく画面の側で待つのは、ここで止めると
 * 他の機能の画面まで巻き添えで止まってしまうため。
 */
function Gate({ children }: { children: ReactNode }) {
  const { ready } = useApp()
  if (!ready) {
    return (
      <div className="page">
        <p className="muted">読み込み中…</p>
      </div>
    )
  }
  return <>{children}</>
}

const page = (element: ReactNode) => <Gate>{element}</Gate>

export const shirei: Feature = {
  id: 'shirei',
  label: 'エージェント',
  nav: [
    { to: '/', label: '今日', icon: '🎯', primary: true },
    { to: '/tasks', label: 'タスク', icon: '📋' },
    { to: '/study', label: '学習', icon: '📚', primary: true },
    { to: '/job', label: '就活', icon: '💼' },
    { to: '/review', label: 'ふりかえり', icon: '🌙' },
    { to: '/settings', label: '設定', icon: '⚙️' },
  ],
  Provider: AppProvider,
  backup: {
    key: 'shirei',
    export: async () => buildBackup(await repository.loadAll()),
    import: async (raw) => restoreAll(parseBackup(raw)),
  },
  routes: [
    { path: '/', element: page(<TodayPage />) },
    { path: '/tasks', element: page(<TasksPage />) },
    { path: '/study', element: page(<StudyPage />) },
    { path: '/job', element: page(<JobPage />) },
    { path: '/review', element: page(<ReviewPage />) },
    { path: '/settings', element: page(<SettingsPage />) },
  ],
}
