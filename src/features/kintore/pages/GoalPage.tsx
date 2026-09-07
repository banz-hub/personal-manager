import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BodyMap from '../components/BodyMap'
import { muscleName } from '../data/muscles'
import { buildGoalPlan } from '../lib/calc'
import { GOAL_DESCRIPTION, GOAL_LABEL } from '../lib/planner'
import { useApp } from '../state/AppContext'
import type { GoalType, MuscleId } from '../types'

const PRESETS: Array<{ label: string; muscles: MuscleId[] }> = [
  { label: '全身', muscles: ['chest', 'lats', 'shoulders', 'quads', 'hamstrings', 'glutes', 'abs'] },
  { label: '上半身', muscles: ['chest', 'lats', 'shoulders', 'biceps', 'triceps'] },
  { label: '下半身', muscles: ['quads', 'hamstrings', 'glutes', 'calves'] },
  { label: '体幹', muscles: ['abs', 'obliques', 'lowerback'] },
  { label: '腕', muscles: ['biceps', 'triceps', 'forearms'] },
]

export default function GoalPage() {
  const { profile, goal, saveGoal } = useApp()
  const navigate = useNavigate()

  const [muscles, setMuscles] = useState<MuscleId[]>(goal?.targetMuscles ?? [])
  const [type, setType] = useState<GoalType>(goal?.type ?? 'hypertrophy')
  const [targetWeight, setTargetWeight] = useState<string>(
    goal?.targetWeightKg != null ? String(goal.targetWeightKg) : '',
  )
  const [targetDate, setTargetDate] = useState<string>(goal?.targetDate ?? '')

  const parsedTarget = targetWeight === '' ? undefined : Number(targetWeight)

  const plan = useMemo(() => {
    if (!profile) return null
    return buildGoalPlan(profile, type, parsedTarget, targetDate || undefined)
  }, [profile, type, parsedTarget, targetDate])

  if (!profile) {
    return (
      <div className="page">
        <h1>目標設定</h1>
        <p>先にプロフィールを入力してください。</p>
        <Link className="button primary" to="/kintore/profile">
          プロフィールを入力する
        </Link>
      </div>
    )
  }

  function toggle(m: MuscleId) {
    setMuscles((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))
  }

  async function handleSave(then: 'workout' | 'stay') {
    await saveGoal({
      type,
      targetMuscles: muscles,
      targetWeightKg: parsedTarget,
      targetDate: targetDate || undefined,
    })
    if (then === 'workout') navigate('/workout')
  }

  return (
    <div className="page">
      <h1>鍛えたい部位と目標</h1>

      <section className="card">
        <h2>1. 鍛えたい部位を選ぶ</h2>
        <p className="muted">図の部位をタップして選択します。複数選択できます。</p>
        <div className="preset-row">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="chip-button"
              onClick={() => setMuscles(p.muscles)}
            >
              {p.label}
            </button>
          ))}
          <button type="button" className="chip-button" onClick={() => setMuscles([])}>
            クリア
          </button>
        </div>

        <div className="bodymap-row">
          <BodyMap side="front" selected={muscles} onToggle={toggle} />
          <BodyMap side="back" selected={muscles} onToggle={toggle} />
        </div>

        <div className="chips">
          {muscles.length === 0 ? (
            <span className="muted">まだ選択されていません</span>
          ) : (
            muscles.map((m) => (
              <button key={m} type="button" className="chip" onClick={() => toggle(m)}>
                {muscleName(m)} <span aria-hidden>×</span>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="card">
        <h2>2. 目標のタイプ</h2>
        <div className="goal-options">
          {(Object.keys(GOAL_LABEL) as GoalType[]).map((g) => (
            <label key={g} className={`goal-option${type === g ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="goalType"
                value={g}
                checked={type === g}
                onChange={() => setType(g)}
              />
              <span className="goal-option-title">{GOAL_LABEL[g]}</span>
              <span className="goal-option-desc">{GOAL_DESCRIPTION[g]}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>3. 目標体重と期限 (任意)</h2>
        <div className="grid-2">
          <label>
            目標体重 (kg)
            <input
              type="number"
              inputMode="decimal"
              step={0.1}
              min={25}
              max={300}
              placeholder={`現在 ${profile.weightKg}kg`}
              value={targetWeight}
              onChange={(e) => setTargetWeight(e.target.value)}
            />
          </label>
          <label>
            目標日
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </label>
        </div>

        {plan && plan.direction !== 'maintain' && (
          <div className="goal-plan">
            <div className="stat-row">
              <div className="stat">
                <span className="stat-label">目標まで</span>
                <span className="stat-value">
                  {plan.deltaKg > 0 ? '+' : ''}
                  {plan.deltaKg}
                </span>
                <span className="stat-sub">kg</span>
              </div>
              <div className="stat">
                <span className="stat-label">推奨ペース</span>
                <span className="stat-value">{plan.safeWeeklyKg}</span>
                <span className="stat-sub">kg / 週</span>
              </div>
              <div className="stat">
                <span className="stat-label">1日の目安</span>
                <span className="stat-value">{plan.dailyCalories}</span>
                <span className="stat-sub">
                  kcal ({plan.calorieDelta >= 0 ? '+' : ''}
                  {plan.calorieDelta})
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">タンパク質</span>
                <span className="stat-value">{plan.proteinG}</span>
                <span className="stat-sub">g / 日</span>
              </div>
            </div>

            {plan.deadlineFeasible === false && (
              <p className="warning">
                設定した期限で達成するには推奨ペース ({plan.safeWeeklyKg}kg/週) を超える必要があります。
                筋肉の減少や体調不良のリスクがあるため、期限を
                {plan.projectedDate ? ` ${plan.projectedDate} 以降` : '後ろ倒し'}
                にするか、目標体重の見直しをおすすめします。
              </p>
            )}

            {plan.milestones.length > 0 && (
              <>
                <h3>目標までのステップ</h3>
                <ol className="milestones">
                  {plan.milestones.map((m) => (
                    <li key={m.label}>
                      <span className="milestone-label">{m.label}</span>
                      <span className="milestone-weight">{m.weightKg} kg</span>
                      <span className="milestone-date">
                        {m.date}（約{m.weeksFromNow}週後）
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        )}
      </section>

      <div className="form-actions">
        <button
          type="button"
          className="primary"
          disabled={muscles.length === 0}
          onClick={() => handleSave('workout')}
        >
          この内容でメニューを作る
        </button>
        <button type="button" onClick={() => handleSave('stay')} disabled={muscles.length === 0}>
          保存だけする
        </button>
        {muscles.length === 0 && <span className="muted">部位を1つ以上選んでください</span>}
      </div>
    </div>
  )
}
