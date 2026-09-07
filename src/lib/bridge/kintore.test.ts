import { describe, expect, it } from 'vitest'
import { deriveKintoreDay, kintoreToday, sessionMinutes, streakEndingAt } from './kintore'

const TODAY = '2026-09-07'

function session(patch: {
  date: string
  startedAt?: string
  finishedAt?: string
  sets?: number
  cardioMinutes?: number
}) {
  const sets = patch.sets ?? 20
  return {
    id: `ws_${patch.date}`,
    date: patch.date,
    startedAt: patch.startedAt ?? `${patch.date}T10:00:00.000Z`,
    finishedAt: patch.finishedAt,
    exercises: [
      {
        exerciseId: 'db_squat',
        sets: Array.from({ length: sets }, () => ({ weightKg: 10, reps: 12, done: true })),
      },
    ],
    cardioMinutes: patch.cardioMinutes ?? 0,
  }
}

const PROFILE = { dailyMinutes: 60, daysPerWeek: 5, dayCutoffHour: 3 }

describe('1回ぶんの時間', () => {
  it('開始と終了から出す', () => {
    expect(
      sessionMinutes(
        session({
          date: TODAY,
          startedAt: '2026-09-07T06:08:00.000Z',
          finishedAt: '2026-09-07T07:03:00.000Z',
        }),
      ),
    ).toBe(55)
  })

  it('終了を押し忘れた記録は、セット数からの見積もりに切り替える', () => {
    // 実データにあった 936 分の記録。そのまま使うと平均が壊れる
    const s = session({
      date: '2026-09-05',
      startedAt: '2026-09-04T23:21:00.000Z',
      finishedAt: '2026-09-05T14:57:00.000Z',
      sets: 20,
    })
    // 20セット × 2.5分 + 準備10分 = 60分
    expect(sessionMinutes(s)).toBe(60)
  })

  it('終了が無い記録もセット数から見積もる', () => {
    expect(sessionMinutes(session({ date: TODAY, sets: 12 }))).toBe(40)
  })

  it('短すぎる記録も捨てる', () => {
    const s = session({
      date: TODAY,
      startedAt: '2026-09-07T10:00:00.000Z',
      finishedAt: '2026-09-07T10:01:00.000Z',
      sets: 20,
    })
    expect(sessionMinutes(s)).toBe(60)
  })

  it('有酸素の時間も足す', () => {
    expect(sessionMinutes(session({ date: TODAY, sets: 10, cardioMinutes: 20 }))).toBe(55)
  })
})

describe('1日の区切り', () => {
  it('区切りが3時なら、深夜2時は前日として数える', () => {
    expect(kintoreToday(new Date(2026, 8, 7, 2, 0), 3)).toBe('2026-09-06')
  })

  it('区切りを過ぎていればその日として数える', () => {
    expect(kintoreToday(new Date(2026, 8, 7, 6, 0), 3)).toBe('2026-09-07')
  })

  it('区切りが0なら日付そのまま', () => {
    expect(kintoreToday(new Date(2026, 8, 7, 2, 0), 0)).toBe('2026-09-07')
  })
})

describe('連続日数', () => {
  it('その日から遡って続いている日数を数える', () => {
    const dates = new Set(['2026-09-07', '2026-09-06', '2026-09-05', '2026-09-03'])
    expect(streakEndingAt(dates, '2026-09-07')).toBe(3)
  })

  it('その日にやっていなければ0', () => {
    expect(streakEndingAt(new Set(['2026-09-06']), '2026-09-07')).toBe(0)
  })
})

