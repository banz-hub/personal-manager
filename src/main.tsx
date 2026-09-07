import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { AppProvider } from './state/AppContext'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {/* ハッシュルーターなら静的ホスティングでリダイレクト設定が要らない */}
    <HashRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </HashRouter>
  </StrictMode>,
)
