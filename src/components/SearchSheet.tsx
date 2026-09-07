import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { groupHits, search, HIT_LABELS } from '../lib/search'
import { useApp } from '../state/AppContext'
import { Empty, Sheet } from './ui'

/**
 * 横断の検索。
 * 数が増えると「どこに入れたか」を思い出せなくなるので、
 * どの画面からでも同じ入り口で探せるようにする。
 */
export default function SearchSheet({ onClose }: { onClose: () => void }) {
  const { data } = useApp()
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  const hits = useMemo(
    () =>
      search({
        query,
        tasks: data.tasks,
        nodes: data.nodes,
        companies: data.companies,
        selections: data.selections,
      }),
    [query, data.tasks, data.nodes, data.companies, data.selections],
  )

  const groups = groupHits(hits)

  return (
    <Sheet onClose={onClose}>
      <div className="row">
        <strong className="grow">探す</strong>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          閉じる
        </button>
      </div>

      <input
        // 開いてすぐ打てるようにする
        autoFocus
        value={query}
        placeholder="タスク・学習項目・企業・選考の予定"
        onChange={(e) => setQuery(e.target.value)}
      />

      {query.trim().length === 0 ? (
        <p className="hint">
          ひらがな・カタカナ、大文字小文字、全角半角の違いは無視して探します。
          「ITパスポート」でも「ぱすぽーと」でも当たります。
        </p>
      ) : hits.length === 0 ? (
        <Empty>見つかりませんでした</Empty>
      ) : (
        groups.map(([kind, list]) => (
          <section key={kind} className="bucket">
            <div className="bucket-head">
              <span>{HIT_LABELS[kind]}</span>
              <span className="count">{list.length}件</span>
            </div>
            {list.map((h) => (
              <button
                key={`${h.kind}:${h.id}`}
                type="button"
                className="task"
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => {
                  navigate(h.to)
                  onClose()
                }}
              >
                <span className="task-title">{h.title}</span>
                <span className="task-meta">
                  <span>{h.detail}</span>
                </span>
              </button>
            ))}
          </section>
        ))
      )}
    </Sheet>
  )
}
