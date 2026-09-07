import { useEffect, useId, type ReactNode } from 'react'

/** ラベル付きの入力枠 */
export function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  return (
    <label className={`field${wide ? ' is-wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

/** 入力を横に並べる */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="field-row">{children}</div>
}

/** 下から出る入力パネル。予定の追加・編集に使う */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    // パネルを開いている間は背面をスクロールさせない
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <strong>{title}</strong>
          <button type="button" className="btn ghost sm" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {sub ? <span className="stat-sub">{sub}</span> : null}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return <p className={`note is-${tone}`}>{children}</p>
}

/** 画面内の切り替えタブ */
export function SectionTabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={item.value === value}
          className={`seg-item${item.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/** 登録済みの駅名を候補に出す入力欄 */
export function StationInput({
  value,
  onChange,
  stations,
  placeholder = '駅名',
}: {
  value: string
  onChange: (v: string) => void
  stations: string[]
  placeholder?: string
}) {
  const id = useId()
  return (
    <>
      <input
        type="text"
        list={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={id}>
        {stations.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  )
}

/** 複数選べるチップ */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>
  value: T[]
  onChange: (v: T[]) => void
}) {
  const toggle = (v: T) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  }
  return (
    <div className="chips">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`chip${value.includes(o.value) ? ' is-on' : ''}`}
          onClick={() => toggle(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
