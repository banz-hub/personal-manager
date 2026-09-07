import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // 相対パスで出力し、/pm/ のようなサブディレクトリに置いても動くようにする
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['app-icon.svg', 'apple-touch-icon.png', 'favicon-32.png'],
      manifest: {
        name: 'エージェント',
        short_name: 'エージェント',
        description: '今日やるべきことを締切と空き時間から判断して、実行できる予定に落とすアプリ',
        lang: 'ja',
        start_url: './',
        /**
         * オリジン全体を範囲にする。
         *
         * `./` だと範囲が `/personal-manager/` だけになり、ホーム画面に追加したあと
         * よてい帳・筋トレログへ移動した瞬間にアプリの外 (Safari) へ放り出される。
         * iPhone ではホーム画面のアプリと Safari でデータの置き場が別なので、
         * そこで連携が切れる。3 つとも範囲に入れて 1 つのアプリの中で完結させる。
         */
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0d1210',
        theme_color: '#0d1210',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Android のアイコン切り抜きに耐えるよう、絵柄は中央60%に収めてある
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  server: { host: true },
})
