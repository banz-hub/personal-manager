import { useMemo, useState } from 'react'
import { ChipGroup, Empty, Field, FieldRow, Note, SectionTabs, Sheet } from '../components/ui'
import { formatDate, formatDuration, todayKey } from '../lib/date'
import { newId } from '../lib/id'
import { useApp } from '../state/AppContext'
import { SPOT_LABELS, type Interest, type SpotKind, type Todo } from '../types'

const SPOT_OPTIONS = (Object.entries(SPOT_LABELS) as Array<[SpotKind, string]>).map(
  ([value, label]) => ({ value, label }),
)

function blankTodo(): Todo {
  return { id: newId('td'), title: '', minutes: 30, spots: ['anywhere'], priority: 2 }
}

function blankInterest(): Interest {
  return { id: newId('it'), name: '', minMinutes: 30, spots: ['anywhere'] }
}

/**
 * 空き時間の提案のもとになる情報を入れる画面。
 * 「やること」と「趣味・関心」と「今の状況」の3つを持っておけば、
 * 空き時間の長さ・場所・時間帯と突き合わせて具体的な候補を出せる。
 */
export default function TodosPage() {
  const { data, upsert, remove, setProfile } = useApp()
  const [tab, setTab] = useState<'todo' | 'interest' | 'me'>('todo')
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  const [editingInterest, setEditingInterest] = useState<Interest | null>(null)
  const [showDone, setShowDone] = useState(false)

  const todos = useMemo(() => {
    const list = data.todos.filter((t) => (showDone ? t.doneAt : !t.doneAt))
    return list.sort(
      (a, b) =>
        b.priority - a.priority ||
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        a.minutes - b.minutes,
    )
  }, [data.todos, showDone])

  return (
    <div className="page">
      <h1>やること</h1>
      <SectionTabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'todo', label: 'やること' },
          { value: 'interest', label: '趣味・関心' },
          { value: 'me', label: '今の状況' },
        ]}
      />

      {tab === 'todo' ? (
        <>
          <p className="muted small">
            所要時間と「どこでできるか」を入れておくと、空き時間の長さと場所に合うものだけが
            今日の画面に出てきます。
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              onClick={() => setEditingTodo(blankTodo())}
            >
              やることを追加
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setShowDone((v) => !v)}
            >
              {showDone ? '未完了を見る' : '完了ぶんを見る'}
            </button>
          </div>

          {todos.length === 0 ? (
            <Empty>{showDone ? '完了したものはありません。' : 'まだありません。'}</Empty>
          ) : (
            <ul className="list">
              {todos.map((t) => (
                <li key={t.id} className="list-item">
                  <div>
                    <strong>{t.title}</strong>
                    <p className="muted small">
                      {formatDuration(t.minutes)} /{' '}
                      {t.spots.map((s) => SPOT_LABELS[s]).join('・')}
                      {t.dueDate ? ` / ${formatDate(t.dueDate, false)}まで` : ''}
                      {t.priority === 3 ? ' / 優先' : ''}
                      {t.doneAt ? ` / ${formatDate(t.doneAt, false)}に完了` : ''}
                    </p>
                  </div>
                  <div className="list-actions">
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() =>
                        upsert('todos', { ...t, doneAt: t.doneAt ? undefined : todayKey() })
                      }
                    >
                      {t.doneAt ? '戻す' : '済み'}
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setEditingTodo(t)}
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm danger"
                      onClick={() => remove('todos', t.id)}
                    >
                      削除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {tab === 'interest' ? (
        <>
          <p className="muted small">
            自分が普段やっていること・好きなことを入れておくと、やることが空のときでも
            空き時間に合う候補を出せます。
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              onClick={() => setEditingInterest(blankInterest())}
            >
              趣味・関心を追加
            </button>
          </div>

          {data.interests.length === 0 ? (
            <Empty>
              例) 読書 / 筋トレ / カフェ巡り / 写真 / ゲーム / 資格の勉強 …
            </Empty>
          ) : (
            <ul className="list">
              {data.interests.map((it) => (
                <li key={it.id} className="list-item">
                  <div>
                    <strong>{it.name}</strong>
                    <p className="muted small">
                      {formatDuration(it.minMinutes)}から /{' '}
                      {it.spots.map((s) => SPOT_LABELS[s]).join('・')}
                      {it.hours ? ` / ${it.hours[0]}時〜${it.hours[1]}時` : ''}
                    </p>
                  </div>
                  <div className="list-actions">
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setEditingInterest(it)}
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm danger"
                      onClick={() => remove('interests', it.id)}
                    >
                      削除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      {tab === 'me' ? (
        <div className="card">
          <Field label="今の状況" wide hint="今日の画面の上に表示され、判断のよりどころになります">
            <textarea
              rows={4}
              value={data.profile.situation}
              placeholder="例) 大学3年。就活中でエントリーシートを書きためたい。週2でカフェのバイト。休みの日は写真を撮りに行きたい。"
              onChange={(e) => setProfile({ situation: e.target.value })}
            />
          </Field>
          <Note>
            ここに書いた文章そのものから提案を作ってはいません。提案に効くのは
            「やること」と「趣味・関心」に入れた項目なので、気になることは項目としても足してください。
          </Note>
        </div>
      ) : null}

      <Sheet
        open={editingTodo !== null}
        title="やること"
        onClose={() => setEditingTodo(null)}
        footer={
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (editingTodo && editingTodo.title.trim()) upsert('todos', editingTodo)
              setEditingTodo(null)
            }}
          >
            保存
          </button>
        }
      >
        {editingTodo ? (
          <>
            <Field label="内容" wide>
              <input
                type="text"
                value={editingTodo.title}
                placeholder="例) 志望動機を書き直す"
                onChange={(e) => setEditingTodo({ ...editingTodo, title: e.target.value })}
              />
            </Field>
            <FieldRow>
              <Field label="想定時間(分)">
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={editingTodo.minutes}
                  onChange={(e) =>
                    setEditingTodo({ ...editingTodo, minutes: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="優先度">
                <select
                  value={editingTodo.priority}
                  onChange={(e) =>
                    setEditingTodo({
                      ...editingTodo,
                      priority: Number(e.target.value) as Todo['priority'],
                    })
                  }
                >
                  <option value={3}>優先</option>
                  <option value={2}>ふつう</option>
                  <option value={1}>いつでも</option>
                </select>
              </Field>
              <Field label="期限">
                <input
                  type="date"
                  value={editingTodo.dueDate ?? ''}
                  onChange={(e) =>
                    setEditingTodo({ ...editingTodo, dueDate: e.target.value || undefined })
                  }
                />
              </Field>
            </FieldRow>
            <Field label="どこでできるか" wide>
              <ChipGroup
                options={SPOT_OPTIONS}
                value={editingTodo.spots}
                onChange={(spots) => setEditingTodo({ ...editingTodo, spots })}
              />
            </Field>
          </>
        ) : null}
      </Sheet>

      <Sheet
        open={editingInterest !== null}
        title="趣味・関心"
        onClose={() => setEditingInterest(null)}
        footer={
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (editingInterest && editingInterest.name.trim())
                upsert('interests', editingInterest)
              setEditingInterest(null)
            }}
          >
            保存
          </button>
        }
      >
        {editingInterest ? (
          <>
            <Field label="名前" wide>
              <input
                type="text"
                value={editingInterest.name}
                placeholder="例) 読書"
                onChange={(e) => setEditingInterest({ ...editingInterest, name: e.target.value })}
              />
            </Field>
            <FieldRow>
              <Field label="最低これくらい必要(分)">
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={editingInterest.minMinutes}
                  onChange={(e) =>
                    setEditingInterest({ ...editingInterest, minMinutes: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="時間帯" hint="空欄なら終日">
                <select
                  value={editingInterest.hours ? `${editingInterest.hours[0]}-${editingInterest.hours[1]}` : ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setEditingInterest({
                      ...editingInterest,
                      hours: v
                        ? (v.split('-').map(Number) as [number, number])
                        : undefined,
                    })
                  }}
                >
                  <option value="">いつでも</option>
                  <option value="5-11">朝</option>
                  <option value="11-17">昼</option>
                  <option value="17-24">夜</option>
                </select>
              </Field>
            </FieldRow>
            <Field label="どこでできるか" wide>
              <ChipGroup
                options={SPOT_OPTIONS}
                value={editingInterest.spots}
                onChange={(spots) => setEditingInterest({ ...editingInterest, spots })}
              />
            </Field>
          </>
        ) : null}
      </Sheet>
    </div>
  )
}
