/**
 * テストの設定。vite.config.ts とは分けてある。
 * vitest は自前の vite を持っていて、1 つのファイルに混ぜると型がぶつかるため。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 端末の時計をそのまま使う作りなので、テストの時間帯も日本に固定する
    env: { TZ: 'Asia/Tokyo' },
    setupFiles: ['./vitest.setup.ts'],
  },
})
