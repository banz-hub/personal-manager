import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import EventForm, { blankEvent } from '../components/EventForm'
import SubNav from '../components/SubNav'
import { Empty, Sheet } from '../components/ui'
import {
  DAY_LABELS,
  addDays,
  addMonths,
  formatDate,
  formatMonth,
  monthKey,
  parseDate,
  todayKey,
} from '../lib/date'
import { timelineOn, type TimelineItem } from '../lib/schedule'
import { labelOf, toneOf } from '../lib/tone'
import { hourRange, layoutDay, mondayOf, weekDays } from '../lib/week'
import { useApp } from '../state/AppContext'
import type { EventItem } from '../types'

const SUB = [
  { to: '/yotei/calendar', label: 'カレンダー' },
  { to: '/yotei/timetable', label: '時間割' },
  { to: '/yotei/trips', label: '旅行' },
]

/** 1 時間の高さ (px)。30 分の予定でも題名が 1 行は入る高さ */
const HOUR_PX = 44
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type View = 'week' | 'month'
type Data = Parameters<typeof timelineOn>[1]

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

/**
 * 予定のカレンダー。**週（縦が時刻）がはじめの表示**で、月にも切り替えられる。
 * 1 ページ目の「週で見る」から来たときは `?d=` の日の週を開く。
 */
