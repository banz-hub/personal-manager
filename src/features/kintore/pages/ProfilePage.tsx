import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ReminderSettings from '../components/ReminderSettings'
import { EQUIPMENT } from '../data/equipment'
import { ACTIVITY_LABEL, bmi, bmiCategory, standardWeight, tdee } from '../lib/calc'
import { LEVEL_LABEL } from '../lib/planner'
import { useApp } from '../state/AppContext'
import type {
  ActivityLevel,
  EquipmentId,
  ExperienceLevel,
  OwnedEquipment,
  Profile,
  Sex,
} from '../types'

const SEX_LABEL: Record<Sex, string> = {
  male: '男性',
  female: '女性',
  other: '回答しない',
}

const DEFAULTS: Omit<Profile, 'updatedAt'> = {
  heightCm: 170,
  weightKg: 65,
  sex: 'male',
  age: 25,
  activityLevel: 'light',
  experience: 'beginner',
  dailyMinutes: 45,
  daysPerWeek: 3,
  dayCutoffHour: 3,
  equipment: [],
}

/** "5, 10, 20" のような入力を重量配列に変換する */
function parseWeights(input: string): number[] {
  return Array.from(
    new Set(
      input
        .split(/[,、\s]+/)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ).sort((a, b) => a - b)
}

export default function ProfilePage() {
  const { profile, saveProfile } = useApp()
  const navigate = useNavigate()
  const isFirstTime = !profile

  const [form, setForm] = useState<Omit<Profile, 'updatedAt'>>(() =>
    profile ? { ...profile } : { ...DEFAULTS },
  )
  const [weightInputs, setWeightInputs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const eq of profile?.equipment ?? []) {
      if (eq.weights?.length) init[eq.id] = eq.weights.join(', ')
    }
    return init
  })
  const [saved, setSaved] = useState(false)

  const owned = new Set(form.equipment.map((e) => e.id))

  function patch(next: Partial<Omit<Profile, 'updatedAt'>>) {
    setForm((prev) => ({ ...prev, ...next }))
    setSaved(false)
  }

  function toggleEquipment(id: EquipmentId) {
    setForm((prev) => {
      const exists = prev.equipment.some((e) => e.id === id)
      const equipment: OwnedEquipment[] = exists
        ? prev.equipment.filter((e) => e.id !== id)
        : [...prev.equipment, { id, weights: parseWeights(weightInputs[id] ?? '') }]
      return { ...prev, equipment }
    })
    setSaved(false)
  }

  function changeWeights(id: EquipmentId, value: string) {
    setWeightInputs((prev) => ({ ...prev, [id]: value }))
    setForm((prev) => ({
      ...prev,
      equipment: prev.equipment.map((e) =>
        e.id === id ? { ...e, weights: parseWeights(value) } : e,
      ),
    }))
    setSaved(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await saveProfile(form)
    setSaved(true)
    if (isFirstTime) navigate('/goal')
  }

  const bmiValue = bmi(form.heightCm, form.weightKg)
  const preview: Profile = { ...form, updatedAt: '' }

  return (
    <div className="page">
      <h1>{isFirstTime ? 'はじめに、あなたの情報を教えてください' : 'プロフィール'}</h1>
      <p className="muted">
        入力した内容はこの端末の中だけに保存されます。サーバーには送信されません。
      </p>

      <form onSubmit={handleSubmit}>
        <section className="card">
          <h2>身体データ</h2>
          <div className="grid-2">
            <label>
              身長 (cm)
              <input
                type="number"
                inputMode="decimal"
                min={100}
                max={250}
                step={0.1}
                value={form.heightCm}
                onChange={(e) => patch({ heightCm: Number(e.target.value) })}
                required
              />
            </label>
            <label>
              体重 (kg)
              <input
                type="number"
                inputMode="decimal"
                min={25}
                max={300}
                step={0.1}
                value={form.weightKg}
                onChange={(e) => patch({ weightKg: Number(e.target.value) })}
                required
              />
            </label>
            <label>
              年齢
              <input
                type="number"
                inputMode="numeric"
                min={10}
                max={100}
                value={form.age}
                onChange={(e) => patch({ age: Number(e.target.value) })}
                required
              />
            </label>
            <label>
              性別
              <select value={form.sex} onChange={(e) => patch({ sex: e.target.value as Sex })}>
                {(Object.keys(SEX_LABEL) as Sex[]).map((s) => (
                  <option key={s} value={s}>
                    {SEX_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {form.heightCm > 0 && form.weightKg > 0 && (
            <div className="stat-row">
              <div className="stat">
                <span className="stat-label">BMI</span>
                <span className="stat-value">{bmiValue.toFixed(1)}</span>
                <span className="stat-sub">{bmiCategory(bmiValue)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">標準体重</span>
                <span className="stat-value">{standardWeight(form.heightCm).toFixed(1)}</span>
                <span className="stat-sub">kg</span>
              </div>
              <div className="stat">
                <span className="stat-label">維持カロリー</span>
                <span className="stat-value">{Math.round(tdee(preview))}</span>
                <span className="stat-sub">kcal / 日</span>
              </div>
            </div>
          )}
        </section>

        <section className="card">
          <h2>トレーニング環境</h2>
          <div className="grid-2">
            <label>
              1日に使える時間 (分)
              <input
                type="number"
                inputMode="numeric"
                min={10}
                max={240}
                step={5}
                value={form.dailyMinutes}
                onChange={(e) => patch({ dailyMinutes: Number(e.target.value) })}
                required
              />
            </label>
            <label>
              週あたりの日数
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={7}
                value={form.daysPerWeek}
                onChange={(e) => patch({ daysPerWeek: Number(e.target.value) })}
                required
              />
            </label>
            <label>
              トレーニング歴
              <select
                value={form.experience}
                onChange={(e) => patch({ experience: e.target.value as ExperienceLevel })}
              >
                {(Object.keys(LEVEL_LABEL) as ExperienceLevel[]).map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_LABEL[l]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              1日の区切り時刻
              <select
                value={form.dayCutoffHour ?? 3}
                onChange={(e) => patch({ dayCutoffHour: Number(e.target.value) })}
              >
                <option value={0}>0時（日付が変わったら翌日扱い）</option>
                <option value={1}>深夜1時まで前日</option>
                <option value={2}>深夜2時まで前日</option>
                <option value={3}>深夜3時まで前日</option>
                <option value={4}>深夜4時まで前日</option>
                <option value={5}>深夜5時まで前日</option>
                <option value={6}>朝6時まで前日</option>
              </select>
            </label>
            <label>
              普段の活動量
              <select
                value={form.activityLevel}
                onChange={(e) => patch({ activityLevel: e.target.value as ActivityLevel })}
              >
                {(Object.keys(ACTIVITY_LABEL) as ActivityLevel[]).map((a) => (
                  <option key={a} value={a}>
                    {ACTIVITY_LABEL[a]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">
            深夜にトレーニングする場合、「1日の区切り時刻」より前は前日の記録として扱います。
            日付をまたいだ記録は、記録画面でその都度どちらの日にするか選ぶこともできます。
          </p>
        </section>

        <section className="card">
          <h2>持っている機材</h2>
          <p className="muted">
            選んだ機材だけでメニューを組みます。何も選ばなくても自重メニューを提案します。
          </p>
          <div className="equipment-list">
            {EQUIPMENT.filter((e) => !e.alwaysAvailable).map((eq) => {
              const checked = owned.has(eq.id)
              return (
                <div key={eq.id} className={`equipment-item${checked ? ' is-on' : ''}`}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleEquipment(eq.id)}
                    />
                    <span>{eq.name}</span>
                  </label>
                  {checked && eq.hasWeights && (
                    <input
                      className="weights-input"
                      type="text"
                      inputMode="decimal"
                      placeholder="所有重量(kg) 例: 5, 10, 20"
                      value={weightInputs[eq.id] ?? ''}
                      onChange={(e) => changeWeights(eq.id, e.target.value)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <div className="form-actions">
          <button type="submit" className="primary">
            {isFirstTime ? '次へ: 目標を決める' : '保存する'}
          </button>
          {saved && <span className="saved-note">保存しました</span>}
        </div>
      </form>

      {!isFirstTime && (
        <>
          <section className="card">
            <h2>種目の管理</h2>
            <p className="muted">
              自分の種目を追加したり、やらない種目をメニューから外したりできます。
            </p>
            <div className="form-actions">
              <Link className="button" to="/kintore/exercises">
                種目を追加・編集する
              </Link>
            </div>
          </section>

          <ReminderSettings durationMinutes={form.dailyMinutes} />
        </>
      )}
    </div>
  )
}
