import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './app/App'
import { FEATURES } from './app/features'
import './index.css'

/**
 * 機能が持っている Provider を、登録順に入れ子にする。
 * 機能が増えてもここは変わらない。
 */
function withProviders(children: ReactNode): ReactNode {
  return FEATURES.reduceRight<ReactNode>(
    (inner, f) => (f.Provider ? <f.Provider>{inner}</f.Provider> : inner),
    children,
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {/* ハッシュルーターなら静的ホスティングでリダイレクト設定が要らない */}
    <HashRouter>{withProviders(<App />)}</HashRouter>
  </StrictMode>,
)
