import { useMemo, useState } from 'react'
import { blankExam, blankNode, ExamForm, NodeForm } from '../components/StudyForms'
import { Banner, Empty, Sheet, Stat } from '../components/ui'
import { formatDuration, todayKey } from '../lib/date'
import {
  buildExamPlan,
  buildProgress,
  childrenOf,
  isLeaf,
  leavesOf,
  rootsOf,
  staleLeaves,
  summarizeMastery,
  upcomingExams,
  withDescendants,
  type NodeProgress,
} from '../lib/study'
import { useApp } from '../state/AppContext'
import {
  AREA_LABELS,
  MASTERY_LABELS,
  MASTERY_ORDER,
  type Exam,
  type Mastery,
  type StudyNode,
} from '../types'

export default function StudyPage() {
  const { data, upsert, remove, replaceList } = useApp()
  const [editingNode, setEditingNode] = useState<StudyNode | null>(null)
  const [editingExam, setEditingExam] = useState<Exam | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const today = todayKey()

  const { nodes, exams, sessions } = data

  const progress = useMemo(() => buildProgress(nodes, sessions, today), [nodes, sessions, today])
  const examPlans = useMemo(
    () => upcomingExams(exams, today).map((e) => buildExamPlan(e, nodes, sessions, today)),
    [exams, nodes, sessions, today],
  )
  const stale = useMemo(() => staleLeaves(nodes, progress), [nodes, progress])

  const roots = rootsOf(nodes)
  const allLeafCount = nodes.filter((n) => isLeaf(nodes, n)).length
  const overall = useMemo(
    () => summarizeMastery(nodes.filter((n) => isLeaf(nodes, n))),
    [nodes],
  )

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const deleteNode = (node: StudyNode) => {
    const ids = new Set(withDescendants(nodes, node.id).map((n) => n.id))
    replaceList(
      'nodes',
      nodes.filter((n) => !ids.has(n.id)),
    )
    setEditingNode(null)
  }

  const setMastery = (node: StudyNode, mastery: Mastery) => {
    upsert('nodes', { ...node, mastery })
  }

  return (
    <div className="page">
      <div className="row">
        <strong className="grow">学習</strong>
        <span className="dim">
          {allLeafCount > 0 ? `習得 ${overall.counts.mastered}/${allLeafCount}` : ''}
        </span>
      </div>

      {allLeafCount > 0 && (
        <div className="stats">
          <Stat k="項目" v={`${allLeafCount}`} />
          <Stat k="習得" v={`${overall.counts.mastered}`} />
          <Stat k="進み具合" v={`${Math.round(overall.progress * 100)}%`} />
        </div>
      )}

      {/* --- 試験 --- */}
      <section className="bucket">
        <div className="row">
          <h2 className="section grow">試験</h2>
          <button type="button" className="btn sm" onClick={() => setEditingExam(blankExam())}>
            ＋ 追加
          </button>
        </div>

        {examPlans.length === 0 ? (
          <Empty>登録された試験がありません</Empty>
        ) : (
          examPlans.map((p) => (
            <button
              key={p.exam.id}
              type="button"
              className={`task ${p.reviewPhase ? 'b-urgent' : 'b-important'}`}
              style={{ textAlign: 'left', cursor: 'pointer' }}
              onClick={() => setEditingExam(p.exam)}
            >
              <span className="task-title">{p.exam.title}</span>
              <span className="task-meta">
                <span className="tag">{p.exam.date}</span>
                <span>あと{p.daysLeft}日</span>
                <span>
                  範囲 {p.leaves.length}項目（習得 {p.summary.counts.mastered}）
                </span>
                {p.requiredMin > 0 && <span>1日 {formatDuration(p.perDayMin)}</span>}
              </span>
              {p.findings.map((f) => (
                <span key={f} className="reason">
                  {f}
                </span>
              ))}
            </button>
          ))
        )}
      </section>

      {/* --- しばらくやっていないもの --- */}
      {stale.length > 0 && (
        <section className="bucket">
          <h2 className="section">しばらく空いている項目</h2>
          <Banner alert>
            <ul>
              {stale.map((n) => (
                <li key={n.id}>
                  {n.title} — {progress.get(n.id)?.staleDays}日ぶり（{MASTERY_LABELS[n.mastery ?? 'new']}）
                </li>
              ))}
            </ul>
          </Banner>
        </section>
      )}

      {/* --- 範囲のツリー --- */}
      <section className="bucket">
        <div className="row">
          <h2 className="section grow">学習の範囲</h2>
          <button
            type="button"
            className="btn sm"
            onClick={() => setEditingNode(blankNode(undefined, roots.length))}
          >
            ＋ 科目
          </button>
        </div>

        {roots.length === 0 ? (
          <Empty>
            まず科目を作ってください。科目 → 単元 → 項目 のように、下に足していけます。
          </Empty>
        ) : (
          <div className="tree">
            {roots.map((root) => (
              <TreeNode
                key={root.id}
                node={root}
                nodes={nodes}
                depth={0}
                open={open}
                progress={progress}
                onToggle={toggle}
                onEdit={setEditingNode}
                onAddChild={(parent) =>
                  setEditingNode(blankNode(parent.id, childrenOf(nodes, parent.id).length))
                }
                onMastery={setMastery}
              />
            ))}
          </div>
        )}
      </section>

      {editingNode && (
        <Sheet onClose={() => setEditingNode(null)}>
          <NodeForm
            initial={editingNode}
            nodes={nodes}
            onSave={(n) => {
              upsert('nodes', n)
              // 追加した親は開いた状態にしておく (足したものが見えないと不安なので)
              if (n.parentId) setOpen((prev) => new Set(prev).add(n.parentId as string))
              setEditingNode(null)
            }}
            onCancel={() => setEditingNode(null)}
            onDelete={deleteNode}
          />
        </Sheet>
      )}

      {editingExam && (
        <Sheet onClose={() => setEditingExam(null)}>
          <ExamForm
            initial={editingExam}
            nodes={nodes}
            onSave={(e) => {
              upsert('exams', e)
              setEditingExam(null)
            }}
            onCancel={() => setEditingExam(null)}
            onDelete={(id) => {
              remove('exams', id)
              setEditingExam(null)
            }}
          />
        </Sheet>
      )}
    </div>
  )
}

