import type { ReactNode } from 'react'

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat">
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  )
}

export function Banner({
  children,
  alert,
}: {
  children: ReactNode
  alert?: boolean
}) {
  return <div className={`banner${alert ? ' alert' : ''}`}>{children}</div>
}

/** 下から出る入力用のシート */
export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="sheet"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet-body">{children}</div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}
