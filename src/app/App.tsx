/**
 * 画面の外枠。中身は持たず、`features.ts` に登録されたものを並べるだけ。
 * ここに機能ごとの条件分岐を書き始めたら、それは Feature 側に置く合図。
 */

import { useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { FEATURES } from './features'
import SearchSheet from '../features/shirei/components/SearchSheet'
import { formatDate, todayKey } from '../features/shirei/lib/date'

const NAV = FEATURES.flatMap((f) => f.nav)
const ROUTES = FEATURES.flatMap((f) => f.routes)

/** 最初の機能の最初の経路を、行き先が無いときの受け皿にする */
const FALLBACK = ROUTES[0]?.element ?? null

export default function App() {
  const { pathname } = useLocation()
  const [searching, setSearching] = useState(false)

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">エージェント</span>
        <span className="app-date grow">{formatDate(todayKey())}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label="探す"
          onClick={() => setSearching(true)}
        >
          🔍
        </button>
      </header>

      {searching && <SearchSheet onClose={() => setSearching(false)} />}

      <main className="app-main">
        <Routes>
          {ROUTES.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          <Route path="*" element={FALLBACK} />
        </Routes>
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
