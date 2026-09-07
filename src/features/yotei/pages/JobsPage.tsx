import { useState } from 'react'
import SubNav from '../components/SubNav'
import { Empty, Field, FieldRow, Note, Sheet } from '../components/ui'
import { formatDate, formatYen, todayKey } from '../lib/date'
import { newId } from '../lib/id'
import { DEFAULT_JOB, payTypeOf, resolveRate } from '../lib/payroll'
import { DEFAULT_CLASS_SLOTS, attendPadding, nextSlotDraft } from '../lib/classSlots'
import { useApp } from '../state/AppContext'
import type { ClassSlot, Job, JobRate, PayType } from '../types'

const SUB = [
  { to: '/yotei/money', label: '交通費' },
  { to: '/yotei/pay', label: '給与' },
  { to: '/yotei/jobs', label: 'バイト先' },
]

function blankJob(): Job {
  return { id: newId('jb'), name: '', ...DEFAULT_JOB, rates: [] }
}

/** 昇給は3月・9月が多いので、その年の直近の区切りを初期値にしておく */
function defaultRaiseDate(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  if (m < 3) return `${y}-03-01`
  if (m < 9) return `${y}-09-01`
  return `${y + 1}-03-01`
}

/**
 * バイト先ごとの条件。
 * 給与体系（時給制／コマ給制）はバイト先ごとに選べるので、
 * 種類の違うバイトを掛け持ちしてもそれぞれ正しく計算される。
 * 単価は昇給履歴として日付つきで持つので、昇給前のシフトは当時の単価のまま集計される。
 */
