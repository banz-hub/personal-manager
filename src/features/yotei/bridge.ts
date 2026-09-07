/**
 * よてい帳が、ほかの機能に見せている入り口。
 *
 * **ほかの機能がよてい帳のデータに触るときは、必ずここを通す。**
 * `createStore('yoteicho-app', …)` を呼び出し側で書くと、置き場の名前が
 * あちこちに散り、どこが触っているのか追えなくなる。
 *
 * 読むのは自由。書き込みはエージェント本体の
 * `features/shirei/lib/bridge/yoteicho-write.ts` だけがやっていて、
 * そこも `events` の中の `source: 'pm'` が付いたものしか触らない。
 * カレンダーの正はよてい帳、というのはそういう意味。
 */

import { createStore } from 'idb-keyval'

/** よてい帳の置き場。同じオリジンに 3 つ同居するので、名前でしか分かれていない */
export const yoteiStore = createStore('yoteicho-app', 'state')
