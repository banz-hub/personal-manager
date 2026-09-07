import { useMemo, useState } from 'react'
import { decompose, evenSteps, stepsFromText, suggestTemplates, type StepDraft } from '../lib/decompose'
import { formatDuration } from '../lib/date'
import { Empty, Sheet } from './ui'
import type { Task } from '../types'

type Mode = 'template' | 'even' | 'free'

/**
 * 大きなタスクを手順に割る。
 *
 * ひな形は候補として出すだけで、**選んだものだけが実際のタスクになる** (第 7 条)。
 * 割る前に、どんな手順・何分・いつが締切になるかを全部見せる。
 */
export default function DecomposeSheet({
  task,
  onApply,
  onClose,
}: {
  task: Task
  onApply: (children: Task[], parent: Task) => void
  onClose: () => void
}) {
  const templates = useMemo(() => suggestTemplates(task.title, task.area), [task])
  const [mode, setMode] = useState<Mode>(templates.length > 0 ? 'template' : 'even')
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [count, setCount] = useState(3)
  const [free, setFree] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const steps: StepDraft[] = useMemo(() => {
    if (mode === 'template') return templates.find((t) => t.id === templateId)?.steps ?? []
    if (mode === 'even') return evenSteps(count)
    return stepsFromText(free)
  }, [mode, templates, templateId, count, free])

  // 切り替えたら選び直す。前の選択が残っていると意図しないものが作られる
  const stepKey = steps.map((s) => s.title).join('|')
  const [lastKey, setLastKey] = useState(stepKey)
  if (stepKey !== lastKey) {
    setLastKey(stepKey)
    setPicked(new Set(steps.map((s) => s.title)))
  }

  const chosen = steps.filter((s) => picked.has(s.title))
  const preview = useMemo(
    () => (chosen.length > 0 ? decompose(task, chosen, new Date().toISOString()) : null),
    [task, chosen],
  )

  const toggle = (title: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })

  return (
    <Sheet onClose={onClose}>
      <div className="row">
        <strong className="grow">「{task.title}」を手順に分ける</strong>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          閉じる
        </button>
      </div>

      <p className="hint">
        全体 {formatDuration(task.estimateMin)}
        {task.dueDate ? ` / 締切 ${task.dueDate}` : ' / 締切なし'} を割ります。
        締切は最後の手順に合わせて、手前を1日ずつ前倒しします。
      </p>

      <div className="row tight">
        {templates.length > 0 && (
          <button
            type="button"
            className={`btn sm${mode === 'template' ? ' primary' : ' ghost'}`}
            onClick={() => setMode('template')}
          >
            ひな形
          </button>
        )}
        <button
          type="button"
          className={`btn sm${mode === 'even' ? ' primary' : ' ghost'}`}
          onClick={() => setMode('even')}
        >
          均等に割る
        </button>
        <button
          type="button"
          className={`btn sm${mode === 'free' ? ' primary' : ' ghost'}`}
          onClick={() => setMode('free')}
        >
          自分で書く
        </button>
      </div>

      {mode === 'template' && (
        <label className="field">
          <span>ひな形</span>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {mode === 'even' && (
        <label className="field">
          <span>何回に分けるか: {count}回</span>
          <input
            type="range"
            min={2}
            max={10}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </label>
      )}

      {mode === 'free' && (
        <label className="field">
          <span>手順（1行に1つ）</span>
          <textarea
            rows={5}
            value={free}
            placeholder={'資料を集める\n構成を決める\n本文を書く'}
            onChange={(e) => setFree(e.target.value)}
          />
        </label>
      )}

      {steps.length === 0 ? (
        <Empty>手順がありません</Empty>
      ) : (
        <section className="bucket">
          <div className="bucket-head">
            <span className="grow">作る手順</span>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() =>
                setPicked(picked.size === steps.length ? new Set() : new Set(steps.map((s) => s.title)))
              }
            >
              {picked.size === steps.length ? 'すべて外す' : 'すべて選ぶ'}
            </button>
          </div>
          {steps.map((s, i) => {
            const child = preview?.children[chosen.findIndex((c) => c.title === s.title)]
            return (
              <label key={s.title} className="task" style={{ cursor: 'pointer' }}>
                <span className="row tight">
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={picked.has(s.title)}
                    onChange={() => toggle(s.title)}
                  />
                  <span className="task-title">
                    {i + 1}. {s.title}
                  </span>
                </span>
                {child && (
                  <span className="task-meta">
                    <span>{formatDuration(child.estimateMin)}</span>
                    {child.dueDate && <span>締切 {child.dueDate}</span>}
                  </span>
                )}
              </label>
            )
          })}
        </section>
      )}

      <button
        type="button"
        className="btn primary"
        disabled={!preview || preview.children.length === 0}
        onClick={() => preview && onApply(preview.children, preview.parent)}
      >
        {chosen.length}件のタスクを作る
      </button>
      <p className="hint">
        元のタスクは消しません。「まとめ」として残るので、何を分けたのかが分かります。
      </p>
    </Sheet>
  )
}
