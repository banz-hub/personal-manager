import type { WorkoutEvaluation } from '../lib/evaluation'

interface Props {
  evaluation: WorkoutEvaluation
  /** 見出しを出すか (履歴の中では省く) */
  compact?: boolean
}

export default function EvaluationCard({ evaluation, compact }: Props) {
  const { score, grade, headline, factors, advice, personalRecords } = evaluation
  return (
    <div className="evaluation">
      <div className="evaluation-head">
        <span className={`grade grade-${grade}`} aria-hidden>
          {grade}
        </span>
        <div>
          <span className="evaluation-score">
            {score}
            <span className="evaluation-score-max"> / 100</span>
          </span>
          {!compact && <p className="evaluation-headline">{headline}</p>}
          <span className="sr-only">評価 {grade}、{score}点</span>
        </div>
      </div>

      {personalRecords.length > 0 && (
        <p className="pr-note">🏆 自己ベスト更新: {personalRecords.join('・')}</p>
      )}

      <ul className="factor-list">
        {factors.map((f) => (
          <li key={f.label}>
            <div className="factor-head">
              <span className="factor-label">{f.label}</span>
              <span className="factor-value">{f.value}</span>
              <span className="factor-points">
                {f.points}/{f.max}
              </span>
            </div>
            <span className="factor-bar" aria-hidden>
              <span className="factor-bar-fill" style={{ width: `${(f.points / f.max) * 100}%` }} />
            </span>
            <span className="factor-note">{f.note}</span>
          </li>
        ))}
      </ul>

      {advice.length > 0 && (
        <ul className="advice-list">
          {advice.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