export default function JobsPage() {
  const { data, upsert, remove } = useApp()
  const [editing, setEditing] = useState<Job | null>(null)

  const patchSlot = (slot: ClassSlot, patch: Partial<ClassSlot>) => {
    if (!editing) return
    setEditing({
      ...editing,
      classSlots: (editing.classSlots ?? []).map((s) =>
        s.id === slot.id ? { ...s, ...patch } : s,
      ),
    })
  }

  const patchRate = (rate: JobRate, patch: Partial<JobRate>) => {
    if (!editing) return
    setEditing({
      ...editing,
      rates: (editing.rates ?? []).map((r) => (r.id === rate.id ? { ...r, ...patch } : r)),
    })
  }

  const addRate = () => {
    if (!editing) return
    const current = resolveRate(editing, defaultRaiseDate())
    // いまの単価を初期値にして、変えたところだけ書き換えてもらう
    const next: JobRate =
      payTypeOf(editing) === 'perClass'
        ? {
            id: newId('rt'),
            effectiveFrom: defaultRaiseDate(),
            perClassYen: current.perClassYen,
            dailyAllowanceYen: current.dailyAllowanceYen,
            officeHourlyYen: current.officeHourlyYen,
          }
        : { id: newId('rt'), effectiveFrom: defaultRaiseDate(), hourlyYen: current.hourlyYen }
    setEditing({ ...editing, rates: [...(editing.rates ?? []), next] })
  }

  return (
    <div className="page">
      <SubNav items={SUB} />
      <h1>バイト先</h1>
      <p className="muted small">
        給与体系はバイト先ごとに選べます。時給制とコマ給制のバイトを掛け持ちしても、
        それぞれの方式で計算されます。
      </p>

      <div className="btn-row">
        <button type="button" className="btn primary" onClick={() => setEditing(blankJob())}>
          バイト先を追加
        </button>
      </div>

      {data.jobs.length === 0 ? (
        <Empty>まだ登録がありません。</Empty>
      ) : (
        <ul className="list">
          {data.jobs.map((job) => {
            const now = resolveRate(job, todayKey())
            const perClass = payTypeOf(job) === 'perClass'
            return (
              <li key={job.id} className="list-item">
                <div>
                  <strong>{job.name}</strong>{' '}
                  <span className="pill">{perClass ? 'コマ給制' : '時給制'}</span>
                  {perClass ? (
                    <p className="muted small">
                      1コマ {formatYen(now.perClassYen)}（{now.classMinutes}分）・ 日当{' '}
                      {formatYen(now.dailyAllowanceYen)}（{now.allowanceMinutes}分ぶん）・ 事務給{' '}
                      {formatYen(now.officeHourlyYen)}/時
                    </p>
                  ) : (
                    <p className="muted small">
                      時給 {formatYen(now.hourlyYen)} / 深夜 {job.nightStart}-{job.nightEnd} ×
                      {now.nightRate}
                    </p>
                  )}
                  <p className="muted small">
                    {job.closingDay === 31 ? '月末' : `${job.closingDay}日`}締め /{' '}
                    {job.payMonthOffset === 0 ? '当月' : `${job.payMonthOffset}か月後`}
                    {job.payDay}日払い
                    {job.transportPaid ? ` / 交通費 1日${formatYen(job.transportPerDayYen)}` : ''}
                    {job.rates && job.rates.length > 0 ? ` / 昇給 ${job.rates.length}件` : ''}
                  </p>
                </div>
                <div className="list-actions">
                  <button type="button" className="btn ghost sm" onClick={() => setEditing(job)}>
                    編集
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm danger"
                    onClick={() => {
                      if (confirm(`「${job.name}」を削除しますか？`)) remove('jobs', job.id)
                    }}
                  >
                    削除
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Sheet
        open={editing !== null}
        title="バイト先"
        onClose={() => setEditing(null)}
        footer={
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              if (editing && editing.name.trim()) upsert('jobs', editing)
              setEditing(null)
            }}
          >
            保存
          </button>
        }
      >
        {editing ? (
          <>
            <Field label="名前" wide>
              <input
                type="text"
                value={editing.name}
                placeholder="例) 駅前のカフェ / 個別指導塾"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>

            <Field label="給与体系" hint="バイト先ごとに別々に設定できます">
              <select
                value={payTypeOf(editing)}
                onChange={(e) => setEditing({ ...editing, payType: e.target.value as PayType })}
              >
                <option value="hourly">時給制</option>
                <option value="perClass">コマ給制（塾など）</option>
              </select>
            </Field>

            {payTypeOf(editing) === 'perClass' ? (
              <>
                <FieldRow>
                  <Field label="1コマの金額(円)">
                    <input
                      type="number"
                      min={0}
                      step={10}
                      value={editing.perClassYen ?? 0}
                      onChange={(e) =>
                        setEditing({ ...editing, perClassYen: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label="1コマの長さ(分)">
                    <input
                      type="number"
                      min={1}
                      value={editing.classMinutes ?? 0}
                      onChange={(e) =>
                        setEditing({ ...editing, classMinutes: Number(e.target.value) })
                      }
                    />
                  </Field>
                </FieldRow>
                <FieldRow>
                  <Field label="日当(円)" hint="出勤1日につき">
                    <input
                      type="number"
                      min={0}
                      value={editing.dailyAllowanceYen ?? 0}
                      onChange={(e) =>
                        setEditing({ ...editing, dailyAllowanceYen: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label="日当がカバーする時間(分)" hint="準備・片付けぶん">
                    <input
                      type="number"
                      min={0}
                      value={editing.allowanceMinutes ?? 0}
                      onChange={(e) =>
                        setEditing({ ...editing, allowanceMinutes: Number(e.target.value) })
                      }
                    />
                  </Field>
                </FieldRow>
                <Field label="事務給の時給(円)" hint="授業でも日当でもカバーされない時間ぶん">
                  <input
                    type="number"
                    min={0}
                    step={10}
                    value={editing.officeHourlyYen ?? 0}
                    onChange={(e) =>
                      setEditing({ ...editing, officeHourlyYen: Number(e.target.value) })
                    }
                  />
                </Field>
                <Note>
                  1日の給与 ＝ コマ数 × コマ給 ＋ 日当 ＋ 事務時間 × 事務給 ÷ 60
                  <br />
                  事務時間 ＝ 在校時間 − 授業時間 − 日当がカバーする時間（マイナスなら0）
                  <br />
                  日当は出勤1日につき1回です。同じ日に2件シフトを入れても二重には付きません。
                </Note>
              </>
            ) : (
              <>
                <FieldRow>
                  <Field label="時給(円)">
                    <input
                      type="number"
                      min={0}
                      step={10}
                      value={editing.hourlyYen}
                      onChange={(e) =>
                        setEditing({ ...editing, hourlyYen: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label="深夜の倍率">
                    <input
                      type="number"
                      min={1}
                      step={0.05}
                      value={editing.nightRate}
                      onChange={(e) =>
                        setEditing({ ...editing, nightRate: Number(e.target.value) })
                      }
                    />
                  </Field>
                </FieldRow>
                <FieldRow>
                  <Field label="深夜帯 開始">
                    <input
                      type="time"
                      value={editing.nightStart}
                      onChange={(e) => setEditing({ ...editing, nightStart: e.target.value })}
                    />
                  </Field>
                  <Field label="深夜帯 終了">
                    <input
                      type="time"
                      value={editing.nightEnd}
                      onChange={(e) => setEditing({ ...editing, nightEnd: e.target.value })}
                    />
                  </Field>
                </FieldRow>
              </>
            )}

            <h3>コマの割り当て</h3>
            <p className="muted small">
              ここに登録したコマを、シフトを作るときに選べます。選ぶと在校時間が自動で入ります。
            </p>
            <FieldRow>
              <Field label="授業の何分前から在校">
                <input
                  type="number"
                  min={0}
                  value={editing.attendBeforeMinutes ?? attendPadding(editing).before}
                  onChange={(e) =>
                    setEditing({ ...editing, attendBeforeMinutes: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="授業の何分後まで在校">
                <input
                  type="number"
                  min={0}
                  value={editing.attendAfterMinutes ?? attendPadding(editing).after}
                  onChange={(e) =>
                    setEditing({ ...editing, attendAfterMinutes: Number(e.target.value) })
                  }
                />
              </Field>
            </FieldRow>

            {(editing.classSlots ?? []).length === 0 ? (
              <div className="btn-row">
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setEditing({ ...editing, classSlots: DEFAULT_CLASS_SLOTS })}
                >
                  コマ割りのひな型(X/Y/A/B/C/D)を入れる
                </button>
              </div>
            ) : (
              <table className="bulk">
                <thead>
                  <tr>
                    <th>コマ</th>
                    <th>開始</th>
                    <th>終了</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...(editing.classSlots ?? [])].map((slot) => (
                    <tr key={slot.id}>
                      <th scope="row">
                        <input
                          type="text"
                          value={slot.label}
                          onChange={(e) => patchSlot(slot, { label: e.target.value })}
                        />
                      </th>
                      <td>
                        <input
                          type="time"
                          value={slot.start}
                          onChange={(e) => patchSlot(slot, { start: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          value={slot.end}
                          onChange={(e) => patchSlot(slot, { end: e.target.value })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn ghost sm danger"
                          onClick={() =>
                            setEditing({
                              ...editing,
                              classSlots: (editing.classSlots ?? []).filter(
                                (x) => x.id !== slot.id,
                              ),
                            })
                          }
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(editing.classSlots ?? []).length > 0 ? (
              <div className="btn-row">
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      classSlots: [
                        ...(editing.classSlots ?? []),
                        nextSlotDraft(editing.classSlots ?? []),
                      ],
                    })
                  }
                >
                  コマを追加
                </button>
              </div>
            ) : null}

            <h3>昇給</h3>
            <p className="muted small">
              昇給したら、<strong>適用が始まる日</strong>と新しい金額を足してください。
              その日より前のシフトは当時の単価のまま計算されるので、過去の集計は変わりません。
            </p>
            {(editing.rates ?? []).length === 0 ? (
              <p className="muted small">まだありません。上の金額がずっと適用されます。</p>
            ) : (
              [...(editing.rates ?? [])]
                .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
                .map((rate) => (
                  <div className="card raise" key={rate.id}>
                    <FieldRow>
                      <Field label="この日から">
                        <input
                          type="date"
                          value={rate.effectiveFrom}
                          onChange={(e) => patchRate(rate, { effectiveFrom: e.target.value })}
                        />
                      </Field>
                      {payTypeOf(editing) === 'perClass' ? (
                        <Field label="1コマ(円)">
                          <input
                            type="number"
                            min={0}
                            step={10}
                            value={rate.perClassYen ?? ''}
                            onChange={(e) =>
                              patchRate(rate, {
                                perClassYen:
                                  e.target.value === '' ? undefined : Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                      ) : (
                        <Field label="時給(円)">
                          <input
                            type="number"
                            min={0}
                            step={10}
                            value={rate.hourlyYen ?? ''}
                            onChange={(e) =>
                              patchRate(rate, {
                                hourlyYen:
                                  e.target.value === '' ? undefined : Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                      )}
                    </FieldRow>
                    {payTypeOf(editing) === 'perClass' ? (
                      <FieldRow>
                        <Field label="日当(円)">
                          <input
                            type="number"
                            min={0}
                            value={rate.dailyAllowanceYen ?? ''}
                            onChange={(e) =>
                              patchRate(rate, {
                                dailyAllowanceYen:
                                  e.target.value === '' ? undefined : Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                        <Field label="事務給(円/時)">
                          <input
                            type="number"
                            min={0}
                            step={10}
                            value={rate.officeHourlyYen ?? ''}
                            onChange={(e) =>
                              patchRate(rate, {
                                officeHourlyYen:
                                  e.target.value === '' ? undefined : Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                      </FieldRow>
                    ) : null}
                    <div className="btn-row">
                      <span className="muted small">
                        {formatDate(rate.effectiveFrom, false)}から適用
                      </span>
                      <button
                        type="button"
                        className="btn ghost sm danger"
                        onClick={() =>
                          setEditing({
                            ...editing,
                            rates: (editing.rates ?? []).filter((r) => r.id !== rate.id),
                          })
                        }
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ))
            )}
            <div className="btn-row">
              <button type="button" className="btn ghost sm" onClick={addRate}>
                昇給を追加
              </button>
            </div>

            <div className="switch-row">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={editing.transportPaid}
                  onChange={(e) => setEditing({ ...editing, transportPaid: e.target.checked })}
                />
                <span>交通費が支給される</span>
              </label>
            </div>
            {editing.transportPaid ? (
              <Field label="1日あたりの支給額(円)">
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={editing.transportPerDayYen}
                  onChange={(e) =>
                    setEditing({ ...editing, transportPerDayYen: Number(e.target.value) })
                  }
                />
              </Field>
            ) : null}

            <FieldRow>
              <Field label="締め日" hint="月末なら 31">
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={editing.closingDay}
                  onChange={(e) => setEditing({ ...editing, closingDay: Number(e.target.value) })}
                />
              </Field>
              <Field label="給料日">
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={editing.payDay}
                  onChange={(e) => setEditing({ ...editing, payDay: Number(e.target.value) })}
                />
              </Field>
              <Field label="支払は何か月後">
                <select
                  value={editing.payMonthOffset}
                  onChange={(e) =>
                    setEditing({ ...editing, payMonthOffset: Number(e.target.value) })
                  }
                >
                  <option value={0}>当月</option>
                  <option value={1}>翌月</option>
                  <option value={2}>翌々月</option>
                </select>
              </Field>
            </FieldRow>

            {data.places.length > 0 ? (
              <Field label="勤務先の場所" hint="登録しておくと出発時刻と交通費が出せます">
                <select
                  value={editing.placeId ?? ''}
                  onChange={(e) => setEditing({ ...editing, placeId: e.target.value || undefined })}
                >
                  <option value="">選択なし</option>
                  {data.places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            <Note>
              {payTypeOf(editing) === 'perClass'
                ? '深夜の割増はこの体系では計算していません。深夜まで及ぶ勤務があるなら教えてください。'
                : '休憩は勤務時間から引いたうえで、まず通常帯から差し引いて計算します。'}
            </Note>
          </>
        ) : null}
      </Sheet>
    </div>
  )
}
