/**
 * 積んである機能の一覧。**画面を増やすときに触るのはここだけ。**
 *
 * 下タブの並びも、経路も、データを配る入れ子も、この配列から作る。
 * 並べた順がそのまま下タブの順になる。
 */

import type { Feature } from './types'
import { shirei } from '../features/shirei'
import { yotei } from '../features/yotei'

export const FEATURES: Feature[] = [shirei, yotei]