function TreeNode({
  node,
  nodes,
  depth,
  open,
  progress,
  onToggle,
  onEdit,
  onAddChild,
  onMastery,
}: {
  node: StudyNode
  nodes: StudyNode[]
  depth: number
  open: Set<string>
  progress: Map<string, NodeProgress>
  onToggle: (id: string) => void
  onEdit: (n: StudyNode) => void
  onAddChild: (n: StudyNode) => void
  onMastery: (n: StudyNode, m: Mastery) => void
}) {
  const children = childrenOf(nodes, node.id)
  const leaf = children.length === 0
  const isOpen = open.has(node.id)
  const p = progress.get(node.id)
  const summary = leaf ? null : summarizeMastery(leavesOf(nodes, node.id))

  return (
    <>
      <div className={`tree-row m-${node.mastery ?? 'new'}`} style={{ paddingLeft: depth * 16 }}>
        {leaf ? (
          <span className="tree-bullet" aria-hidden>
            ·
          </span>
        ) : (
          <button
            type="button"
            className="tree-toggle"
            aria-expanded={isOpen}
            onClick={() => onToggle(node.id)}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        )}

        <button type="button" className="tree-title" onClick={() => onEdit(node)}>
          <span>{node.title}</span>
          <span className="tree-meta">
            {/* 科目名と分野が同じときにタグを出すと、同じ言葉が二度並ぶだけになる */}
            {!node.parentId && node.area && AREA_LABELS[node.area] !== node.title && (
              <span className="tag">{AREA_LABELS[node.area]}</span>
            )}
            {leaf ? (
              <>
                <span className={`tag m-${node.mastery ?? 'new'}`}>
                  {MASTERY_LABELS[node.mastery ?? 'new']}
                </span>
                {p && p.totalMin > 0 && <span>{formatDuration(p.totalMin)}</span>}
                {p?.staleDays != null && <span>{p.staleDays}日ぶり</span>}
                {p?.accuracy != null && <span>正答{Math.round(p.accuracy * 100)}%</span>}
              </>
            ) : (
              summary && (
                <>
                  <span>
                    {summary.counts.mastered}/{summary.total} 習得
                  </span>
                  {p && p.totalMin > 0 && <span>{formatDuration(p.totalMin)}</span>}
                </>
              )
            )}
          </span>
        </button>

        <button
          type="button"
          className="btn ghost sm"
          title="下に足す"
          onClick={() => onAddChild(node)}
        >
          ＋
        </button>
      </div>

      {/* 葉は理解度をその場で変えられるようにする。編集画面を開かせると続かない */}
      {leaf && (
        <div className="mastery-row" style={{ paddingLeft: depth * 16 + 22 }}>
          {MASTERY_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              className={`chip${(node.mastery ?? 'new') === m ? ' is-on' : ''} m-${m}`}
              onClick={() => onMastery(node, m)}
            >
              {MASTERY_LABELS[m]}
            </button>
          ))}
        </div>
      )}

      {!leaf &&
        isOpen &&
        children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            nodes={nodes}
            depth={depth + 1}
            open={open}
            progress={progress}
            onToggle={onToggle}
            onEdit={onEdit}
            onAddChild={onAddChild}
            onMastery={onMastery}
          />
        ))}
    </>
  )
}
