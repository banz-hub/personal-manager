import { useMemo, useState } from 'react'
import EventForm, { blankEvent } from '../components/EventForm'
import SubNav from '../components/SubNav'
import { Empty, Sheet } from '../components/ui'
import {
  DAY_LABELS,
  addMonths,
  formatDate,
  formatMonth,
  monthKey,
  parseDate,
  todayKey,
} from '../lib/date'
import { timelineOn } from '../lib/schedule'
import { useApp } from '../state/AppContext'
import { CATEGORY_LABELS, type EventItem } from '../types'

const SUB = [
  { to: '/yotei/calendar', label: 'カレンダー' },
  { to: '/yotei/timetable', label: '時間割' },
  { to: '/yotei/trips', label: '旅行' },
]

/** 月カレンダーに並べる日付。前後の月の余白ぶんも含めて6週ぶん返す */
function monthGrid(ym: string): Array<{ dateKey: string; inMonth: boolean }> {
  const first = parseDate(`${ym}-01`)
  const start = new Date(first)
  start.setDate(1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
    return { dateKey: key, inMonth: monthKey(key) === ym }
  })
}

export default function CalendarPage() {
  const { data, upsert, remove } = useApp()
  const [ym, setYm] = useState(() => monthKey(todayKey()))
  const [selected, setSelected] = useState(todayKey())
  const [editing, setEditing] = useState<EventItem | null>(null)

  const grid = useMemo(() => monthGrid(ym), [ym])
  // 月内の各日に何件予定があるかを先に数えておく
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const cell of grid) {
      map.set(cell.dateKey, timelineOn(cell.dateKey, data).length)
    }
    return map
  }, [grid, data])

  const items = useMemo(() => timelineOn(selected, data), [selected, data])

  return (
    <div className="page">
      <SubNav items={SUB} />

      <div className="day-nav">
        <button type="button" className="btn ghost sm" onClick={() => setYm(monthKey(addMonths(`${ym}-01`, -1)))}>
          前の月
        </button>
        <strong className="month-title">{formatMonth(ym)}</strong>
        <button type="button" className="btn ghost sm" onClick={() => setYm(monthKey(addMonths(`${ym}-01`, 1)))}>
          次の月
        </button>
      </div>

      <div className="cal">
        {DAY_LABELS.map((d, i) => (
          <span key={d} className={`cal-dow${i === 0 ? ' is-sun' : ''}${i === 6 ? ' is-sat' : ''}`}>
            {d}
          </span>
        ))}
        {grid.map((cell) => {
          const count = counts.get(cell.dateKey) ?? 0
          const day = parseDate(cell.dateKey).getDay()
          const classes = [
            'cal-cell',
            cell.inMonth ? '' : 'is-out',
            cell.dateKey === selected ? 'is-selected' : '',
            cell.dateKey === todayKey() ? 'is-today' : '',
            day === 0 ? 'is-sun' : '',
            day === 6 ? 'is-sat' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={cell.dateKey}
              type="button"
              className={classes}
              onClick={() => setSelected(cell.dateKey)}
            >
              <span className="cal-day">{Number(cell.dateKey.slice(8))}</span>
              {count > 0 ? <span className="cal-dot">{count > 3 ? '•••' : '•'.repeat(count)}</span> : null}
            </button>
          )
        })}
      </div>

      <h2>{formatDate(selected)}</h2>
      <div className="btn-row">
        <button
          type="button"
          className="btn primary"
          onClick={() => setEditing(blankEvent(selected))}
        >
          この日に予定を追加
        </button>
      </div>

      {items.length === 0 ? (
        <Empty>予定はありません。</Empty>
      ) : (
        <ul className="list">
          {items.map((item) => (
            <li key={item.id} className="list-item">
              <div>
                <strong>
                  {item.start} - {item.end} {item.title}
                </strong>
                <p className="muted small">
                  {item.kind === 'course' ? '授業' : CATEGORY_LABELS[item.category ?? 'other']}
                  {item.placeName ? ` / ${item.placeName}` : ''}
                  {item.room ? ` / ${item.room}` : ''}
                </p>
              </div>
              {item.event ? (
                <div className="list-actions">
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setEditing(item.event ?? null)}
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm danger"
                    onClick={() => {
                      if (confirm(`「${item.title}」を削除しますか？`)) remove('events', item.id)
                    }}
                  >
                    削除
                  </button>
                </div>
              ) : (
                <span className="muted small">時間割から</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={editing !== null}
        title="予定"
        onClose={() => setEditing(null)}
        footer={
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (editing) upsert('events', editing)
              setEditing(null)
            }}
          >
            保存
          </button>
        }
      >
        {editing ? <EventForm value={editing} onChange={setEditing} /> : null}
      </Sheet>
    </div>
  )
}
