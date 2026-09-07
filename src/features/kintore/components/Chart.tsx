import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 依存ライブラリなしのインライン SVG グラフ。
 * すべて単一系列なので凡例は置かず、見出しが系列名を兼ねる。
 * 数値はホバー/タップのツールチップと、下部の表（アクセシビリティ用）で読める。
 */

export interface ChartPoint {
  label: string
  value: number
  /** ツールチップに出す補足 (日付など) */
  sub?: string
}

const PAD = { top: 16, right: 14, bottom: 28, left: 46 }

/**
 * viewBox の幅を実際の表示幅に合わせる。
 * 1 viewBox 単位 = 1px になるので、狭い画面でも文字が潰れず高さも確保できる。
 */
function useChartSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(640)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  // 狭いほど縦長寄りにして、折れ線の変化が読み取れる高さを保つ
  const height = Math.round(Math.min(280, Math.max(180, width * 0.5)))
  return { W: width, H: height }
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min]
  const span = max - min
  const rawStep = span / count
  const mag = 10 ** Math.floor(Math.log10(rawStep))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag * 10
  const start = Math.floor(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100)
  return out
}

function ChartFrame({
  title,
  caption,
  children,
  table,
}: {
  title: string
  caption?: string
  children: ReactNode
  table: { head: [string, string]; rows: Array<[string, string]> }
}) {
  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      {caption && <p className="chart-caption">{caption}</p>}
      {children}
      <details className="chart-table">
        <summary>数値で見る</summary>
        <table>
          <thead>
            <tr>
              <th>{table.head[0]}</th>
              <th>{table.head[1]}</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map(([a, b]) => (
              <tr key={a}>
                <th scope="row">{a}</th>
                <td>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

function useHoverIndex(count: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState<number | null>(null)

  function handleMove(clientX: number) {
    const el = ref.current
    if (!el || count === 0) return
    const rect = el.getBoundingClientRect()
    // viewBox 幅 = 実際の px 幅なので、そのままプロット領域の座標として扱える
    const x = clientX - rect.left
    const inner = (x - PAD.left) / Math.max(1, rect.width - PAD.left - PAD.right)
    setIndex(Math.max(0, Math.min(count - 1, Math.round(inner * (count - 1)))))
  }

  return { ref, index, setIndex, handleMove }
}

interface LineChartProps {
  title: string
  caption?: string
  points: ChartPoint[]
  unit: string
  /** 目標値などの基準線 */
  reference?: { value: number; label: string }
}

export function LineChart({ title, caption, points, unit, reference }: LineChartProps) {
  const { ref, index, setIndex, handleMove } = useHoverIndex(points.length)
  const { W, H } = useChartSize(ref)

  if (points.length === 0) {
    return (
      <figure className="chart">
        <figcaption className="chart-title">{title}</figcaption>
        <p className="muted">まだデータがありません。</p>
      </figure>
    )
  }

  const values = points.map((p) => p.value)
  if (reference) values.push(reference.value)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const pad = (rawMax - rawMin || 1) * 0.15
  const min = rawMin - pad
  const max = rawMax + pad
  const ticks = niceTicks(min, max)

  const px = (i: number) =>
    points.length === 1
      ? (PAD.left + (W - PAD.right)) / 2
      : PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right)
  const py = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom)

  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i)} ${py(p.value)}`).join(' ')
  const active = index != null ? points[index] : null

  // 端と最新は常に、その他はホバー時のみ点を出す
  const markerIndexes = new Set<number>([0, points.length - 1])

  return (
    <ChartFrame
      title={title}
      caption={caption}
      table={{
        head: ['日付', `${title} (${unit})`],
        rows: points.map((p) => [p.sub ?? p.label, `${p.value}`]),
      }}
    >
      <div
        className="chart-plot"
        ref={ref}
        onMouseMove={(e) => handleMove(e.clientX)}
        onMouseLeave={() => setIndex(null)}
        onTouchStart={(e) => handleMove(e.touches[0].clientX)}
        onTouchMove={(e) => handleMove(e.touches[0].clientX)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}の推移`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={py(t)} y2={py(t)} />
              <text className="chart-axis" x={PAD.left - 8} y={py(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}

          {reference && (
            <g>
              <line
                className="chart-reference"
                x1={PAD.left}
                x2={W - PAD.right}
                y1={py(reference.value)}
                y2={py(reference.value)}
              />
              <text
                className="chart-axis"
                x={W - PAD.right}
                y={py(reference.value) - 6}
                textAnchor="end"
              >
                {reference.label}
              </text>
            </g>
          )}

          <path className="chart-line" d={d} />

          {points.map((p, i) =>
            markerIndexes.has(i) ? (
              <circle key={p.label + i} className="chart-dot" cx={px(i)} cy={py(p.value)} r={5} />
            ) : null,
          )}

          {index != null && (
            <g>
              <line
                className="chart-crosshair"
                x1={px(index)}
                x2={px(index)}
                y1={PAD.top}
                y2={H - PAD.bottom}
              />
              <circle className="chart-dot is-active" cx={px(index)} cy={py(points[index].value)} r={6} />
            </g>
          )}

          <text className="chart-axis" x={PAD.left} y={H - 8}>
            {points[0].label}
          </text>
          {points.length > 1 && (
            <text className="chart-axis" x={W - PAD.right} y={H - 8} textAnchor="end">
              {points[points.length - 1].label}
            </text>
          )}
        </svg>

        {active && (
          <div
            className="chart-tooltip"
            style={{ left: `${(px(index!) / W) * 100}%` }}
            role="status"
          >
            <span className="chart-tooltip-label">{active.sub ?? active.label}</span>
            <span className="chart-tooltip-value">
              {active.value} {unit}
            </span>
          </div>
        )}
      </div>
    </ChartFrame>
  )
}

