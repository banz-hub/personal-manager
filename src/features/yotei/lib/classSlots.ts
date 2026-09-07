/**
 * コマの選択から、シフトの時刻とコマ数を決める。
 *
 * 塾のシフトは「B と C を担当」のように、コマ単位で決まることが多い。
 * コマを選べば在校時間（授業の前後を含む）が自動で入るようにして、
 * 毎回 16:20 と 19:55 を打ち直さなくてよくする。
 */

import type { ClassSlot, Job } from '../types'
import { fromMinutes, toMinutes } from './date'
import { newId } from './id'

/** 授業の前後にどれだけ在校するか（未設定なら個別指導塾でよくある値） */
export function attendPadding(job: Job): { before: number; after: number } {
  return {
    before: job.attendBeforeMinutes ?? 10,
    after: job.attendAfterMinutes ?? 20,
  }
}

export interface SlotSelection {
  /** 選んだコマ（時刻順） */
  slots: ClassSlot[]
  /** 授業の開始・終了 */
  classStart: string
  classEnd: string
  /** 在校時間（授業の前後を含む） */
  start: string
  end: string
  /** 授業として拘束される時間 */
  classSpanMinutes: number
  /** 在校時間 */
  stayMinutes: number
}

/** 選んだコマから、在校時間とコマ数を割り出す。1つも選ばれていなければ null */
export function selectionFor(job: Job, slotIds: string[]): SlotSelection | null {
  const all = job.classSlots ?? []
  const slots = all
    .filter((s) => slotIds.includes(s.id))
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
  if (slots.length === 0) return null

  const classStartMin = toMinutes(slots[0].start)
  const classEndMin = Math.max(...slots.map((s) => toMinutes(s.end)))
  const { before, after } = attendPadding(job)

  return {
    slots,
    classStart: slots[0].start,
    classEnd: fromMinutes(classEndMin),
    start: fromMinutes(classStartMin - before),
    end: fromMinutes(classEndMin + after),
    classSpanMinutes: classEndMin - classStartMin,
    stayMinutes: classEndMin + after - (classStartMin - before),
  }
}

/** コマの並びから、次のコマを作るときの初期値（前のコマの終わりから5分後に90分） */
export function nextSlotDraft(slots: ClassSlot[]): ClassSlot {
  const last = [...slots].sort((a, b) => toMinutes(a.start) - toMinutes(b.start)).pop()
  const startMin = last ? toMinutes(last.end) + 5 : 9 * 60
  return {
    id: newId('cs'),
    label: '',
    start: fromMinutes(startMin),
    end: fromMinutes(startMin + 90),
  }
}

/**
 * 個別指導塾でよくあるコマ割りのひな型（利用者に確認済みの実例）。
 * 90分授業のあいだに5分の間隔が入る並びで、A(16:25終) と B(16:30始) がつながる。
 */
export const DEFAULT_CLASS_SLOTS: ClassSlot[] = [
  { id: 'slot-x', label: 'X', start: '09:00', end: '10:30' },
  { id: 'slot-y', label: 'Y', start: '10:35', end: '12:05' },
  { id: 'slot-a', label: 'A', start: '14:55', end: '16:25' },
  { id: 'slot-b', label: 'B', start: '16:30', end: '18:00' },
  { id: 'slot-c', label: 'C', start: '18:05', end: '19:35' },
  { id: 'slot-d', label: 'D', start: '19:40', end: '21:10' },
]
