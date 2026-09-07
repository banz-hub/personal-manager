/**
 * 下のタブに入りきらなかった画面の一覧。
 *
 * 中身は `features.ts` から作る。機能を足すと、そこの `nav` のうち
 * `primary` でないものが自動でここに並ぶ。このファイルは触らなくてよい。
 */

import { Link } from 'react-router-dom'
import { FEATURES } from './features'

export default function MorePage() {
  const groups = FEATURES.map((f) => ({
    label: f.label,
    items: f.nav.filter((n) => !n.primary),
  })).filter((g) => g.items.length > 0)

  return (
    <div className="page">
      <strong>もっと</strong>
      {groups.map((g) => (
        <section className="bucket" key={g.label}>
          <h2 className="section">{g.label}</h2>
          <div className="more-list">
            {g.items.map((item) => (
              <Link className="more-item" key={item.to} to={item.to}>
                <span className="more-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="grow">{item.label}</span>
                <span className="dim" aria-hidden>
                  ›
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
