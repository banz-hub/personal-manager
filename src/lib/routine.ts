/**
 * 朝と夜の決まった流れ (第 16 条・第 17 条)。
 *
 * ボタンを自分で探させない。時間帯に合わせて「次にこれを押す」を 1 つだけ出す。
 * 押すものが無いときは何も出さない。常に何か表示されていると、見なくなるため。
 *
 * データを失わないための催促もここに置く。iOS はしばらく開かないと
 * 保存したものを消すことがあるので、放っておくと全部消える。
 */

import type { DayPlan, Settings } from '../types'
import { daysBetween } from './date'
import { workBlocks } from './scheduler'

export type StepKind = 'plan' | 'work' | 'review' | 'carry' | 'backup' | 'none'

export interface RoutineStep {
  kind: StepKind
  title: string
  body: string
  /** ボタンの文言。押すものが無ければ無し */
  action?: string
}

export interface RoutineInput {
  /** 0 時からの分 */
  now: number
  today: string
  plan?: DayPlan
  /** 今日のレビューを保存済みか */
  reviewed: boolean
  /** 未完了で繰り越せるものがあるか */
  hasUndone: boolean
  settings: Settings
  /** タスクを 1 件でも持っているか */
  hasTasks: boolean
}

/** 何日書き出していなければ催促するか */
export const BACKUP_INTERVAL_DAYS = 30

/** 夜の振り返りを勧め始める時刻 */
const EVENING_FROM = 21 * 60

export function nextStep(input: RoutineInput): RoutineStep {
  const { now, plan, settings } = input

  if (!settings.showRoutine) return { kind: 'none', title: '', body: '' }

  // データを失うのがいちばん痛いので、まずこれを見る
  const backup = backupReminder(settings, input.today)
  if (backup) return backup

  if (!input.hasTasks) {
    return {
      kind: 'plan',
      title: 'まずタスクを 1 つ入れてください',
      body: '締切と所要時間があると、順位と予定が決まります。一文で書けば読み取ります。',
      action: 'タスクを追加',
    }
  }

  const blocks = plan ? workBlocks(plan) : []
  const done = blocks.filter((b) => b.doneAt).length
  const allDone = blocks.length > 0 && done === blocks.length

  // --- 朝 ---
  if (!plan) {
    return {
      kind: 'plan',
      title: '今日の予定を作りましょう',
      body: '空き時間を見て、優先順位の高いものから時間に落とします。詰め込みすぎないように上限をかけます。',
      action: '今日の予定を作る',
    }
  }

  // --- 夜 ---
  if (now >= EVENING_FROM || allDone) {
    if (!input.reviewed) {
      return {
        kind: 'review',
        title: 'ふりかえりの時間です',
        body: allDone
          ? `予定した${blocks.length}件をすべて終えました。記録しておくと、次の見積もりが良くなります。`
          : `${blocks.length}件のうち${done}件が完了。何がどれだけかかったかを残すと、明日の予定が現実に近づきます。`,
        action: 'ふりかえる',
      }
    }
    if (input.hasUndone) {
      return {
        kind: 'carry',
        title: '未完了を明日へ送りますか',
        body: '締切は動かしません。先送りした回数だけ数えて、明日の優先順位を上げます。',
        action: '繰り越す',
      }
    }
    return { kind: 'none', title: '', body: '' }
  }

  // --- 日中 ---
  if (blocks.length > 0 && done < blocks.length) {
    const next = blocks.find((b) => !b.doneAt)
    return {
      kind: 'work',
      title: next ? `次は ${next.start} から「${next.title}」` : '予定を進めましょう',
      body: `${blocks.length}件のうち${done}件が完了しています。`,
    }
  }

  return { kind: 'none', title: '', body: '' }
}

/** 書き出しの催促。まだ一度も書き出していなければ、少し待ってから言う */
function backupReminder(settings: Settings, today: string): RoutineStep | null {
  if (!settings.lastBackupOn) {
    // 使い始めてすぐに言うと邪魔なので、設定を触った日から数える
    const started = settings.updatedAt ? settings.updatedAt.slice(0, 10) : null
    if (!started || daysBetween(started, today) < BACKUP_INTERVAL_DAYS) return null
    return {
      kind: 'backup',
      title: 'データを書き出しておきませんか',
      body: 'まだ一度も書き出していません。データは端末の中にしかなく、iOS はしばらく開かないと消すことがあります。',
      action: '書き出す',
    }
  }

  const days = daysBetween(settings.lastBackupOn, today)
  if (days < BACKUP_INTERVAL_DAYS) return null

  return {
    kind: 'backup',
    title: `最後の書き出しから${days}日たっています`,
    body: 'データは端末の中にしかありません。書き出して private リポジトリに置いておくと安心です。',
    action: '書き出す',
  }
}

/** 期限切れの棚卸しが要るか。件数が多いほど強く勧める */
export function needsTriage(overdueCount: number): string | null {
  if (overdueCount === 0) return null
  if (overdueCount >= 5) {
    return `期限切れが${overdueCount}件たまっています。1件ずつ「やる・締切を直す・やめる」を決めないと、優先順位がずっと歪んだままになります。`
  }
  return `期限切れが${overdueCount}件あります。やるか、締切を直すか、やめるかを決めてください。`
}
