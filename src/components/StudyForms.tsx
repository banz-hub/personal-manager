import { useState } from 'react'
import { newId } from '../lib/id'
import { childrenOf, moveTargets, pathLabel, withDescendants } from '../lib/study'
import { Field } from './ui'
import {
  AREA_LABELS,
  IMPORTANCE_LABELS,
  MASTERY_LABELS,
  MASTERY_ORDER,
  type Exam,
  type Importance,
  type Mastery,
  type StudyNode,
  type TaskArea,
} from '../types'

export function blankNode(parentId: string | undefined, order: number): StudyNode {
  return {
    id: newId('node'),
    parentId,
    title: '',
    area: parentId ? undefined : 'math',
    importance: 2,
    estimateMin: 60,
    order,
    createdAt: new Date().toISOString(),
  }
}

export function blankExam(): Exam {
  return {
    id: newId('exam'),
    title: '',
    date: '',
    scopeNodeIds: [],
    importance: 3,
    createdAt: new Date().toISOString(),
  }
}

interface NodeFormProps {
  initial: StudyNode
  nodes: StudyNode[]
  onSave: (node: StudyNode) => void
  onCancel: () => void
  onDelete?: (node: StudyNode) => void
}

export function NodeForm({ initial, nodes, onSave, onCancel, onDelete }: NodeFormProps) {
  const [node, setNode] = useState<StudyNode>(initial)
  const patch = (p: Partial<StudyNode>) => setNode((n) => ({ ...n, ...p }))

  const isNew = initial.title === ''
  const isRoot = !node.parentId
  const hasChildren = childrenOf(nodes, node.id).length > 0
  const where = node.parentId ? pathLabel(nodes, node.parentId) : ''
  const parentTitle = nodes.find((n) => n.id === node.parentId)?.title
  const descendantCount = withDescendants(nodes, node.id).length - 1

  return (
    <>
      <div className="row">
        <strong className="grow">
          {isNew ? (isRoot ? '科目を追加' : `${parentTitle} に追加`) : '編集'}
        </strong>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          閉じる
        </button>
      </div>
      {where && <p className="hint">{where}</p>}

      <Field label="名前">
        <input
          value={node.title}
          placeholder={isRoot ? '数学' : '位相空間論 / 開集合 など'}
          onChange={(e) => patch({ title: e.target.value })}
        />
      </Field>

      {isRoot && (
        <Field label="分野">
          <select
            value={node.area ?? 'math'}
            onChange={(e) => patch({ area: e.target.value as TaskArea })}
          >
            {Object.entries(AREA_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid2">
        <Field label="重要度">
          <select
            value={node.importance}
            onChange={(e) => patch({ importance: Number(e.target.value) as Importance })}
          >
            {([3, 2, 1] as Importance[]).map((i) => (
              <option key={i} value={i}>
                {IMPORTANCE_LABELS[i]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ひととおり終える目安(分)">
          <input
            type="number"
            min={5}
            step={5}
            value={node.estimateMin}
            onChange={(e) => patch({ estimateMin: Number(e.target.value) })}
          />
        </Field>
      </div>

      {hasChildren ? (
        <p className="hint">
          下に{descendantCount}件ぶら下がっています。理解度は、いちばん下の項目にだけ付けます。
        </p>
      ) : (
        <Field label="理解度">
          <select
            value={node.mastery ?? 'new'}
            onChange={(e) => patch({ mastery: e.target.value as Mastery })}
          >
            {MASTERY_ORDER.map((m) => (
              <option key={m} value={m}>
                {MASTERY_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
      )}

      {!isNew && (
        <Field label="どこに置くか">
          <select
            value={node.parentId ?? ''}
            onChange={(e) => patch({ parentId: e.target.value || undefined })}
          >
            <option value="">いちばん上（科目にする）</option>
            {moveTargets(nodes, node.id).map((n) => (
              <option key={n.id} value={n.id}>
                {pathLabel(nodes, n.id) ? `${pathLabel(nodes, n.id)} / ` : ''}
                {n.title}
              </option>
            ))}
          </select>
        </Field>
      )}
      {!isNew && (
        <p className="hint">
          自分自身と、自分の下にぶら下がっているものは選べません（親子が輪になってしまうため）。
          動かすと移動先の末尾に入ります。
        </p>
      )}

      <Field label="メモ">
        <textarea rows={2} value={node.note ?? ''} onChange={(e) => patch({ note: e.target.value })} />
      </Field>

      <div className="row">
        <button
          type="button"
          className="btn primary grow"
          disabled={node.title.trim().length === 0}
          onClick={() => onSave({ ...node, title: node.title.trim() })}
        >
          保存
        </button>
        {onDelete && !isNew && (
          <button type="button" className="btn ghost" onClick={() => onDelete(node)}>
            削除
          </button>
        )}
      </div>
      {onDelete && !isNew && hasChildren && (
        <p className="hint">削除すると、下にぶら下がっている{descendantCount}件も消えます。</p>
      )}
    </>
  )
}

interface ExamFormProps {
  initial: Exam
  nodes: StudyNode[]
  onSave: (exam: Exam) => void
  onCancel: () => void
  onDelete?: (id: string) => void
}

export function ExamForm({ initial, nodes, onSave, onCancel, onDelete }: ExamFormProps) {
  const [exam, setExam] = useState<Exam>(initial)
  const patch = (p: Partial<Exam>) => setExam((e) => ({ ...e, ...p }))
  const isNew = initial.title === ''

  const toggleScope = (id: string) => {
    const has = exam.scopeNodeIds.includes(id)
    patch({
      scopeNodeIds: has
        ? exam.scopeNodeIds.filter((x) => x !== id)
        : [...exam.scopeNodeIds, id],
    })
  }

  // 範囲は科目か単元の単位で選ぶ。項目を1つずつ選ばせると入力が終わらない
  const selectable = nodes.filter((n) => childrenOf(nodes, n.id).length > 0)

  return (
    <>
      <div className="row">
        <strong className="grow">{isNew ? '試験を追加' : '試験を編集'}</strong>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          閉じる
        </button>
      </div>

      <Field label="試験の名前">
        <input
          value={exam.title}
          placeholder="複素解析学B 期末"
          onChange={(e) => patch({ title: e.target.value })}
        />
      </Field>

      <div className="grid2">
        <Field label="試験日">
          <input type="date" value={exam.date} onChange={(e) => patch({ date: e.target.value })} />
        </Field>
        <Field label="重要度">
          <select
            value={exam.importance}
            onChange={(e) => patch({ importance: Number(e.target.value) as Importance })}
          >
            {([3, 2, 1] as Importance[]).map((i) => (
              <option key={i} value={i}>
                {IMPORTANCE_LABELS[i]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="field">
        <span>試験範囲</span>
        {selectable.length === 0 ? (
          <p className="hint">
            先に「学習の範囲」で科目と単元を作ってください。単元の下に項目を足すと、ここで選べるようになります。
          </p>
        ) : (
          <div className="bucket">
            {selectable.map((n) => (
              <label key={n.id} className="row tight">
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={exam.scopeNodeIds.includes(n.id)}
                  onChange={() => toggleScope(n.id)}
                />
                <span>
                  {n.title}
                  {n.parentId && <span className="dim"> — {pathLabel(nodes, n.id)}</span>}
                </span>
              </label>
            ))}
          </div>
        )}
        <p className="hint">選んだものの配下すべてが範囲になります。</p>
      </div>

      <div className="row">
        <button
          type="button"
          className="btn primary grow"
          disabled={exam.title.trim().length === 0 || !exam.date}
          onClick={() => onSave({ ...exam, title: exam.title.trim() })}
        >
          保存
        </button>
        {onDelete && !isNew && (
          <button type="button" className="btn ghost" onClick={() => onDelete(exam.id)}>
            削除
          </button>
        )}
      </div>
    </>
  )
}

/**
 * まとめて追加。
 * 位相空間論の項目を10個入れるのに、1つずつ画面を開くのは現実的でない。
 * 1行1項目で貼り付けられるようにする。
 */
export function BulkAddForm({
  parent,
  nodes,
  onSave,
  onCancel,
}: {
  parent: StudyNode
  nodes: StudyNode[]
  onSave: (nodes: StudyNode[]) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [estimateMin, setEstimateMin] = useState(60)
  const [importance, setImportance] = useState<Importance>(2)

  // 箇条書きの記号や番号は落とす。教科書の目次をそのまま貼れるように
  const titles = text
    .split('\n')
    .map((l) => l.replace(/^\s*[-・*●○\d０-９.．)）、\s]+/, '').trim())
    .filter((l) => l.length > 0)

  const startOrder = childrenOf(nodes, parent.id).length

  return (
    <>
      <div className="row">
        <strong className="grow">{parent.title} にまとめて追加</strong>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          閉じる
        </button>
      </div>

      <Field label="項目（1行に1つ）">
        <textarea
          rows={8}
          value={text}
          placeholder={'開集合\n閉集合\n連結性\nコンパクト性'}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <p className="hint">
        行頭の「・」「1.」などは落として読み取ります。教科書の目次をそのまま貼れます。
      </p>

      <div className="grid2">
        <Field label="1項目の目安(分)">
          <input
            type="number"
            min={5}
            step={5}
            value={estimateMin}
            onChange={(e) => setEstimateMin(Number(e.target.value))}
          />
        </Field>
        <Field label="重要度">
          <select
            value={importance}
            onChange={(e) => setImportance(Number(e.target.value) as Importance)}
          >
            {([3, 2, 1] as Importance[]).map((i) => (
              <option key={i} value={i}>
                {IMPORTANCE_LABELS[i]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {titles.length > 0 && (
        <p className="hint">
          {titles.length}件を作ります: {titles.slice(0, 5).join(' / ')}
          {titles.length > 5 ? ' …' : ''}
        </p>
      )}

      <button
        type="button"
        className="btn primary"
        disabled={titles.length === 0}
        onClick={() =>
          onSave(
            titles.map((title, i) => ({
              id: newId('node'),
              parentId: parent.id,
              title,
              importance,
              estimateMin,
              order: startOrder + i,
              createdAt: new Date().toISOString(),
            })),
          )
        }
      >
        {titles.length}件を追加
      </button>
    </>
  )
}
