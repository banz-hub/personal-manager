/**
 * 筋トレログ (メニュー・記録・実績・目標)。
 *
 * 経路は `/kintore` の下にまとめてある。画面の中のリンクも同じ前置き付き。
 * 見た目は `kintore.css` に閉じ込め、`.ft-kintore` の中だけで効く。
 *
 * データは `kintore-app` の IndexedDB をそのまま使う。移し替えていないので、
 * 筋トレログで書き出した JSON がそのまま読める。トレーニングの正はここ。
 * エージェント本体は `lib/bridge/kintore.ts` から読むだけで、書かない。
 */

import { lazy, useEffect, type ReactNode } from 'react'
import type { Feature } from '../../app/types'
import { loadReminder, scheduleWhileOpen, showReminderNow } from './lib/reminders'
import { exportBackup, importBackup } from './lib/storage'
import { AppProvider, useApp } from './state/AppContext'
import './kintore.css'

// 画面は開いたときに読む。機能が増えても最初の読み込みが重くならない
const AchievementsPage = lazy(() => import('./pages/AchievementsPage'))
const ExercisesPage = lazy(() => import('./pages/ExercisesPage'))
const GoalPage = lazy(() => import('./pages/GoalPage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const HomePage = lazy(() => import('./pages/HomePage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const StatsPage = lazy(() => import('./pages/StatsPage'))
const WorkoutPage = lazy(() => import('./pages/WorkoutPage'))

/**
 * 読み込み待ちと見た目の囲い。
 * 通知の予約もここでする。もとは App.tsx にあったが、
 * 外枠に 1 つの機能の都合を持ち込まないためにこちらへ移した。
 */
function Gate({ children }: { children: ReactNode }) {
  const { ready } = useApp()

  // アプリを開いている間は、予定時刻ちょうどに通知を出す
  useEffect(() => scheduleWhileOpen(loadReminder(), () => void showReminderNow()), [])

  return (
    <div className="ft-kintore">
      {ready ? (
        children
      ) : (
        <div className="page">
          <p className="muted">読み込み中…</p>
        </div>
      )}
    </div>
  )
}

const page = (element: ReactNode) => <Gate>{element}</Gate>

export const kintore: Feature = {
  id: 'kintore',
  label: '筋トレログ',
  nav: [
    {
      to: '/kintore',
      label: '筋トレ',
      icon: '🏋️',
      primary: true,
      match: ['/kintore/workout'],
    },
    { to: '/kintore/history', label: '筋トレの記録', icon: '📋', match: ['/kintore/stats', '/kintore/achievements'] },
    { to: '/kintore/goal', label: '筋トレの目標', icon: '🏁' },
    { to: '/kintore/profile', label: '筋トレの設定', icon: '🛠️', match: ['/kintore/exercises'] },
  ],
  Provider: AppProvider,
  backup: {
    key: 'kintore',
    export: () => exportBackup(),
    import: (raw) => importBackup(raw),
    filename: () => `kintore-backup-${new Date().toISOString().slice(0, 10)}.json`,
  },
  routes: [
    { path: '/kintore', element: page(<HomePage />) },
    { path: '/kintore/workout', element: page(<WorkoutPage />) },
    { path: '/kintore/history', element: page(<HistoryPage />) },
    { path: '/kintore/stats', element: page(<StatsPage />) },
    { path: '/kintore/achievements', element: page(<AchievementsPage />) },
    { path: '/kintore/goal', element: page(<GoalPage />) },
    { path: '/kintore/profile', element: page(<ProfilePage />) },
    { path: '/kintore/exercises', element: page(<ExercisesPage />) },
  ],
}
