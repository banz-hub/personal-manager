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
      manifest: {
        name: '司令塔',
        short_name: '司令塔',
        description: '今日やるべきことを締切と空き時間から判断して、実行できる予定に落とすアプリ',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0d1210',
        theme_color: '#0d1210',
      },
    }),
  ],
  server: { host: true },
})
