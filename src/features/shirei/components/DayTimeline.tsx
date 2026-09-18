/**
 * 1 日 24 時間のタイムスケジュール。縦が 0 時〜24 時。
 *
 * 予定（種類の色）・睡眠（灰色の斜線）・空き時間（点線の枠）を同じ物差しに並べて、
 * **どこが空いているかを見ただけで分かる**ようにする。長さはすべて実際の時間に比例させる。
 * 空いている時間を縮めたりはしない。縮めると、空きの大きさが見た目で比べられなくなる。
 */

import { formatDuration, fromMinutes } from '../lib/date'
import { clampToDay, type Span } from '../lib/timeline'
import type { FixedItem } from '../lib/bridge/yoteicho'
import { labelOf, toneOf } from '../../yotei/lib/tone'
import { layoutDay } from '../../yotei/lib/week'

/** 1 時間の高さ (px)。24 時間で 576px。1 画面に 1 日がほぼ収まる */
const HOUR_PX = 24

const top = (min: number) => (min / 60) * HOUR_PX
const height = (s: Span) => ((s.endMin - s.startMin) / 60) * HOUR_PX

export default function DayTimeline({
  items,
  sleep,
  gaps,
  nowMin,
}: {
  items: FixedItem[]
  sleep: Span[]
  gaps: Span[]
  /** 今日を見ているときだけ。いまの位置に線を引く */
  nowMin?: number
}) {
  const placed = layoutDay(items.map((it) => ({ ...it, ...clampToDay(it) })))
  const hours = Array.from({ length: 13 }, (_, i) => i * 2)

  return (
    <div className="tl" style={{ height: 24 * HOUR_PX, backgroundSize: `100% ${HOUR_PX}px` }}>
      <div className="tl-hours" aria-hidden>
        {hours.map((hh) => (
          <span key={hh} style={{ top: hh * HOUR_PX }}>
            {hh}
          </span>
        ))}
      </div>

      <div className="tl-lane">
        {sleep.map((s) => (
          <div key={`s${s.startMin}`} className="tl-sleep" style={{ top: top(s.startMin), height: height(s) }}>
            {height(s) >= 14 && (
              <span>
                睡眠 {fromMinutes(s.startMin)}〜{s.endMin === 1440 ? '24:00' : fromMinutes(s.endMin)}
              </span>
            )}
          </div>
        ))}

        {gaps.map((g) => (
          <div
            key={`g${g.startMin}`}
            className="tl-gap"
            style={{ top: top(g.startMin), height: height(g) }}
            aria-label={`空き ${fromMinutes(g.startMin)}〜${fromMinutes(g.endMin)}`}
          >
            {height(g) >= 14 && (
              <span>
                空き {formatDuration(g.endMin - g.startMin)}
                {height(g) >= 30 && (
                  <small>
                    {fromMinutes(g.startMin)}〜{g.endMin === 1440 ? '24:00' : fromMinutes(g.endMin)}
                  </small>
                )}
              </span>
            )}
          </div>
        ))}

        {placed.map(({ item, lane, lanes }) => {
          const tone = toneOf(item.kind, item.category)
          const h = height(item)
          return (
            <div
              key={item.id}
              className={`tl-ev t-${tone}${h < 22 ? ' is-short' : ''}`}
              style={{
                top: top(item.startMin),
                height: Math.max(12, h),
                left: `${(lane / lanes) * 100}%`,
                width: `${100 / lanes}%`,
              }}
              title={`${item.start}〜${item.end} ${item.title}${item.placeName ? `（${item.placeName}）` : ''}`}
            >
              <span className="tl-ev-time">
                {item.start}
                {h >= 22 && `〜${item.end}`}
              </span>
              <span className="tl-ev-title">{item.title}</span>
              <span className={`tag t-${tone}`}>{labelOf(item.kind, item.category)}</span>
            </div>
          )
        })}

        {nowMin != null && (
          <div className="tl-now" style={{ top: top(nowMin) }} aria-label={`いま ${fromMinutes(nowMin)}`}>
            <span>{fromMinutes(nowMin)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
