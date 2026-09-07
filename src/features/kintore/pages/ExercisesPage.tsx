import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EQUIPMENT, equipmentName } from '../data/equipment'
import { MUSCLES, muscleName } from '../data/muscles'
import { LEVEL_LABEL } from '../lib/planner'
import { useApp } from '../state/AppContext'
import type { EquipmentId, Exercise, ExercisePattern, ExperienceLevel } from '../types'

const PATTERN_LABEL: Record<ExercisePattern, string> = {
  horizontal_push: '水平に押す (ベンチプレス系)',
  vertical_push: '上に押す (ショルダープレス系)',
  horizontal_pull: '水平に引く (ロウ系)',
  vertical_pull: '上から引く (懸垂系)',
  squat: 'しゃがむ (スクワット系)',
  hinge: '股関節を折る (デッドリフト系)',
  lunge: '片脚 (ランジ系)',
  core: '体幹',
  isolation: '単関節 (アイソレーション)',
  carry: '運ぶ・保持する',
}

function emptyDraft(): Exercise {
  return {
    id: '',
    name: '',
    primary: [],
    secondary: [],
    equipment: ['bodyweight'],
    pattern: 'isolation',
    compound: false,
    minLevel: 'beginner',
    custom: true,
    tips: '',
  }
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

export default function ExercisesPage() {
  const { profile, exercises, customExercises, saveCustomExercise, deleteCustomExercise, saveProfile } =
    useApp()

  const [draft, setDraft] = useState<Exercise | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')

  const hidden = useMemo(
    () => new Set(profile?.hiddenExerciseIds ?? []),
    [profile?.hiddenExerciseIds],
  )

  const builtins = exercises.filter((e) => !e.custom)
  const visible = (list: Exercise[]) =>
    filter.trim() === ''
      ? list
      : list.filter(
          (e) =>
            e.name.includes(filter.trim()) ||
            e.primary.some((m) => muscleName(m).includes(filter.trim())),
        )

  async function toggleHidden(id: string) {
    if (!profile) return
    const next = hidden.has(id)
      ? (profile.hiddenExerciseIds ?? []).filter((x) => x !== id)
      : [...(profile.hiddenExerciseIds ?? []), id]
    await saveProfile({ ...profile, hiddenExerciseIds: next })
  }

  function startNew() {
    setDraft(emptyDraft())
    setError('')
  }

  function startCopy(source: Exercise) {
    setDraft({
      ...source,
      id: '',
      name: `${source.name} (自分用)`,
      custom: true,
      loadFactor: undefined,
      defaultWeightKg: undefined,
    })
    setError('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    if (draft.name.trim() === '') {
      setError('種目名を入力してください')
      return
    }
    if (draft.primary.length === 0) {
      setError('主に鍛える部位を1つ以上選んでください')
      return
    }
    const id = draft.id || `custom_${Date.now()}`
    await saveCustomExercise({
      ...draft,
      id,
      name: draft.name.trim(),
      // 主動筋に入れた部位は協働筋から外しておく
      secondary: draft.secondary.filter((m) => !draft.primary.includes(m)),
      equipment: draft.equipment.length > 0 ? draft.equipment : ['bodyweight'],
      custom: true,
    })
    setDraft(null)
    setError('')
  }

  if (!profile) {
    return (
      <div className="page">
        <h1>種目の管理</h1>
        <p>先にプロフィールを入力してください。</p>
        <Link className="button primary" to="/kintore/profile">
          プロフィールを入力する
        </Link>
      </div>
    )
  }

  return (
    <div className="page">
      <h1>種目の管理</h1>
      <p className="muted">
        自分の種目を追加したり、やらない種目をメニューから外したりできます。
      </p>

      {draft ? (
        <form className="card" onSubmit={submit}>
          <h2>{draft.id ? '種目を編集' : '種目を追加'}</h2>

          <label>
            種目名
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="例: ケーブルクロスオーバー"
              required
            />
          </label>

          <fieldset className="picker">
            <legend>主に鍛える部位（必須）</legend>
            <div className="chips">
              {MUSCLES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`chip-button${draft.primary.includes(m.id) ? ' is-on' : ''}`}
                  onClick={() => setDraft({ ...draft, primary: toggle(draft.primary, m.id) })}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="picker">
            <legend>補助的に使う部位</legend>
            <div className="chips">
              {MUSCLES.filter((m) => !draft.primary.includes(m.id)).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`chip-button${draft.secondary.includes(m.id) ? ' is-on' : ''}`}
                  onClick={() => setDraft({ ...draft, secondary: toggle(draft.secondary, m.id) })}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="picker">
            <legend>必要な機材</legend>
            <div className="chips">
              {EQUIPMENT.map((eq) => (
                <button
                  key={eq.id}
                  type="button"
                  className={`chip-button${draft.equipment.includes(eq.id) ? ' is-on' : ''}`}
                  onClick={() =>
                    setDraft({ ...draft, equipment: toggle(draft.equipment, eq.id as EquipmentId) })
                  }
                >
                  {eq.name}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid-2">
            <label>
              動作の種類
              <select
                value={draft.pattern}
                onChange={(e) =>
                  setDraft({ ...draft, pattern: e.target.value as ExercisePattern })
                }
              >
                {(Object.keys(PATTERN_LABEL) as ExercisePattern[]).map((p) => (
                  <option key={p} value={p}>
                    {PATTERN_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              対象レベル
              <select
                value={draft.minLevel}
                onChange={(e) =>
                  setDraft({ ...draft, minLevel: e.target.value as ExperienceLevel })
                }
              >
                {(Object.keys(LEVEL_LABEL) as ExperienceLevel[]).map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_LABEL[l]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              初回の推奨重量 (kg・任意)
              <input
                type="number"
                inputMode="decimal"
                step={0.5}
                min={0}
                value={draft.defaultWeightKg ?? ''}
                placeholder="自重なら空欄"
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultWeightKg: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>

          <div className="check-row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.compound}
                onChange={(e) => setDraft({ ...draft, compound: e.target.checked })}
              />
              <span>複数の関節を使う種目（コンパウンド）</span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.unilateral ?? false}
                onChange={(e) => setDraft({ ...draft, unilateral: e.target.checked })}
              />
              <span>左右それぞれ行う</span>
            </label>
          </div>

          <label>
            コツ・メモ
            <textarea
              rows={2}
              value={draft.tips}
              placeholder="フォームの注意点など"
              onChange={(e) => setDraft({ ...draft, tips: e.target.value })}
            />
          </label>

          {error && <p className="warning">{error}</p>}

          <div className="form-actions">
            <button type="submit" className="primary">
              保存する
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              キャンセル
            </button>
          </div>
        </form>
      ) : (
        <div className="form-actions">
          <button type="button" className="primary" onClick={startNew}>
            + 種目を追加する
          </button>
        </div>
      )}

      <section className="card">
        <h2>
          自分で追加した種目 <span className="muted">{customExercises.length}件</span>
        </h2>
        {customExercises.length === 0 ? (
          <p className="muted">まだありません。</p>
        ) : (
          <ul className="exercise-manage-list">
            {visible(customExercises).map((e) => (
              <li key={e.id}>
                <div className="manage-main">
                  <span className="manage-name">{e.name}</span>
                  <span className="muted">
                    {e.primary.map(muscleName).join('・')} ／{' '}
                    {e.equipment.map(equipmentName).join('・')}
                  </span>
                </div>
                <div className="manage-actions">
                  <button type="button" className="ghost" onClick={() => setDraft({ ...e })}>
                    編集
                  </button>
                  <button
                    type="button"
                    className="ghost danger"
                    onClick={() => {
                      if (confirm(`${e.name} を削除しますか？（過去の記録は残ります）`)) {
                        void deleteCustomExercise(e.id)
                      }
                    }}
                  >
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>
          組み込みの種目 <span className="muted">{builtins.length}件</span>
        </h2>
        <p className="muted">
          「使わない」にした種目はメニューに出てきません。コピーすれば自分用に書き換えられます。
        </p>
        <label>
          絞り込み
          <input
            type="text"
            value={filter}
            placeholder="種目名や部位で検索"
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <ul className="exercise-manage-list">
          {visible(builtins).map((e) => (
            <li key={e.id} className={hidden.has(e.id) ? 'is-hidden' : ''}>
              <div className="manage-main">
                <span className="manage-name">{e.name}</span>
                <span className="muted">
                  {e.primary.map(muscleName).join('・')} ／ {e.equipment.map(equipmentName).join('・')}
                </span>
              </div>
              <div className="manage-actions">
                <button type="button" className="ghost" onClick={() => startCopy(e)}>
                  コピー
                </button>
                <button
                  type="button"
                  className={hidden.has(e.id) ? 'ghost' : 'ghost danger'}
                  onClick={() => void toggleHidden(e.id)}
                >
                  {hidden.has(e.id) ? '使う' : '使わない'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="form-actions">
        <Link className="button" to="/kintore/profile">
          設定に戻る
        </Link>
      </div>
    </div>
  )
}
