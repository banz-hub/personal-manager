import { NavLink } from 'react-router-dom'

/** 同じタブの中で画面を切り替える小さなナビ */
export default function SubNav({ items }: { items: Array<{ to: string; label: string }> }) {
  return (
    <nav className="subnav">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end
          className={({ isActive }) => `subnav-item${isActive ? ' is-active' : ''}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
