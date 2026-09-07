/**
 * 機能 (フィーチャー) の登録の形。
 *
 * 画面を増やすときは、`src/features/` の下にフォルダを 1 つ作って
 * この形のものを 1 つ書き出し、`features.ts` の配列に足す。それだけで
 * 下タブにも経路にも出る。App.tsx を触る必要はない。
 *
 * 機能どうしはお互いを import しない。参照するのは `shared/` に置いたものだけ。
 * 他の機能のデータが要るときは、`features/<相手>/bridge.ts` のように
 * 相手が公開している読み取り口を通す。直接ストアを触らない。
 */

import type { ComponentType, ReactNode } from 'react'

export interface NavEntry {
  /** 経路。`/` は今日の画面 */
  to: string
  label: string
  icon: string
}

export interface FeatureRoute {
  /** react-router の path。機能の中で重ならないようにする */
  path: string
  element: ReactNode
}

export interface Feature {
  /** フォルダ名と揃える */
  id: string
  /**
   * 下タブに出す入口。1 つの機能がいくつ持ってもよいし、0 でもよい。
   * 並ぶ順は `features.ts` の並び順そのまま。
   */
  nav: NavEntry[]
  routes: FeatureRoute[]
  /**
   * この機能のデータを配るもの。
   * 読み込みが終わるまで待たせるのは、ここではなく各機能の画面側の仕事。
   * ここで待たせると、他の機能の画面まで一緒に止まってしまう。
   */
  Provider?: ComponentType<{ children: ReactNode }>
}
