import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import DepartureCard from '../components/DepartureCard'
import EventForm, { blankEvent } from '../components/EventForm'
import HomewardCard from '../components/HomewardCard'
import { Empty, Note, Sheet, Stat } from '../components/ui'
import { buildDay, remindersForDay } from '../lib/day'
import { addDays, formatDate, formatDuration, formatYen, todayKey, toMinutes } from '../lib/date'
import {
  notificationSupport,
  requestNotificationPermission,
  scheduleBackground,
  scheduleWhileOpen,
  showNow,
} from '../lib/reminders'
import { suggestForGap } from '../lib/suggest'
import { buildEventIcs, downloadText } from '../lib/transit'
import { useApp } from '../state/AppContext'
import { CATEGORY_LABELS, type EventItem } from '../types'

export default function TodayPage() {
  const { data, upsert } = useApp()
  const [dateKey, setDateKey] = useState(todayKey())
  const [now, setNow] = useState(() => new Date())
  const [editing, setEditing] = useState<EventItem | null>(null)

  // 出発までの残り時間を出すので、現在時刻を定期的に更新する
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const day = useMemo(() => buildDay(data, dateKey), [data, dateKey])
  const isToday = dateKey === todayKey()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  // 通知は、アプリを開いている間のタイマーと、対応端末なら閉じていても鳴る予約の二段構え
  const reminders = useMemo(() => remindersForDay(day, dateKey), [day, dateKey])
  useEffect(() => {
    if (!isToday) return
    void scheduleBackground(reminders)
    return scheduleWhileOpen(reminders, (r) => void showNow(r.title, r.body))
  }, [reminders, isToday])

  // 次に動くべき予定と、そこまでの残り時間
  const upcoming = day.planned.find((p) => p.item.endMin > nowMinutes)
  const leaveAt = upcoming?.journeys[0]?.leaveHomeAt
  const minutesToLeave = leaveAt ? toMinutes(leaveAt) - nowMinutes : null
  const dayEvents = day.items.map((i) => i.event).filter(Boolean) as EventItem[]
  const support = notificationSupport()

  return (
    <div className="page">
      <div className="day-nav">
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setDateKey(addDays(dateKey, -1))}
        >
          前の日
        </button>
        <input type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setDateKey(addDays(dateKey, 1))}
        >
          次の日
        </button>
        {!isToday ? (
          <button type="button" className="btn ghost sm" onClick={() => setDateKey(todayKey())}>
            今日へ
          </button>
        ) : null}
      </div>

      <h1>{formatDate(dateKey)}</h1>
      {data.profile.situation ? <p className="situation">{data.profile.situation}</p> : null}

      {isToday && upcoming ? (
        <div className="card hero">
          <span className="hero-label">つぎの予定</span>
          <strong className="hero-title">{upcoming.item.title}</strong>
          <span className="hero-sub">
            {upcoming.item.start} - {upcoming.item.end}
            {upcoming.item.placeName ? ` / ${upcoming.item.placeName}` : ''}
          </span>
          {leaveAt && minutesToLeave != null ? (
            <p className={`hero-leave${minutesToLeave < 0 ? ' is-late' : ''}`}>
              {minutesToLeave < 0
                ? `出発予定を ${formatDuration(-minutesToLeave)} 過ぎています`
                : `${leaveAt} に出発 — あと ${formatDuration(minutesToLeave)}`}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="stat-row">
        <Stat label="予定" value={`${day.items.length}件`} />
        <Stat
          label="空き時間"
          value={formatDuration(day.gaps.reduce((s, g) => s + g.minutes, 0))}
          sub={`${day.gaps.length}か所`}
        />
        <Stat label="交通費(片道計)" value={formatYen(day.fareYen)} />
      </div>

      <div className="btn-row">
        <button
          type="button"
          className="btn primary"
          onClick={() => setEditing(blankEvent(dateKey))}
        >
          予定を追加
        </button>
        <Link className="btn ghost" to="/yotei/todos">
          やること
        </Link>
      </div>

      <h2>タイムライン</h2>
      {day.planned.length === 0 ? (
        <Empty>予定がありません。授業は「予定 → 時間割」から半年ぶんまとめて登録できます。</Empty>
      ) : (
        <ul className="timeline">
          {day.planned.map((p) => (
            <li key={p.item.id} className={`tl-item is-${p.item.kind}`}>
              <div className="tl-time">
                <strong>{p.item.start}</strong>
                <span>{p.item.end}</span>
              </div>
              <div className="tl-body">
                <div className="tl-head">
                  <strong>{p.item.title}</strong>
                  <span className="pill">
                    {p.item.kind === 'course' ? '授業' : CATEGORY_LABELS[p.item.category ?? 'other']}
                  </span>
                </div>
                <p className="muted small">
                  {[p.item.placeName, p.item.room, p.item.station ? `${p.item.station}駅` : null]
                    .filter(Boolean)
                    .join(' / ') || '場所の登録なし'}
                </p>
                {p.item.event?.memo ? <p className="small">{p.item.event.memo}</p> : null}
                <DepartureCard planned={p} />
                <div className="link-row">
                  {p.item.event ? (
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setEditing(p.item.event ?? null)}
                    >
                      編集
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() =>
                      downloadText(
                        'yotei.ics',
                        buildEventIcs({
                          title: p.item.title,
                          dateKey,
                          start: p.journeys[0]?.leaveHomeAt ?? p.item.start,
                          end: p.item.end,
                          location: p.item.placeName ?? p.item.station,
                          description: p.journeys[0]
                            ? `${p.journeys[0].leaveHomeAt} 出発 / ${p.item.start} 開始`
                            : undefined,
                          alarmMinutesBefore: p.item.event?.remindMinutesBefore ?? 10,
                        }),
                        'text/calendar',
                      )
                    }
                  >
                    端末カレンダーに追加
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {day.homeward ? (
        <>
          <h2>帰り</h2>
          <HomewardCard
            homeward={day.homeward}
            dateKey={dateKey}
            homeStation={data.profile.homeStation}
            freeUntilFrom={day.items[day.items.length - 1]?.endMin}
          />
        </>
      ) : null}

      <h2>空き時間の使い道</h2>
      {day.gaps.length === 0 ? (
        <Empty>まとまった空き時間はありません。</Empty>
      ) : (
        day.gaps.map((gap) => {
          const suggestions = suggestForGap({
            gap,
            todos: data.todos,
            interests: data.interests,
            today: dateKey,
            dayEvents,
            limit: 4,
          })
          return (
            <div className="card gap-card" key={`${gap.startMin}-${gap.endMin}`}>
              <div className="gap-head">
                <strong>
                  {gap.start} - {gap.end}
                </strong>
                <span className="pill">{formatDuration(gap.minutes)}</span>
                <span className="muted small">{gap.placeLabel}</span>
              </div>
              {gap.travelReserved > 0 ? (
                <p className="muted small">
                  移動に {formatDuration(gap.travelReserved)} を確保したうえでの空きです
                </p>
              ) : null}
              <ul className="suggest-list">
                {suggestions.map((s) => {
                  const todo = s.todo
                  return (
                  <li key={s.id}>
                    <div>
                      <strong>{s.title}</strong>
                      <p className="muted small">{s.reason}</p>
                    </div>
                    {todo ? (
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => upsert('todos', { ...todo, doneAt: dateKey })}
                      >
                        済み
                      </button>
                    ) : (
                      <span className="muted small">{formatDuration(s.minutes)}</span>
                    )}
                  </li>
                  )
                })}
              </ul>
            </div>
          )
        })
      )}

      {support.supported && support.permission !== 'granted' ? (
        <Note>
          通知はまだ許可されていません。
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => void requestNotificationPermission().then(() => setNow(new Date()))}
          >
            通知を許可
          </button>
          {support.standalone
            ? ''
            : ' iPhone では、ホーム画面に追加したアイコンから開いた状態でないと通知は使えません。'}
        </Note>
      ) : null}

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
