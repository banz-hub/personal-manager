import { formatDuration } from '../lib/date'
import { ratios, type PeriodStats } from '../lib/stats'

/**
 * 棒グラフ。SVG や外部の描画ライブラリは使わない。
 * 高さの違う箱を並べるだけで足りるし、そのほうが軽くて壊れない。
 *
 * 目盛りは出さず、いちばん高い棒の値だけを添える。
 * 細かく読ませるための図ではなく、増えているか減っているかを見るための図なので。
 */
export function BarChart({ stats }: { stats: PeriodStats[] }) {
  const values = stats.map((s) => s.totalMin)
  const rs = ratios(values)
  const max = Math.max(...values, 0)

  if (max === 0) {
    return <p className="empty">この期間の記録がありません</p>
  }

  return (
    <div className="chart">
      <div className="chart-max">最大 {formatDuration(max)}</div>
      <div className="chart-bars">
        {stats.map((s, i) => (
          <div key={s.bucket.label} className="chart-col">
            <div className="chart-track">
              <div className="chart-bar" style={{ height: `${Math.round(rs[i] * 100)}%` }}>
                <span className="seg task" style={{ flexGrow: 1 }} title={formatDuration(s.totalMin)} />
              </div>
            </div>
            <div className="chart-label">{s.bucket.label}</div>
            <div className="chart-value">{s.totalMin > 0 ? formatDuration(s.totalMin) : '—'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