interface BarChartProps {
  title: string
  caption?: string
  points: ChartPoint[]
  unit: string
  format?: (v: number) => string
}

export function BarChart({ title, caption, points, unit, format }: BarChartProps) {
  const [index, setIndex] = useState<number | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const { W, H } = useChartSize(plotRef)
  const fmt = format ?? ((v: number) => String(Math.round(v)))

  if (points.length === 0) {
    return (
      <figure className="chart">
        <figcaption className="chart-title">{title}</figcaption>
        <p className="muted">まだデータがありません。</p>
      </figure>
    )
  }

  const max = Math.max(...points.map((p) => p.value), 1)
  const ticks = niceTicks(0, max, 3)
  const plotW = W - PAD.left - PAD.right
  const slot = plotW / points.length
  // 2px のすき間を空けて隣り合う棒がくっつかないようにする
  const barW = Math.max(6, slot - 6)
  // 最大値が最後の目盛りを超えることがあるため、棒がプロット領域からはみ出さないよう大きいほうに合わせる
  const scaleMax = Math.max(max, ticks[ticks.length - 1] || 1)
  const py = (v: number) => PAD.top + (1 - v / scaleMax) * (H - PAD.top - PAD.bottom)
  const baseY = py(0)

  const maxIndex = points.reduce((best, p, i) => (p.value > points[best].value ? i : best), 0)
  const labelIndexes = new Set([maxIndex, points.length - 1])

  return (
    <ChartFrame
      title={title}
      caption={caption}
      table={{
        head: ['期間', `${title} (${unit})`],
        rows: points.map((p) => [p.sub ?? p.label, fmt(p.value)]),
      }}
    >
      <div className="chart-plot" ref={plotRef}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={py(t)} y2={py(t)} />
              <text className="chart-axis" x={PAD.left - 8} y={py(t) + 4} textAnchor="end">
                {fmt(t)}
              </text>
            </g>
          ))}

          {points.map((p, i) => {
            const x = PAD.left + i * slot + (slot - barW) / 2
            const h = Math.max(p.value > 0 ? 3 : 0, baseY - py(p.value))
            return (
              <g
                key={p.label + i}
                onMouseEnter={() => setIndex(i)}
                onMouseLeave={() => setIndex(null)}
                onTouchStart={() => setIndex(i)}
              >
                <rect
                  className="chart-hit"
                  x={PAD.left + i * slot}
                  y={PAD.top}
                  width={slot}
                  height={H - PAD.top - PAD.bottom}
                />
                <rect
                  className={`chart-bar${index === i ? ' is-active' : ''}`}
                  x={x}
                  y={baseY - h}
                  width={barW}
                  height={h}
                  rx={4}
                />
                {labelIndexes.has(i) && p.value > 0 && (
                  <text
                    className="chart-value"
                    x={x + barW / 2}
                    y={Math.max(PAD.top - 4, baseY - h - 6)}
                    textAnchor="middle"
                  >
                    {fmt(p.value)}
                  </text>
                )}
                <text
                  className="chart-axis"
                  x={x + barW / 2}
                  y={H - 8}
                  textAnchor="middle"
                >
                  {p.label}
                </text>
              </g>
            )
          })}
        </svg>

        {index != null && (
          <div
            className="chart-tooltip"
            style={{ left: `${((PAD.left + index * slot + slot / 2) / W) * 100}%` }}
            role="status"
          >
            <span className="chart-tooltip-label">{points[index].sub ?? points[index].label}</span>
            <span className="chart-tooltip-value">
              {fmt(points[index].value)} {unit}
            </span>
          </div>
        )}
      </div>
    </ChartFrame>
  )
}

interface HBarChartProps {
  title: string
  caption?: string
  points: ChartPoint[]
  unit: string
}

/** 部位別など、順位を見るための横棒。値は各棒の右端に直接置く */
export function HBarChart({ title, caption, points, unit }: HBarChartProps) {
  if (points.length === 0 || points.every((p) => p.value === 0)) {
    return (
      <figure className="chart">
        <figcaption className="chart-title">{title}</figcaption>
        <p className="muted">まだデータがありません。</p>
      </figure>
    )
  }
  const max = Math.max(...points.map((p) => p.value), 1)

  return (
    <ChartFrame
      title={title}
      caption={caption}
      table={{
        head: ['部位', `${title} (${unit})`],
        rows: points.map((p) => [p.label, String(p.value)]),
      }}
    >
      <ul className="hbar-list">
        {points.map((p) => (
          <li key={p.label} className="hbar-row">
            <span className="hbar-label">{p.label}</span>
            <span className="hbar-track">
              <span
                className={`hbar-fill${p.value === 0 ? ' is-empty' : ''}`}
                style={{ width: `${(p.value / max) * 100}%` }}
              />
            </span>
            <span className="hbar-value">{p.value}</span>
          </li>
        ))}
      </ul>
    </ChartFrame>
  )
}
