import { useMemo, useState } from 'react'
import { allStations } from '../data/stations'
import { useApp } from '../state/AppContext'
import { newId } from '../lib/id'
import { knownStations } from '../lib/routes'
import { payTypeOf } from '../lib/payroll'
import { selectionFor } from '../lib/classSlots'
import { CATEGORY_LABELS, type EventCategory, type EventItem } from '../types'
import { ChipGroup, Field, FieldRow, StationInput } from './ui'

const CATEGORIES = Object.entries(CATEGORY_LABELS) as Array<[EventCategory, string]>

const REMIND_OPTIONS = [
  { value: '', label: '通知しない' },
  { value: '0', label: '出発時刻ちょうど' },
  { value: '10', label: '出発の10分前' },
  { value: '30', label: '出発の30分前' },
  { value: '60', label: '出発の1時間前' },
]

export function blankEvent(dateKey: string, category: EventCategory = 'private'): EventItem {
  return {
    id: newId('ev'),
    title: '',
    category,
    date: dateKey,
    start: '10:00',
    end: '11:00',
    needsTravel: true,
  }
}

/**
 * 予定の入力フォーム。
 * 場所は「登録済みの場所」から選ぶか、駅名を直接書くかのどちらか。
 * 登録済みを選べば駅と徒歩時間が自動で入るので、毎回打たなくてよい。
 */
export default function EventForm({
  value,
  onChange,
}: {
  value: EventItem
  onChange: (next: EventItem) => void
}) {
  const { data } = useApp()
  const [usePlace, setUsePlace] = useState(Boolean(value.placeId) || data.places.length > 0)
  const stations = useMemo(
    () => knownStations(data.legs, [data.profile.homeStation, ...data.places.map((p) => p.station), ...allStations()]),
    [data.legs, data.places, data.profile.homeStation],
  )
  const patch = (p: Partial<EventItem>) => onChange({ ...value, ...p })
  const selectedJob = data.jobs.find((j) => j.id === value.jobId)
  const hasSlots = (selectedJob?.classSlots?.length ?? 0) > 0
  const slotInfo =
    selectedJob && hasSlots ? selectionFor(selectedJob, value.classSlotIds ?? []) : null

  return (
    <>
      <Field label="予定の名前" wide>
        <input
          type="text"
          value={value.title}
          placeholder="例) 3年ゼミ / 面接(◯◯社) / 京都旅行"
          onChange={(e) => patch({ title: e.target.value })}
        />
      </Field>

      <Field label="種類">
        <select
          value={value.category}
          onChange={(e) => patch({ category: e.target.value as EventCategory })}
        >
          {CATEGORIES.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <FieldRow>
        <Field label="日付">
          <input type="date" value={value.date} onChange={(e) => patch({ date: e.target.value })} />
        </Field>
        <Field label="開始">
          <input type="time" value={value.start} onChange={(e) => patch({ start: e.target.value })} />
        </Field>
        <Field label="終了">
          <input type="time" value={value.end} onChange={(e) => patch({ end: e.target.value })} />
        </Field>
      </FieldRow>

      {value.category === 'baito' ? (
        <>
          <FieldRow>
            <Field label="バイト先">
              <select
                value={value.jobId ?? ''}
                onChange={(e) => patch({ jobId: e.target.value || undefined })}
              >
                <option value="">選択なし</option>
                {data.jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                  </option>
                ))}
              </select>
            </Field>
            {selectedJob && payTypeOf(selectedJob) === 'perClass' && !hasSlots ? (
              <Field
                label="コマ数"
                hint={`1コマ ${selectedJob.classMinutes ?? 95}分。開始と終了は在校時間を入れてください`}
              >
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={value.classCount ?? 0}
                  onChange={(e) => patch({ classCount: Number(e.target.value) })}
                />
              </Field>
            ) : selectedJob && payTypeOf(selectedJob) === 'perClass' ? null : (
              <Field label="休憩(分)">
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={value.breakMinutes ?? 0}
                  onChange={(e) => patch({ breakMinutes: Number(e.target.value) })}
                />
              </Field>
            )}
          </FieldRow>

          {selectedJob && payTypeOf(selectedJob) === 'perClass' && hasSlots ? (
            <Field label="担当するコマ" wide hint="選ぶと在校時間が自動で入ります">
              <ChipGroup
                options={(selectedJob.classSlots ?? []).map((slot) => ({
                  value: slot.id,
                  label: `${slot.label} ${slot.start}`,
                }))}
                value={value.classSlotIds ?? []}
                onChange={(ids) => {
                  const picked = selectionFor(selectedJob, ids)
                  patch(
                    picked
                      ? {
                          classSlotIds: ids,
                          classCount: picked.slots.length,
                          start: picked.start,
                          end: picked.end,
                        }
                      : { classSlotIds: ids, classCount: 0 },
                  )
                }}
              />
            </Field>
          ) : null}

          {slotInfo ? (
            <p className="muted small">
              授業 {slotInfo.classStart} - {slotInfo.classEnd}（{slotInfo.slots.length}コマ）/ 在校{' '}
              {slotInfo.start} - {slotInfo.end}
            </p>
          ) : null}
        </>
      ) : null}

      {value.category === 'trip' && data.trips.length > 0 ? (
        <Field label="どの旅行のぶんか">
          <select
            value={value.tripId ?? ''}
            onChange={(e) => patch({ tripId: e.target.value || undefined })}
          >
            <option value="">選択なし</option>
            {data.trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <div className="switch-row">
        <label className="switch">
          <input
            type="checkbox"
            checked={value.needsTravel}
            onChange={(e) => patch({ needsTravel: e.target.checked })}
          />
          <span>出発時刻と交通費を計算する</span>
        </label>
      </div>

      {value.needsTravel ? (
        <>
          {data.places.length > 0 ? (
            <div className="switch-row">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={usePlace}
                  onChange={(e) => {
                    setUsePlace(e.target.checked)
                    if (!e.target.checked) patch({ placeId: undefined })
                  }}
                />
                <span>登録済みの場所から選ぶ</span>
              </label>
            </div>
          ) : null}

          {usePlace && data.places.length > 0 ? (
            <Field label="場所" hint="設定 → 場所 で追加できます">
              <select
                value={value.placeId ?? ''}
                onChange={(e) => patch({ placeId: e.target.value || undefined })}
              >
                <option value="">選択なし</option>
                {data.places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}（{p.station}）
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <FieldRow>
              <Field label="行き先の最寄り駅">
                <StationInput
                  value={value.station ?? ''}
                  onChange={(v) => patch({ station: v })}
                  stations={stations}
                />
              </Field>
              <Field label="駅から徒歩(分)">
                <input
                  type="number"
                  min={0}
                  value={value.walkMinutes ?? 0}
                  onChange={(e) => patch({ walkMinutes: Number(e.target.value) })}
                />
              </Field>
            </FieldRow>
          )}
        </>
      ) : null}

      <Field label="通知" hint="出発時刻を基準にします">
        <select
          value={value.remindMinutesBefore == null ? '' : String(value.remindMinutesBefore)}
          onChange={(e) =>
            patch({
              remindMinutesBefore: e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
        >
          {REMIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="メモ" wide>
        <textarea
          rows={2}
          value={value.memo ?? ''}
          onChange={(e) => patch({ memo: e.target.value })}
          placeholder="持ち物、集合場所など"
        />
      </Field>
    </>
  )
}
