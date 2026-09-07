import { useMemo, useState } from 'react'
import SubNav from '../components/SubNav'
import { Empty, Field, FieldRow, Note, Sheet } from '../components/ui'
import { allStations } from '../data/stations'
import { newId } from '../lib/id'
import { knownStations } from '../lib/routes'
import { SERVICE_OPTIONS } from '../lib/timetable'
import { useApp } from '../state/AppContext'
import { SERVICE_LABELS, type ServiceDays, type TimetableLine, type TrainRun } from '../types'

const SUB = [
  { to: '/yotei/travel', label: '出発を調べる' },
  { to: '/yotei/routes', label: '区間' },
  { to: '/yotei/bulk', label: 'まとめて登録' },
  { to: '/yotei/trains', label: '時刻表' },
  { to: '/yotei/passes', label: '定期券' },
]

/** 「通過・経由なし」を表す記号。全角ハイフンなど表記ゆれを吸収する */
const NO_STOP = /^[-‐‑–—―ー－ｰ・…]+$/

/** 「7:5」「0752」「7:52」「05:56（上野行）」などを 'HH:MM' にそろえる。読めなければ null */
export function normalizeTime(raw: string): string | null {
  // 「（上野行）」のような注記は落としてから読む
  const t = raw
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .trim()
  if (!t) return null
  const colon = t.match(/^(\d{1,2})[:：.．](\d{1,2})$/)
  if (colon) {
    const h = Number(colon[1])
    const m = Number(colon[2])
    if (h > 27 || m > 59) return null
    return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  const digits = t.match(/^(\d{3,4})$/)
  if (digits) {
    const v = digits[1].padStart(4, '0')
    const h = Number(v.slice(0, 2))
    const m = Number(v.slice(2))
    if (h > 27 || m > 59) return null
    return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  return null
}

/** セルの注記から種別と行き先を読み取る */
function readAnnotation(raw: string): { kind?: string; destination?: string; surcharge?: boolean } {
  const notes = [...raw.matchAll(/[（(]([^）)]*)[）)]/g)].map((m) => m[1].trim())
  const out: { kind?: string; destination?: string; surcharge?: boolean } = {}
  for (const note of notes) {
    if (!note) continue
    if (note.endsWith('行') || note.endsWith('行き')) {
      out.destination = note.replace(/行き?$/, '')
    } else {
      out.kind = note
      // 特急・ライナーは追加料金が要る
      if (/特急|ライナー|グリーン/.test(note)) out.surcharge = true
    }
  }
  return out
}

/**
 * 列車の時刻を登録する画面。
 *
 * 路線ごとに「どの駅を列にするか」を覚えておくので、常磐線と東武線のように
 * 扱う駅の違う路線を並行して持てる。本数の少ない路線だけ入れれば十分。
 */
export default function TrainsPage() {
  const { data, upsert, remove, replaceList } = useApp()
  const [lineId, setLineId] = useState<string>(data.timetableLines[0]?.id ?? '')
  const [serviceDays, setServiceDays] = useState<ServiceDays>('weekday')
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState('')
  const [editingLine, setEditingLine] = useState<TimetableLine | null>(null)
  const [stationText, setStationText] = useState('')

  const stationChoices = useMemo(
    () => knownStations(data.legs, [...allStations(), data.profile.homeStation]),
    [data.legs, data.profile.homeStation],
  )
  const line = data.timetableLines.find((l) => l.id === lineId) ?? data.timetableLines[0]
  const columns = line?.stations ?? []

  const runs = useMemo(
    () =>
      data.runs
        .filter((r) => r.line === line?.name && r.serviceDays === serviceDays)
        .sort((a, b) => (a.stops[0]?.time ?? '').localeCompare(b.stops[0]?.time ?? '')),
    [data.runs, line?.name, serviceDays],
  )

  const setCell = (run: TrainRun, station: string, value: string) => {
    const time = value.trim()
    const stops = run.stops.filter((s) => s.station !== station)
    if (time) stops.push({ station, time })
    // 列の並び順どおりに並べ直す（乗り継ぎの判定が停車順に依存するため）
    stops.sort((a, b) => columns.indexOf(a.station) - columns.indexOf(b.station))
    upsert('runs', { ...run, stops })
  }

  const openNewLine = () => {
    setEditingLine({ id: newId('tl'), name: '', stations: [] })
    setStationText('')
  }

  const openLine = (l: TimetableLine) => {
    setEditingLine(l)
    setStationText(l.stations.join(' '))
  }

  const saveLine = () => {
    if (!editingLine || !editingLine.name.trim()) return
    const stations = stationText
      .split(/[\s,、,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    upsert('timetableLines', { ...editingLine, stations })
    setLineId(editingLine.id)
    setEditingLine(null)
  }

  const importPaste = () => {
    if (!line) return
    const rows = pasteText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (rows.length === 0) {
      setPasteError('中身がありません。')
      return
    }
    const created: TrainRun[] = []
    for (const [i, row] of rows.entries()) {
      // 全角スペース・タブ・読点のどれで区切られていても読む
      const cells = row.split(/[\s　,、\t]+/).filter(Boolean)
      const stops: TrainRun['stops'] = []
      let meta: ReturnType<typeof readAnnotation> = {}
      for (const [k, cell] of cells.entries()) {
        if (k >= columns.length) break
        if (NO_STOP.test(cell)) continue
        Object.assign(meta, readAnnotation(cell))
        const time = normalizeTime(cell)
        if (!time) {
          setPasteError(`${i + 1}行目の「${cell}」が時刻として読めません。`)
          return
        }
        stops.push({ station: columns[k], time })
      }
      if (stops.length === 0) continue
      created.push({
        id: newId('rn'),
        line: line.name,
        serviceDays,
        stops,
        kind: meta.kind,
        destination: meta.destination,
        surcharge: meta.surcharge,
      })
    }
    if (created.length === 0) {
      setPasteError('読み取れた便がありません。')
      return
    }
    replaceList('runs', [...data.runs, ...created])
    setPasteText('')
    setPasteError('')
    setPasting(false)
  }

  const clearLine = () => {
    if (!line) return
    if (!confirm(`${SERVICE_LABELS[serviceDays]}の「${line.name}」の便をすべて消しますか？`)) return
    replaceList(
      'runs',
      data.runs.filter((r) => !(r.line === line.name && r.serviceDays === serviceDays)),
    )
  }

  return (
    <div className="page">
      <SubNav items={SUB} />
      <h1>時刻表</h1>
      <p className="muted small">
        本数の少ない路線だけ入れれば十分です。ここが埋まると、出発時刻の計算が
        「駅に着けばいい時刻」から <strong>「何時何分の電車に乗るか」</strong> に変わります。
        山手線のように数分間隔で来る路線は入れる必要がありません。
      </p>

      {data.timetableLines.length === 0 ? (
        <Empty>
          まず路線を作ってください。路線ごとに「どの駅の時刻を入れるか」を決めます。
          常磐線と東武線のように、扱う駅の違う路線をいくつでも並べられます。
        </Empty>
      ) : null}

      <div className="card">
        <FieldRow>
          <Field label="路線">
            <select value={line?.id ?? ''} onChange={(e) => setLineId(e.target.value)}>
              {data.timetableLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="走る日">
            <select
              value={serviceDays}
              onChange={(e) => setServiceDays(e.target.value as ServiceDays)}
            >
              {SERVICE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </FieldRow>

        {line ? <p className="muted small">列: {line.stations.join(' → ') || '未設定'}</p> : null}

        <div className="btn-row">
          <button type="button" className="btn" onClick={() => setPasting(true)} disabled={!line}>
            まとめて貼り付け
          </button>
          <button type="button" className="btn ghost" onClick={openNewLine}>
            路線を追加
          </button>
          {line ? (
            <button type="button" className="btn ghost" onClick={() => openLine(line)}>
              この路線の駅を編集
            </button>
          ) : null}
          {line ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                upsert('runs', { id: newId('rn'), line: line.name, serviceDays, stops: [] })
              }
            >
              1本ずつ追加
            </button>
          ) : null}
        </div>
      </div>

      {line && runs.length === 0 ? (
        <Empty>
          {SERVICE_LABELS[serviceDays]}の「{line.name}」はまだ登録がありません。
          「まとめて貼り付け」が早いです。
        </Empty>
      ) : null}

      {line && runs.length > 0 ? (
        <>
          <div className="timetable-scroll">
            <table className="runs">
              <thead>
                <tr>
                  <th>種別</th>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <th scope="row">
                      {run.kind ?? '－'}
                      {run.destination ? <span className="pill">{run.destination}行</span> : null}
                      {run.surcharge ? <span className="pill">要料金</span> : null}
                    </th>
                    {columns.map((station) => {
                      const stop = run.stops.find((s) => s.station === station)
                      return (
                        <td key={station}>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="－"
                            value={stop?.time ?? ''}
                            onChange={(e) => setCell(run, station, e.target.value)}
                            onBlur={(e) => {
                              const t = normalizeTime(e.target.value)
                              if (t) setCell(run, station, t)
                            }}
                          />
                        </td>
                      )
                    })}
                    <td>
                      <button
                        type="button"
                        className="btn ghost sm danger"
                        onClick={() => remove('runs', run.id)}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="btn-row">
            <span className="muted small">
              {SERVICE_LABELS[serviceDays]}の「{line.name}」に {runs.length} 本
            </span>
            <button type="button" className="btn ghost sm danger" onClick={clearLine}>
              この路線・この曜日ぶんを全部消す
            </button>
          </div>
        </>
      ) : null}

      <Sheet
        open={pasting}
        title="まとめて貼り付け"
        onClose={() => setPasting(false)}
        footer={
          <button type="button" className="btn primary" onClick={importPaste}>
            取り込む
          </button>
        }
      >
        <p className="muted small">
          1行に1本ぶんの時刻を、スペースかタブで区切って書いてください。並び順は下の駅の順です。
          停まらない駅は <code>－</code> と書きます。
          <code>05:56（上野行）</code> のように注記が付いていても読み取ります。
        </p>
        <p className="muted small">
          <strong>{columns.join(' → ') || '先に路線の駅を決めてください'}</strong>
        </p>
        <Field label="時刻" wide hint="7:52 でも 752 でも読み取れます">
          <textarea
            rows={8}
            value={pasteText}
            placeholder={'05:31\t05:57\t06:23\t06:27\t06:34\t06:43\n05:56（上野行）\t06:23\t06:50\t06:54\t－\t－'}
            onChange={(e) => {
              setPasteText(e.target.value)
              setPasteError('')
            }}
          />
        </Field>
        {pasteError ? <Note tone="warn">{pasteError}</Note> : null}
        <Note>
          いま選んでいるのは <strong>{SERVICE_LABELS[serviceDays]}</strong> の「{line?.name}」です。
          違っていたら閉じて切り替えてください。同じ内容を二度取り込むと重複します。
        </Note>
      </Sheet>

      <Sheet
        open={editingLine !== null}
        title="路線"
        onClose={() => setEditingLine(null)}
        footer={
          <>
            {editingLine && data.timetableLines.some((l) => l.id === editingLine.id) ? (
              <button
                type="button"
                className="btn ghost danger"
                onClick={() => {
                  if (!editingLine) return
                  if (confirm(`「${editingLine.name}」を消しますか？便も一緒に消えます。`)) {
                    replaceList(
                      'runs',
                      data.runs.filter((r) => r.line !== editingLine.name),
                    )
                    remove('timetableLines', editingLine.id)
                    setEditingLine(null)
                  }
                }}
              >
                削除
              </button>
            ) : null}
            <button type="button" className="btn primary" onClick={saveLine}>
              保存
            </button>
          </>
        }
      >
        {editingLine ? (
          <>
            <Field label="路線と向き" wide hint="向きまで書くと分かりやすいです">
              <input
                type="text"
                value={editingLine.name}
                placeholder="例) 常磐線 上り（上野・品川方面）"
                onChange={(e) => setEditingLine({ ...editingLine, name: e.target.value })}
              />
            </Field>
            <Field
              label="時刻を入れる駅"
              wide
              hint="停車順に、スペース区切りで。全部の駅は要りません"
            >
              <textarea
                rows={2}
                value={stationText}
                placeholder="例) ひたち野うしく 柏 日暮里 上野 東京 品川"
                onChange={(e) => setStationText(e.target.value)}
              />
            </Field>
            <p className="muted small">
              使える駅名: {stationChoices.slice(0, 12).join(' / ')} …
            </p>
            <Note>
              ここで決めた駅の順が、貼り付けるときの列の順になります。あとから増やすこともできます。
            </Note>
          </>
        ) : null}
      </Sheet>
    </div>
  )
}
