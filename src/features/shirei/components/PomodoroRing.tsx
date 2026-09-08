/**
 * 円形のタイマー。時間が進むぶんだけ円周が塗られていく。
 *
 * 数字だけだと「あとどれくらいか」を読むのに一拍かかる。
 * 円なら**見た瞬間に半分か終わりかけかが分かる**ので、作業の手を止めずに済む。
 *
 * 作業はオレンジ、休憩は緑。**色だけに頼らず中に「作業」「休憩」と書く。**
 */

import type { Phase } from '../types'

/** 半径。stroke の太さぶんを viewBox の中に収める */
const R = 54
const STROKE = 10
const SIZE = (R + STROKE) * 2
const C = 2 * Math.PI * R

export default function PomodoroRing({
  progress,
  label,
  sub,
  kind,
  stalled,
}: {
  /** 0〜1 */
  progress: number
  /** 円の中の大きい字。残り時間 */
  label: string
  /** その下の小さい字 */
  sub: string
  kind: Phase['kind']
  /** 離席で止まっているとき。塗りをやめて、進んでいないことを見せる */
  stalled?: boolean
}) {
  const p = Math.min(1, Math.max(0, progress))
  return (
    <svg
      className={`ring ${stalled ? 'is-stalled' : `k-${kind}`}`}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role="img"
      aria-label={`${sub} 残り ${label}`}
    >
      <circle className="ring-track" cx={SIZE / 2} cy={SIZE / 2} r={R} strokeWidth={STROKE} fill="none" />
      <circle
        className="ring-fill"
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={R}
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={C}
        /* 12 時から時計回りに塗る。回転は CSS 側で -90deg */
        strokeDashoffset={C * (1 - p)}
      />
      <text className="ring-label" x={SIZE / 2} y={SIZE / 2 - 2} textAnchor="middle">
        {label}
      </text>
      <text className="ring-sub" x={SIZE / 2} y={SIZE / 2 + 18} textAnchor="middle">
        {sub}
      </text>
    </svg>
  )
}