export default function CalendarPage() {
  const { data, upsert, remove } = useApp()
  const [params] = useSearchParams()
  const requested = params.get('d')
  const today = todayKey()
  const initial = requested && DATE_RE.test(requested) ? requested : today
  const [view, setView] = useState<View>('week')
  const [selected, setSelected] = useState(initial)
  const [ym, setYm] = useState(() => monthKey(initial))
  const [monday, setMonday] = useState(() => mondayOf(initial))
  const [editing, setEditing] = useState<EventItem | null>(null)

  const items = useMemo(() => timelineOn(selected, data), [selected, data])

  // 選んだ日に、週と月の表示も合わせる。切り替えたときに別の週が出ないように
  const select = (d: string) => {
    setSelected(d)
    setYm(monthKey(d))
    setMonday(mondayOf(d))
  }

  return (
    <div className="page">
      <SubNav items={SUB} />

      <div className="seg" role="tablist" aria-label="表示">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'week'}
          className={`seg-item${view === 'week' ? ' is-active' : ''}`}
          onClick={() => setView('week')}
        >
          週
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'month'}
          className={`seg-item${view === 'month' ? ' is-active' : ''}`}
          onClick={() => setView('month')}
        >
          月
        </button>
      </div>

      {view === 'week' ? (
        <WeekView
          monday={monday}
          selected={selected}
          today={today}
          data={data}
          onWeek={(n) => setMonday(addDays(monday, n * 7))}
          onToday={() => select(today)}
          onSelect={select}
          onEdit={(e) => setEditing(e)}
        />
      ) : (
        <MonthView
          ym={ym}
          selected={selected}
          today={today}
          data={data}
          onMonth={(n) => setYm(monthKey(addMonths(`${ym}-01`, n)))}
          onSelect={select}
        />
      )}

      <div className="day-row">
        <h2>{formatDate(selected)}</h2>
        <Link className="btn ghost sm" to={selected === today ? '/' : `/?d=${selected}`}>
          この日を開く
        </Link>
      </div>
      <div className="btn-row">
        <button type="button" className="btn primary" onClick={() => setEditing(blankEvent(selected))}>
          この日に予定を追加
        </button>
      </div>

      {items.length === 0 ? (
        <Empty>予定はありません。</Empty>
      ) : (
        <ul className="list">
          {items.map((item) => {
            const tone = toneOf(item.kind, item.category)
            return (
              <li key={item.id} className={`list-item ev-li t-${tone}`}>
                <div>
                  <strong>
                    {item.start} - {item.end} {item.title}
                  </strong>
                  <p className="muted small">
                    <span className={`tag t-${tone}`}>{labelOf(item.kind, item.category)}</span>
                    {item.placeName ? ` ${item.placeName}` : ''}
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
            )
          })}
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

/**
 * 週のカレンダー。縦が時刻、横が月〜日。
 * 予定は時刻の位置に置き、種類の色で塗る。押すとその日を下に開く（予定なら編集）。
 */
function WeekView({
  monday,
  selected,
  today,
  data,
  onWeek,
  onToday,
  onSelect,
  onEdit,
}: {
  monday: string
  selected: string
  today: string
  data: Data
  onWeek: (n: number) => void
  onToday: () => void
  onSelect: (d: string) => void
  onEdit: (e: EventItem) => void
}) {
  const days = useMemo(() => weekDays(monday), [monday])
  const perDay = useMemo(() => days.map((d) => timelineOn(d, data)), [days, data])
  const [from, to] = hourRange(perDay.flat())
  const hours = Array.from({ length: to - from }, (_, i) => from + i)
  const height = (to - from) * HOUR_PX
  const y = (min: number) => ((min - from * 60) / 60) * HOUR_PX
  const [nowMin] = useState(() => {
    const n = new Date()
    return n.getHours() * 60 + n.getMinutes()
  })
  const start = parseDate(monday)
  const end = parseDate(days[6])

  return (
    <>
      <div className="day-nav">
        <button type="button" className="btn ghost sm" onClick={() => onWeek(-1)}>
          前の週
        </button>
        <strong className="month-title">
          {start.getMonth() + 1}/{start.getDate()}〜{end.getMonth() + 1}/{end.getDate()}
        </strong>
        <button type="button" className="btn ghost sm" onClick={() => onWeek(1)}>
          次の週
        </button>
      </div>
      {!days.includes(today) && (
        <button type="button" className="btn ghost sm wk-back" onClick={onToday}>
          今週に戻る
        </button>
      )}

      <div className="wk">
        <div className="wk-head">
          <span />
          {days.map((d) => {
            const dow = parseDate(d).getDay()
            const cls = [
              'wk-dh',
              d === today ? 'is-today' : '',
              d === selected ? 'is-selected' : '',
              dow === 0 ? 'is-sun' : '',
              dow === 6 ? 'is-sat' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button key={d} type="button" className={cls} onClick={() => onSelect(d)}>
                <span>{DAY_LABELS[dow]}</span>
                <strong>{Number(d.slice(8))}</strong>
              </button>
            )
          })}
        </div>

        <div className="wk-body" style={{ height, backgroundSize: `100% ${HOUR_PX}px` }}>
          <div className="wk-hours">
            {hours.map((h) => (
              <span key={h} style={{ top: (h - from) * HOUR_PX }}>
                {h}
              </span>
            ))}
          </div>
          {days.map((d, i) => (
            <div
              key={d}
              className={`wk-col${d === today ? ' is-today' : ''}${d === selected ? ' is-selected' : ''}`}
              onClick={() => onSelect(d)}
            >
              {layoutDay(perDay[i]).map(({ item, lane, lanes }) => (
                <WeekEvent
                  key={item.id}
                  item={item}
                  top={y(item.startMin)}
                  height={Math.max(18, y(item.endMin) - y(item.startMin))}
                  lane={lane}
                  lanes={lanes}
                  onClick={() => {
                    onSelect(d)
                    if (item.event) onEdit(item.event)
                  }}
                />
              ))}
              {d === today && nowMin >= from * 60 && nowMin <= to * 60 && (
                <span className="wk-now" style={{ top: y(nowMin) }} aria-hidden />
              )}
            </div>
          ))}
        </div>
      </div>
      <p className="wk-legend">
        <span className="tag t-class">授業</span>
        <span className="tag t-baito">バイト</span>
        <span className="tag t-job">就活</span>
        <span className="tag t-exam">試験</span>
        <span className="tag t-private">私用・旅行</span>
      </p>
    </>
  )
}

function WeekEvent({
  item,
  top,
  height,
  lane,
  lanes,
  onClick,
}: {
  item: TimelineItem
  top: number
  height: number
  lane: number
  lanes: number
  onClick: () => void
}) {
  const tone = toneOf(item.kind, item.category)
  return (
    <button
      type="button"
      className={`wk-ev t-${tone}`}
      style={{ top, height, left: `${(lane / lanes) * 100}%`, width: `${100 / lanes}%` }}
      aria-label={`${item.start}〜${item.end} ${item.title}（${labelOf(item.kind, item.category)}）`}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <span className="wk-ev-title">{item.title || labelOf(item.kind, item.category)}</span>
      {height >= 40 && <span className="wk-ev-time">{item.start}</span>}
    </button>
  )
}

/** 月のカレンダー。日ごとに、種類の色の点を予定の数だけ出す */
function MonthView({
  ym,
  selected,
  today,
  data,
  onMonth,
  onSelect,
}: {
  ym: string
  selected: string
  today: string
  data: Data
  onMonth: (n: number) => void
  onSelect: (d: string) => void
}) {
  const grid = useMemo(() => monthGrid(ym), [ym])
  const tones = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const cell of grid) {
      map.set(
        cell.dateKey,
        timelineOn(cell.dateKey, data).map((it) => toneOf(it.kind, it.category)),
      )
    }
    return map
  }, [grid, data])

  return (
    <>
      <div className="day-nav">
        <button type="button" className="btn ghost sm" onClick={() => onMonth(-1)}>
          前の月
        </button>
        <strong className="month-title">{formatMonth(ym)}</strong>
        <button type="button" className="btn ghost sm" onClick={() => onMonth(1)}>
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
          const list = tones.get(cell.dateKey) ?? []
          const day = parseDate(cell.dateKey).getDay()
          const classes = [
            'cal-cell',
            cell.inMonth ? '' : 'is-out',
            cell.dateKey === selected ? 'is-selected' : '',
            cell.dateKey === today ? 'is-today' : '',
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
              onClick={() => onSelect(cell.dateKey)}
            >
              <span className="cal-day">{Number(cell.dateKey.slice(8))}</span>
              {list.length > 0 ? (
                <span className="cal-pips">
                  {list.slice(0, 4).map((t, i) => (
                    <span key={i} className={`cal-pip t-${t}`} />
                  ))}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </>
  )
}
