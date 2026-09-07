import type { BadgeProgress } from '../lib/achievements'

interface Props {
  progress: BadgeProgress
  /** 今回新しく獲得したバッジを強調する */
  isNew?: boolean
}

function formatValue(v: number, unit: string): string {
  return unit === 'kg' ? v.toLocaleString() : String(v)
}

export default function BadgeCard({ progress, isNew }: Props) {
  const { badge, current, unlocked, ratio } = progress
  return (
    <li className={`badge-card${unlocked ? ' is-unlocked' : ''}${isNew ? ' is-new' : ''}`}>
      <span className="badge-icon" aria-hidden>
        {badge.icon}
      </span>
      <div className="badge-body">
        <span className="badge-name">
          {badge.name}
          {isNew && <span className="badge-new">NEW</span>}
        </span>
        <span className="badge-desc">{badge.description}</span>
        {!unlocked && (
          <>
            <span className="badge-progress" aria-hidden>
              <span className="badge-progress-fill" style={{ width: `${ratio * 100}%` }} />
            </span>
            <span className="badge-count">
              {formatValue(Math.min(current, badge.target), badge.unit)} /{' '}
              {formatValue(badge.target, badge.unit)} {badge.unit}
            </span>
          </>
        )}
      </div>
    </li>
  )
}
