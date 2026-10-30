import { useState, type ChangeEvent } from 'react'
import { formatDate, todayKey } from '../lib/date'
import { applyEvents, planImport, type ImportPlan } from '../lib/icsImport'
import { isZip, readIcsFromZip } from '../lib/zip'
import { useApp } from '../state/AppContext'
import { Field } from './ui'

/** ファイルを .ics の中身にする。Google の書き出しは zip で届く */
async function readFiles(files: File[]): Promise<string[]> {
  const out: string[] = []
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (isZip(bytes)) out.push(...(await readIcsFromZip(bytes)).map((f) => f.text))
    else out.push(new TextDecoder().decode(bytes))
  }
  return out
}

/**
 * Google カレンダーから予定を取り込む。
 *
 * **読んだだけでは保存しない。**何が増えて何が変わるかを見せてから、押したときに入れる。
 * 取り込みは予定を書き換えるので、中身を見ずに実行させないため。
 */
export default function GoogleImport() {
  const { data, replaceList } = useApp()
  const [from, setFrom] = useState(todayKey)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [message, setMessage] = useState('')

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    // 同じファイルを選び直しても動くように空にする
    e.target.value = ''
    if (files.length === 0) return
    setMessage('読んでいます…')
    setPlan(null)
    try {
      const text = await readFiles(files)
      if (!text.some((t) => t.includes('BEGIN:VCALENDAR'))) {
        setMessage('カレンダーのファイルではありませんでした。Google から書き出した .zip か .ics を選んでください')
        return
      }
      setPlan(
        planImport({
          text,
          from,
          events: data.events,
          trips: data.trips,
          jobs: data.jobs,
          places: data.places,
        }),
      )
      setMessage('')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'ファイルを読めませんでした')
    }
  }

  const commit = () => {
    if (!plan) return
    replaceList('events', applyEvents(data.events, plan))
    if (plan.trips.length > 0) replaceList('trips', [...data.trips, ...plan.trips])
    setMessage(
      `取り込みました（追加 ${plan.add.length + plan.trips.length}件 / 更新 ${plan.update.length}件）`,
    )
    setPlan(null)
  }

  const nothing = plan && plan.add.length + plan.update.length + plan.trips.length + plan.marked.length === 0

  return (
    <section className="bucket">
      <h2 className="section">Googleカレンダーから取り込む</h2>
      <p className="hint">
        パソコンで Google カレンダーを開き、「設定」→「インポート / エクスポート」→「エクスポート」で
        zip を保存して、ここで選んでください（解凍は要りません）。
        コマの名前（BCD）のバイトは、コマと給与の計算まで入ります。
      </p>
      <p className="hint">
        同じ予定は二重になりません。内容が違えば Google 側で上書きします。
        <strong>Google で消した予定は、ここでは消えません。</strong>
        色はファイルに入ってこないので、種類は題名と場所から判断します。
      </p>
      <Field label="この日から先を取り込む">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <input
        type="file"
        aria-label="Google カレンダーのファイルを選ぶ"
        accept=".zip,.ics,application/zip,text/calendar"
        multiple
        onChange={(e) => void onPick(e)}
      />
      {message && <p className="dim">{message}</p>}

      {plan && (
        <div className="card">
          <strong>
            追加 {plan.add.length + plan.trips.length}件 / 更新 {plan.update.length}件 / 同じ {plan.same}件
          </strong>
          <ul className="list">
            {plan.add.map((e) => (
              <li key={e.id} className="list-item">
                <span>
                  <span className="tag">追加</span> {formatDate(e.date, false)} {e.start} {e.title}
                </span>
              </li>
            ))}
            {plan.trips.map((t) => (
              <li key={t.id} className="list-item">
                <span>
                  <span className="tag">旅行</span> {formatDate(t.startDate, false)}〜
                  {formatDate(t.endDate, false)} {t.name}
                </span>
              </li>
            ))}
            {plan.update.map(({ before, after }) => (
              <li key={after.id} className="list-item">
                <span>
                  <span className="tag">更新</span> {formatDate(before.date, false)} {before.start}{' '}
                  {before.title} → {formatDate(after.date, false)} {after.start} {after.title}
                </span>
              </li>
            ))}
          </ul>
          {plan.skippedAllDay.length > 0 && (
            <p className="hint">
              <strong>入れないもの（1日だけの終日の予定）:</strong>{' '}
              {plan.skippedAllDay.map((o) => o.title).join('、')}。
              このアプリの予定には時刻が要るので、必要なら時刻を決めて足してください。
            </p>
          )}
          {plan.unreadable.length > 0 && (
            <p className="hint">
              <strong>繰り返しの決まりが読めず、入れなかったもの:</strong> {plan.unreadable.join('、')}
            </p>
          )}
          <div className="row">
            <button type="button" className="btn primary grow" disabled={nothing ?? false} onClick={commit}>
              取り込む
            </button>
            <button type="button" className="btn ghost grow" onClick={() => setPlan(null)}>
              やめる
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
