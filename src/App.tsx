import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { formatDate, todayKey } from './lib/date'
import ReviewPage from './pages/ReviewPage'
import SettingsPage from './pages/SettingsPage'
import TasksPage from './pages/TasksPage'
import TodayPage from './pages/TodayPage'
import { useApp } from './state/AppContext'

const NAV = [
  { to: '/', label: '今日', icon: '🎯' },
  { to: '/tasks', label: 'タスク', icon: '📋' },
  { to: '/review', label: 'ふりかえり', icon: '🌙' },
  { to: '/settings', label: '設定', icon: '⚙️' },
]

export default function App() {
  const { ready } = useApp()
  const { pathname } = useLocation()

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">司令塔</span>
        <span className="app-date">{formatDate(todayKey())}</span>
      </header>

      <main className="app-main">
        {!ready ? (
          <div className="page">
            <p className="muted">読み込み中…</p>
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<TodayPage />} />
          </Routes>
        )}
      </main>

      <nav className="app-nav">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={`nav-item${pathname === item.to ? ' is-active' : ''}`}
          >
            <span className="nav-icon" aria-hidden>
              {item.icon}
            </span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
