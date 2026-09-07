/**
 * 筋トレログが、ほかの機能に見せている入り口。
 *
 * **ほかの機能が筋トレのデータに触るときは、必ずここを通す。**
 * 読み取りだけ。種目・セット・重量を決めるのは筋トレログの担当で、
 * エージェント本体は「今日やったか」「何分か」を見て時間を空けるだけ。
 */

import { createStore } from 'idb-keyval'

/** 筋トレログの置き場 */
export const kintoreStore = createStore('kintore-app', 'state')
