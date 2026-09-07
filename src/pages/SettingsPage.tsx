import { useEffect, useState } from 'react'
import { Banner, Field } from '../components/ui'
import { loadYoteichoDay } from '../lib/bridge/yoteicho'
import { todayKey } from '../lib/date'
import { backupFilename, buildBackup, parseBackup } from '../lib/storage'
import { useApp } from '../state/AppContext'

export default function SettingsPage() {
  const { data, setSettings, replaceAll, reset } = useApp()
  const s = data.settings
  const [message, setMessage] = useState('')
  const [link, setLink] = useState<string | null>(null)

  useEffect(() => {
    if (!s.useYoteicho) {
      setLink('連携を切ってあります')
      return
    }
    let alive = true
    void loadYoteichoDay(todayKey(), {
      dayStart: s.dayStart,
      dayEnd: s.dayEnd,
      minSlotMin: s.minSlotMin,
      travelAllowanceMin: s.travelAllowanceMin,
    }).then((d) => {
      if (!alive) return
      setLink(
        d.available
          ? `つながっています（今日の予定 ${d.items.length}件、空き時間 ${d.slots.length}コマ）`
          : (d.reason ?? '読めませんでした'),
      )
    })
    return () => {
      alive = false
    }
  }, [s.useYoteicho, s.dayStart, s.dayEnd, s.minSlotMin, s.travelAllowanceMin])

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(buildBackup(data), null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = backupFilename()
    a.click()
    URL.revokeObjectURL(url)
  }

  const importJson = async (file: File) => {
    try {
      await replaceAll(parseBackup(JSON.parse(await file.text())))
      setMessage('読み込みました')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '読み込めませんでした')
    }
  }

  return (
    <div className="page">
      <strong>設定</strong>
      {message && <Banner>{message}</Banner>}

      <section className="bucket">
        <h2 className="section">1日の使い方</h2>
        <div className="grid2">
          <Field label="活動を始める時刻">
            <input
              type="time"
              value={s.dayStart}
              onChange={(e) => setSettings({ dayStart: e.target.value })}
            />
          </Field>
          <Field label="活動を終える時刻">
            <input
              type="time"
              value={s.dayEnd}
              onChange={(e) => setSettings({ dayEnd: e.target.value })}
            />
          </Field>
        </div>

        <Field label={`空き時間のうち作業に使う上限: ${Math.round(s.fillRatio * 100)}%`}>
          <input
            type="range"
            min={50}
            max={95}
            step={5}
            value={Math.round(s.fillRatio * 100)}
            onChange={(e) => setSettings({ fillRatio: Number(e.target.value) / 100 })}
          />
        </Field>
        <p className="hint">
          残りはバッファとして空けます。100%にはできません。予定どおりに進まない日を吸収する余地が無いと、
          1つ遅れただけで全部崩れるためです。
        </p>

        <div className="grid2">
          <Field label="休憩を挟むまでの作業(分)">
            <input
              type="number"
              min={20}
              step={10}
              value={s.workBeforeBreakMin}
              onChange={(e) => setSettings({ workBeforeBreakMin: Number(e.target.value) })}
            />
          </Field>
          <Field label="休憩の長さ(分)">
            <input
              type="number"
              min={5}
              step={5}
              value={s.breakMin}
              onChange={(e) => setSettings({ breakMin: Number(e.target.value) })}
            />
          </Field>
        </div>

        <div className="grid2">
          <Field label="使う空き時間の下限(分)">
            <input
              type="number"
              min={5}
              step={5}
              value={s.minSlotMin}
              onChange={(e) => setSettings({ minSlotMin: Number(e.target.value) })}
            />
          </Field>
          <Field label="移動に見込む時間(分)">
            <input
              type="number"
              min={0}
              step={5}
              value={s.travelAllowanceMin}
              onChange={(e) => setSettings({ travelAllowanceMin: Number(e.target.value) })}
            />
          </Field>
        </div>
        <p className="hint">
          移動時間は、場所が変わる予定の間から先に引きます。経路の計算はよてい帳の担当なので、
          こちらは粗い引き当てだけです。
        </p>
      </section>

      <section className="bucket">
        <h2 className="section">よてい帳との連携</h2>
        <label className="row tight">
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={s.useYoteicho}
            onChange={(e) => setSettings({ useYoteicho: e.target.checked })}
          />
          <span>よてい帳から今日の予定を読む</span>
        </label>
        {link && <Banner alert={!link.startsWith('つながって')}>{link}</Banner>}
        <p className="hint">
          読み取りだけで、よてい帳のデータには一切書き込みません。
          同じオリジン（banz-hub.github.io）で開いている必要があります。
        </p>
      </section>

      <section className="bucket">
        <h2 className="section">データ</h2>
        <div className="row">
          <button type="button" className="btn grow" onClick={exportJson}>
            書き出す
          </button>
          <label className="btn grow" style={{ textAlign: 'center', cursor: 'pointer' }}>
            読み込む
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importJson(f)
              }}
            />
          </label>
        </div>
        <p className="hint">
          データは端末のブラウザの中にしかありません。iOS は長く開かないと消すことがあるので、
          月に一度は書き出して private リポジトリに置いてください。
        </p>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            if (window.confirm('すべてのデータを消します。よろしいですか？')) {
              void reset().then(() => setMessage('消しました'))
            }
          }}
        >
          すべて消す
        </button>
      </section>

      <section className="bucket">
        <h2 className="section">保存している件数</h2>
        <p className="dim">
          タスク {data.tasks.length} / 予定表 {data.plans.length} / 実績ログ {data.logs.length} /
          レビュー {data.reviews.length}
        </p>
      </section>
    </div>
  )
}
