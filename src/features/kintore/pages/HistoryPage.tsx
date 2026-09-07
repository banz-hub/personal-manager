import { useRef, useState } from 'react'
import EvaluationCard from '../components/EvaluationCard'
import SectionTabs from '../components/SectionTabs'
import { exerciseNameFrom } from '../data/exercises'
import { muscleName } from '../data/muscles'
import { shiftDateKey, shortDateLabel } from '../lib/calc'
import { evaluateSession } from '../lib/evaluation'
import { exportBackup, importBackup } from '../lib/storage'
import { useApp } from '../state/AppContext'
import type { LoggedSet, WorkoutSession } from '../types'

function sessionVolume(s: WorkoutSession): number {
  return s.exercises.reduce(
    (acc, ex) =>
      acc + ex.sets.filter((x) => x.done).reduce((a, x) => a + (x.weightKg ?? 0) * x.reps, 0),
    0,
  )
}

function sessionSets(s: WorkoutSession): number {
  return s.exercises.reduce((acc, ex) => acc + ex.sets.filter((x) => x.done).length, 0)
}

function durationMinutes(s: WorkoutSession): number | null {
  if (!s.finishedAt) return null
  const ms = new Date(s.finishedAt).getTime() - new Date(s.startedAt).getTime()
  return Math.max(0, Math.round(ms / 60000))
}