describe('今日やる日かの判断', () => {
  it('今日もう終えていれば、予定には入れない', () => {
    const d = deriveKintoreDay({
      profile: PROFILE,
      sessions: [session({ date: TODAY, startedAt: `${TODAY}T06:08:00.000Z`, finishedAt: `${TODAY}T07:03:00.000Z` })],
      today: TODAY,
    })
    expect(d.doneToday).toBe(true)
    expect(d.plannedToday).toBe(false)
    expect(d.todayMinutes).toBe(55)
    expect(d.planReason).toContain('もう終えています')
  })

  it('週の目標に届いていなければ、今日に置く', () => {
    const d = deriveKintoreDay({
      profile: PROFILE,
      sessions: [session({ date: '2026-09-05' })],
      today: TODAY,
    })
    expect(d.plannedToday).toBe(true)
    expect(d.planReason).toContain('週5回に届いていない')
  })

  it('週の目標に届いていれば、今日は空けてよいと言う', () => {
    const d = deriveKintoreDay({
      profile: PROFILE,
      sessions: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-05', '2026-09-06'].map((date) =>
        session({ date }),
      ),
      today: TODAY,
    })
    // 直近7日で5回。連続は 9/5・9/6 の2日だけなので、休養の判定には掛からない
    expect(d.last7Count).toBe(5)
    expect(d.streakDays).toBe(2)
    expect(d.plannedToday).toBe(false)
    expect(d.planReason).toContain('目標には届いている')
  })

  it('3日続けていたら休養を勧める', () => {
    const d = deriveKintoreDay({
      profile: PROFILE,
      sessions: ['2026-09-04', '2026-09-05', '2026-09-06'].map((date) => session({ date })),
      today: TODAY,
    })
    expect(d.streakDays).toBe(3)
    expect(d.restRecommended).toBe(true)
    expect(d.plannedToday).toBe(false)
    expect(d.planReason).toContain('休養')
  })

  it('記録がまったく無ければ、今日から始める前提にする', () => {
    const d = deriveKintoreDay({ profile: PROFILE, sessions: [], today: TODAY })
    expect(d.plannedToday).toBe(true)
    expect(d.restDays).toBeNull()
    expect(d.planReason).toContain('まだ記録がない')
  })
})

describe('司令塔が使う値', () => {
  it('見込み時間は、直近の実績の平均から出す', () => {
    const d = deriveKintoreDay({
      profile: PROFILE,
      sessions: [
        session({ date: '2026-09-06', startedAt: '2026-09-06T15:34:00.000Z', finishedAt: '2026-09-06T16:09:00.000Z' }),
        session({ date: '2026-09-04', startedAt: '2026-09-04T15:00:00.000Z', finishedAt: '2026-09-04T16:00:00.000Z' }),
      ],
      today: TODAY,
    })
    // 35分 と 60分 の平均 = 47.5 → 5分刻みで 50分
    expect(d.estimateMin).toBe(50)
  })

  it('記録が無ければ、プロフィールの1日の時間を使う', () => {
    expect(deriveKintoreDay({ profile: PROFILE, sessions: [], today: TODAY }).estimateMin).toBe(60)
  })

  it('壊れた記録は見込み時間に混ぜない', () => {
    const d = deriveKintoreDay({
      profile: PROFILE,
      sessions: [
        session({
          date: '2026-09-05',
          startedAt: '2026-09-04T23:21:00.000Z',
          finishedAt: '2026-09-05T14:57:00.000Z',
          sets: 20,
        }),
      ],
      today: TODAY,
    })
    // 936分ではなく、セット数からの60分が使われる
    expect(d.estimateMin).toBe(60)
  })

  it('最終実施日・空いた日数・昨日の実績を返す', () => {
    const d = deriveKintoreDay({
      profile: PROFILE,
      sessions: [
        session({ date: '2026-09-06', startedAt: '2026-09-06T15:00:00.000Z', finishedAt: '2026-09-06T16:00:00.000Z' }),
        session({ date: '2026-09-02' }),
      ],
      today: TODAY,
    })
    expect(d.lastWorkoutOn).toBe('2026-09-06')
    expect(d.restDays).toBe(1)
    expect(d.yesterdayMinutes).toBe(60)
  })
})

describe('1日の区切りによる日付のずれ', () => {
  it('どの日を「今日」として数えたかを必ず返す', () => {
    const d = deriveKintoreDay({ profile: PROFILE, sessions: [], today: '2026-09-07' })
    expect(d.forDate).toBe('2026-09-07')
  })

  it('深夜は前日ぶんとして数えるので、司令塔の今日と1日ずれる', () => {
    // 9/8 の 00:02。区切りが3時なので筋トレログの「今日」は 9/7
    const kToday = kintoreToday(new Date(2026, 8, 8, 0, 2), 3)
    expect(kToday).toBe('2026-09-07')

    const d = deriveKintoreDay({
      profile: PROFILE,
      sessions: [
        session({ date: '2026-09-07', startedAt: '2026-09-07T06:08:00.000Z', finishedAt: '2026-09-07T07:03:00.000Z' }),
      ],
      today: kToday,
    })
    // 「実施済み」だが、それは 9/7 のこと。画面はこの日付を出して区別する
    expect(d.doneToday).toBe(true)
    expect(d.forDate).toBe('2026-09-07')
  })
})
