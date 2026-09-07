/**
 * 書き出し・読み込みの唯一の場所。
 *
 * 取り込む前は 3 つのアプリがそれぞれ書き出しボタンを持っていて、
 * 「どれを押せばいいのか」が分からなかった。ここ 1 か所にまとめてある。
 *
 * 中身は `features.ts` から作る。機能に `backup` を書けば、ここに自動で並ぶ。
 */

import { useRef, useState } from 'react'
import { allBackupFilename, exportAll, importAll } from './backup'
import { FEATURES } from './features'
import type { Feature, FeatureBackup } from './types'

type WithBackup = Feature & { backup: FeatureBackup }

const PARTS = FEATURES.filter((f): f is WithBackup => f.backup != null)

function download(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 読み込んだあとは画面が古い中身を持ったままなので、読み直させる */
function reloadSoon() {
  setTimeout(() => window.location.reload(), 1200)
}

export default function BackupSection({ onExported }: { onExported?: () => void }) {
  const [message, setMessage] = useState('')
  const allRef = useRef<HTMLInputElement>(null)

  const exportEverything = async () => {
    download(await exportAll(), allBackupFilename())
    onExported?.()
    setMessage('3つまとめて書き出しました')
  }

  const importEverything = async (file: File) => {
    try {
      const report = await importAll(JSON.parse(await file.text()))
      const lines = [
        report.done.length > 0 ? `読み込んだ: ${report.done.join('・')}` : '',
        report.missing.length > 0 ? `入っていなかった: ${report.missing.join('・')}` : '',
        ...report.failed.map((x) => `${x.label}は読めませんでした (${x.reason})`),
      ].filter(Boolean)
      setMessage(lines.join(' / '))
      if (report.done.length > 0) reloadSoon()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '読み込めませんでした')
    }
  }

  return (
    <>
      <section className="bucket">
        <h2 className="section">データの引っ越し</h2>
        <div className="row">
          <button
            type="button"
            className="btn primary grow"
            onClick={() => void exportEverything()}
          >
            3つまとめて書き出す
          </button>
          <label className="btn grow" style={{ textAlign: 'center', cursor: 'pointer' }}>
            まとめて読み込む
            <input
              ref={allRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importEverything(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        {message && <p className="reason">{message}</p>}
        <p className="hint">
          エージェント・よてい帳・筋トレログが 1 つのファイルに入ります。新しい端末では
          <strong>これ 1 つを読み込めば済みます。</strong>
          読み込みはまるごと上書きですが、ファイルに入っていないぶんには触りません。
        </p>

        {/* ふだんは開かない。押すのはほぼ上の 2 つだけなので */}
        <details className="backup-one">
          <summary>1つずつ書き出す・読み込む</summary>
          <p className="hint">
            片方だけ入れ替えたいときに使います。ほかのぶんには触りません。
          </p>
          {PARTS.map((f) => (
            <OnePart key={f.id} feature={f} onDone={setMessage} />
          ))}
        </details>
      </section>
    </>
  )
}

function OnePart({ feature, onDone }: { feature: WithBackup; onDone: (m: string) => void }) {
  const run = async (file: File) => {
    try {
      await feature.backup.import(JSON.parse(await file.text()))
      onDone(`${feature.label}を読み込みました`)
      reloadSoon()
    } catch (e) {
      onDone(e instanceof Error ? e.message : '読み込めませんでした')
    }
  }

  return (
    <div className="row">
      <span className="grow">{feature.label}</span>
      <button
        type="button"
        className="btn sm"
        onClick={() => {
          void feature.backup.export().then((d) => {
            download(d, feature.backup.filename())
            onDone(`${feature.label}を書き出しました`)
          })
        }}
      >
        書き出す
      </button>
      <label className="btn sm" style={{ textAlign: 'center', cursor: 'pointer' }}>
        読み込む
        <input
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void run(f)
            e.target.value = ''
          }}
        />
      </label>
    </div>
  )
}