export default function HistoryPage() {
  const { profile, goal, sessions, exerciseMap, upsertSession, deleteSession, reload } = useApp()
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState<WorkoutSession | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleExport() {
    const data = await exportBackup()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kintore-backup-${data.exportedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text()
      await importBackup(JSON.parse(text))
      await reload()
      setMessage('バックアップを読み込みました')
    } catch (err) {
      setMessage(`読み込みに失敗しました: ${(err as Error).message}`)
    }
  }

  function patchDraftSet(exIdx: number, setIdx: number, patch: Partial<LoggedSet>) {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            exercises: prev.exercises.map((ex, i) =>
              i !== exIdx
                ? ex
                : { ...ex, sets: ex.sets.map((s, j) => (j === setIdx ? { ...s, ...patch } : s)) },
            ),
          }
        : prev,
    )
  }

  async function saveDraft() {
    if (!draft) return
    await upsertSession(draft)
    setDraft(null)
    setMessage('記録を更新しました')
  }

  return (
    <div className="page">
      <h1>記録</h1>
      <SectionTabs />

      {sessions.length === 0 ? (
        <p className="muted">まだ記録がありません。トレーニングを完了するとここに残ります。</p>
      ) : (
        <ul className="session-list">
          {sessions.map((s) => {
            const mins = durationMinutes(s)
            const editing = draft?.id === s.id
            const view = editing ? draft : s
            return (
              <li key={s.id} className="card session-card">
                <div className="session-head">
                  <div>
                    <h2>{s.date}</h2>
                    <p className="muted">
                      {s.targetMuscles.map(muscleName).join('・') || '部位未設定'}
                      {!s.finishedAt && <span className="badge">記録中</span>}
                    </p>
                  </div>
                  <div className="manage-actions">
                    {editing ? (
                      <>
                        <button type="button" className="ghost" onClick={() => void saveDraft()}>
                          保存
                        </button>
                        <button type="button" className="ghost" onClick={() => setDraft(null)}>
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setDraft(structuredClone(s))}
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          className="ghost danger"
                          onClick={() => {
                            if (confirm(`${s.date} の記録を削除しますか？`)) void deleteSession(s.id)
                          }}
                        >
                          削除
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="stat-row">
                  <div className="stat">
                    <span className="stat-label">完了セット</span>
                    <span className="stat-value">{sessionSets(view)}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">総挙上量</span>
                    <span className="stat-value">{Math.round(sessionVolume(view))}</span>
                    <span className="stat-sub">kg</span>
                  </div>
                  {mins !== null && (
                    <div className="stat">
                      <span className="stat-label">所要</span>
                      <span className="stat-value">{mins}</span>
                      <span className="stat-sub">分</span>
                    </div>
                  )}
                  {view.cardioMinutes > 0 && (
                    <div className="stat">
                      <span className="stat-label">有酸素</span>
                      <span className="stat-value">{view.cardioMinutes}</span>
                      <span className="stat-sub">分</span>
                    </div>
                  )}
                  {view.bodyWeightKg != null && (
                    <div className="stat">
                      <span className="stat-label">体重</span>
                      <span className="stat-value">{view.bodyWeightKg}</span>
                      <span className="stat-sub">kg</span>
                    </div>
                  )}
                </div>

                {editing && draft ? (
                  <div className="edit-area">
                    {draft.exercises.map((ex, exIdx) => (
                      <div key={ex.exerciseId} className="edit-exercise">
                        <div className="edit-exercise-head">
                          <span className="ex-name">
                            {exerciseNameFrom(exerciseMap, ex.exerciseId)}
                          </span>
                          <button
                            type="button"
                            className="ghost danger"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                exercises: draft.exercises.filter((_, i) => i !== exIdx),
                              })
                            }
                          >
                            削除
                          </button>
                        </div>
                        <table className="set-table">
                          <thead>
                            <tr>
                              <th>セット</th>
                              <th>重量(kg)</th>
                              <th>回数</th>
                              <th>完了</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ex.sets.map((set, setIdx) => (
                              <tr key={setIdx} className={set.done ? 'is-done' : ''}>
                                <td>{setIdx + 1}</td>
                                <td>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    step={0.5}
                                    min={0}
                                    value={set.weightKg ?? ''}
                                    placeholder="自重"
                                    onChange={(e) =>
                                      patchDraftSet(exIdx, setIdx, {
                                        weightKg:
                                          e.target.value === '' ? null : Number(e.target.value),
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    value={set.reps}
                                    onChange={(e) =>
                                      patchDraftSet(exIdx, setIdx, { reps: Number(e.target.value) })
                                    }
                                  />
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className={`set-done${set.done ? ' is-on' : ''}`}
                                    aria-pressed={set.done}
                                    onClick={() =>
                                      patchDraftSet(exIdx, setIdx, { done: !set.done })
                                    }
                                  >
                                    {set.done ? '✓' : '−'}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}

                    <div className="grid-2">
                      <label>
                        記録日
                        <input
                          type="date"
                          value={draft.date}
                          onChange={(e) =>
                            e.target.value && setDraft({ ...draft, date: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        有酸素 (分)
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={draft.cardioMinutes}
                          onChange={(e) =>
                            setDraft({ ...draft, cardioMinutes: Number(e.target.value) })
                          }
                        />
                      </label>
                      <label>
                        体重 (kg)
                        <input
                          type="number"
                          inputMode="decimal"
                          step={0.1}
                          value={draft.bodyWeightKg ?? ''}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              bodyWeightKg:
                                e.target.value === '' ? undefined : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="form-actions date-quick">
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, date: shiftDateKey(draft.date, -1) })}
                      >
                        ← 前日 {shortDateLabel(shiftDateKey(draft.date, -1))}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, date: shiftDateKey(draft.date, 1) })}
                      >
                        翌日 {shortDateLabel(shiftDateKey(draft.date, 1))} →
                      </button>
                    </div>

                    <label>
                      メモ
                      <textarea
                        rows={2}
                        value={draft.note}
                        onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                      />
                    </label>
                  </div>
                ) : (
                  <>
                    <ul className="session-exercises">
                      {s.exercises.map((ex) => (
                        <li key={ex.exerciseId}>
                          <span className="ex-name">
                            {exerciseNameFrom(exerciseMap, ex.exerciseId)}
                          </span>
                          <span className="ex-sets">
                            {ex.sets
                              .filter((x) => x.done)
                              .map((x) => `${x.weightKg ?? '自重'}×${x.reps}`)
                              .join(' / ') || '未実施'}
                          </span>
                        </li>
                      ))}
                    </ul>

                    {s.note && <p className="session-note">{s.note}</p>}

                    {s.finishedAt && (
                      <details className="chart-table">
                        <summary>この日の評価を見る</summary>
                        <EvaluationCard
                          evaluation={evaluateSession(s, sessions, profile, goal, exerciseMap)}
                          compact
                        />
                      </details>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <section className="card">
        <h2>バックアップ</h2>
        <p className="muted">
          データはこの端末のブラウザ内にのみ保存されます。機種変更や別の端末で使う場合は
          JSONファイルで書き出して読み込んでください。
        </p>
        <div className="form-actions">
          <button type="button" onClick={handleExport}>
            JSONで書き出す
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            JSONから読み込む
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleImport(file)
              e.target.value = ''
            }}
          />
          {message && <span className="saved-note">{message}</span>}
        </div>
      </section>
    </div>
  )
}
