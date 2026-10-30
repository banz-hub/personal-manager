/**
 * 筋トレログ。**画面は廃止した（2026-10-30 に本人の指定）。**
 *
 * 残しているのは「まとめて書き出す」の窓口だけ。
 * 記録は `kintore-app` の IndexedDB に残っていて、ここを消すと取り出す手段が無くなるため。
 * データを捨てると決めたら、このフォルダごと消して `features.ts` から外す。
 */

import type { Feature } from '../../app/types'
import { exportBackup, importBackup } from './lib/storage'

export const kintore: Feature = {
  id: 'kintore',
  label: '筋トレログ',
  nav: [],
  routes: [],
  backup: {
    key: 'kintore',
    export: exportBackup,
    import: importBackup,
    filename: () => `kintore-backup-${new Date().toISOString().slice(0, 10)}.json`,
  },
}
