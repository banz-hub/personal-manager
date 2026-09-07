/**
 * 3 つぶんをまとめて書き出す・読み込む。
 *
 * 端末を変えるときに 3 回書き出して 3 回読み込む、という手間をなくすためのもの。
 * 中身は機能ごとに分かれたまま入れてある。**混ぜない。**
 * 混ぜると、あとで片方だけ戻したいときに戻せなくなる。
 *
 * 対象は `features.ts` に登録されていて `backup` を持っている機能すべて。
 * 機能を足せば自動で入る。
 */

import { FEATURES } from './features'
import type { Feature } from './types'

export interface AllBackup {
  version: 1
  app: 'agent'
  exportedAt: string
  /** 機能ごとの中身。鍵は Feature の backup.key */
  parts: Record<string, unknown>
}

function withBackup(features: Feature[]): Array<Feature & { backup: NonNullable<Feature['backup']> }> {
  return features.filter(
    (f): f is Feature & { backup: NonNullable<Feature['backup']> } => f.backup != null,
  )
}

export async function exportAll(features: Feature[] = FEATURES): Promise<AllBackup> {
  const parts: Record<string, unknown> = {}
  for (const f of withBackup(features)) {
    parts[f.backup.key] = await f.backup.export()
  }
  return { version: 1, app: 'agent', exportedAt: new Date().toISOString(), parts }
}

export interface ImportReport {
  /** 読み込めたもの */
  done: string[]
  /** ファイルに入っていなかったもの。消さずにそのまま残す */
  missing: string[]
  /** 読み込めなかったもの */
  failed: Array<{ label: string; reason: string }>
}

/**
 * まとめて読み込む。
 *
 * **入っていないぶんは触らない。**「筋トレだけ入ったファイル」を読んだときに、
 * 予定と学習まで消えるのを防ぐため。
 * 途中で 1 つ失敗しても残りは続ける。全部止めるより、入るものは入れたほうがよい。
 */
export async function importAll(raw: unknown, features: Feature[] = FEATURES): Promise<ImportReport> {
  const data = raw as Partial<AllBackup> | null
  if (!data || data.app !== 'agent' || data.version !== 1 || typeof data.parts !== 'object') {
    throw new Error('まとめて書き出したファイルの形式ではありません')
  }

  const report: ImportReport = { done: [], missing: [], failed: [] }
  for (const f of withBackup(features)) {
    const part = (data.parts as Record<string, unknown>)[f.backup.key]
    if (part === undefined) {
      report.missing.push(f.label)
      continue
    }
    try {
      await f.backup.import(part)
      report.done.push(f.label)
    } catch (e) {
      report.failed.push({ label: f.label, reason: e instanceof Error ? e.message : '読み込めません' })
    }
  }
  return report
}

export function allBackupFilename(): string {
  const d = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `agent-all-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}.json`
}
