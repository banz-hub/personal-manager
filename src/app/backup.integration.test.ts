/**
 * まとめての書き出し・読み込みを、置き場 (IndexedDB) まで通して確かめる。
 *
 * `backup.test.ts` は並べ方だけを見ている。こちらは
 * 「書き出して、消して、読み込んだら戻るか」を実際のデータで見る。
 * ここが壊れると入力したものが消えるので、作りものではなく本物の置き場を通す。
 */

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { exportAll, importAll } from './backup'
import { kintore } from '../features/kintore'
import { repository as kintoreRepo } from '../features/kintore/lib/storage'
import { shirei } from '../features/shirei'
import { repository as shireiRepo } from '../features/shirei/lib/storage'
import { yotei } from '../features/yotei'
import { repository as yoteiRepo } from '../features/yotei/lib/storage'
import type { Task } from '../features/shirei/types'
import type { EventItem, TrainRun } from '../features/yotei/types'
import type { WorkoutSession } from '../features/kintore/types'

const FEATURES = [shirei, yotei, kintore]

const task: Task = {
  id: 't1',
  title: '複素解析のレポート',
  area: 'math',
  status: 'todo',
  importance: 3,
  estimateMin: 90,
  createdAt: '2026-09-08T00:00:00.000Z',
}

const run = {
  id: 'r1',
  line: '常磐線 上り',
  serviceDays: 'all',
  stops: [
    { station: '柏', time: '08:00' },
    { station: '北千住', time: '08:25' },
  ],
} as TrainRun

const event = { id: 'e1', date: '2026-09-08', title: '手で入れた予定' } as EventItem

const session: WorkoutSession = {
  id: 's1',
  date: '2026-09-06',
  startedAt: '2026-09-06T19:00:00.000Z',
  finishedAt: '2026-09-06T19:45:00.000Z',
  targetMuscles: [],
  exercises: [],
  cardioMinutes: 0,
  note: '',
}

async function seed() {
  await shireiRepo.save('tasks', [task])
  await yoteiRepo.save('runs', [run])
  await yoteiRepo.save('events', [event])
  await kintoreRepo.saveSessions([session])
  await kintoreRepo.saveWeights([{ date: '2026-09-06', weightKg: 70 }])
}

async function wipe() {
  await shireiRepo.clearAll()
  await yoteiRepo.clearAll()
  await kintoreRepo.clearAll()
}

describe('置き場を通した往復', () => {
  beforeEach(async () => {
    await wipe()
    await seed()
  })

  it('3 つとも書き出される', async () => {
    const file = await exportAll(FEATURES)
    expect(Object.keys(file.parts).sort()).toEqual(['kintore', 'shirei', 'yotei'])
  })

  it('消してから読み込むと元に戻る', async () => {
    const file = await exportAll(FEATURES)
    await wipe()

    // 消えていることを確かめてから読み込む
    expect((await shireiRepo.loadAll()).tasks).toEqual([])
    expect((await yoteiRepo.loadAll()).runs).toEqual([])
    expect(await kintoreRepo.loadSessions()).toEqual([])

    const report = await importAll(file, FEATURES)
    expect(report.failed).toEqual([])
    expect(report.missing).toEqual([])

    expect((await shireiRepo.loadAll()).tasks).toEqual([task])
    const back = await yoteiRepo.loadAll()
    expect(back.runs).toEqual([run])
    expect(back.events).toEqual([event])
    expect(await kintoreRepo.loadSessions()).toEqual([session])
    expect(await kintoreRepo.loadWeights()).toEqual([{ date: '2026-09-06', weightKg: 70 }])
  })

  it('**片方だけ入ったファイルは、もう片方を消さない**', async () => {
    const file = await exportAll(FEATURES)
    // 筋トレのぶんだけ抜き出したファイル
    const onlyKintore = { ...file, parts: { kintore: file.parts.kintore } }

    const report = await importAll(onlyKintore, FEATURES)
    expect(report.done).toEqual(['筋トレログ'])
    // 並び順は登録順なので、中身だけを見る
    expect(new Set(report.missing)).toEqual(new Set(['エージェント', 'よてい帳']))

    // 触られていない
    expect((await shireiRepo.loadAll()).tasks).toEqual([task])
    expect((await yoteiRepo.loadAll()).runs).toEqual([run])
  })

  it('よてい帳 1 つぶんのバックアップは、まとめて読み込みでは受け取らない', async () => {
    const single = { version: 1, app: 'yoteicho', runs: [], events: [] }
    await expect(importAll(single, FEATURES)).rejects.toThrow()
    // 何も消えていない
    expect((await yoteiRepo.loadAll()).runs).toEqual([run])
  })
})
