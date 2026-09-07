/**
 * よてい帳 (予定・時間割・移動・お金)。
 *
 * この機能の経路はすべて `/yotei` の下に置く。エージェント本体と `/settings` などが
 * ぶつかるため。画面の中のリンクも同じ前置きを付けてある。
 *
 * 見た目は `yotei.css` に閉じ込めてあり、`.ft-yotei` の中だけで効く。
 * だから取り込んでも本体の画面の見た目は変わらない。
 *
 * データは `yoteicho-app` の IndexedDB をそのまま使う。移し替えていないので、
 * よてい帳で書き出した JSON がそのまま読める。カレンダーの正はここ。
 */

import type { ReactNode } from 'react'
import type { Feature } from '../../app/types'
import BulkRoutesPage from './pages/BulkRoutesPage'
import CalendarPage from './pages/CalendarPage'
import JobsPage from './pages/JobsPage'
import MoneyPage from './pages/MoneyPage'
import PassesPage from './pages/PassesPage'
import PayPage from './pages/PayPage'
import RoutesPage from './pages/RoutesPage'
import SettingsPage from './pages/SettingsPage'
import TimetablePage from './pages/TimetablePage'
import TodayPage from './pages/TodayPage'
import TodosPage from './pages/TodosPage'
import TrainsPage from './pages/TrainsPage'
import TravelPage from './pages/TravelPage'
import TripsPage from './pages/TripsPage'
import { AppProvider, useApp } from './state/AppContext'
import './yotei.css'

/** 読み込みが終わるまで待つ。合わせて見た目の囲いも兼ねる */
function Gate({ children }: { children: ReactNode }) {
  const { ready } = useApp()
  return (
    <div className="ft-yotei">
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

export const yotei: Feature = {
  id: 'yotei',
  label: 'よてい帳',
  nav: [
    { to: '/yotei/calendar', label: '予定', icon: '📅', primary: true, match: ['/yotei/timetable', '/yotei/trips'] },
    {
      to: '/yotei/travel',
      label: '移動',
      icon: '🚃',
      match: ['/yotei/routes', '/yotei/bulk', '/yotei/trains', '/yotei/passes'],
    },
    { to: '/yotei/money', label: 'お金', icon: '💴', match: ['/yotei/pay', '/yotei/jobs'] },
    // 「今日どう動くか」は本体の今日とは別もの。出発時刻と交通費の話
    { to: '/yotei', label: '今日の移動', icon: '📍', match: ['/yotei/todos'] },
    { to: '/yotei/settings', label: '予定の設定', icon: '🛠️' },
  ],
  Provider: AppProvider,
  routes: [
    { path: '/yotei', element: page(<TodayPage />) },
    { path: '/yotei/todos', element: page(<TodosPage />) },
    { path: '/yotei/calendar', element: page(<CalendarPage />) },
    { path: '/yotei/timetable', element: page(<TimetablePage />) },
    { path: '/yotei/trips', element: page(<TripsPage />) },
    { path: '/yotei/travel', element: page(<TravelPage />) },
    { path: '/yotei/routes', element: page(<RoutesPage />) },
    { path: '/yotei/bulk', element: page(<BulkRoutesPage />) },
    { path: '/yotei/trains', element: page(<TrainsPage />) },
    { path: '/yotei/passes', element: page(<PassesPage />) },
    { path: '/yotei/money', element: page(<MoneyPage />) },
    { path: '/yotei/pay', element: page(<PayPage />) },
    { path: '/yotei/jobs', element: page(<JobsPage />) },
    { path: '/yotei/settings', element: page(<SettingsPage />) },
  ],
}
