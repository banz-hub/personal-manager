import { useEffect, useRef, useState } from 'react'

interface Props {
  /** 休憩終了時刻 (epoch ms) */
  endsAt: number
  totalSec: number
  onExtend: (sec: number) => void
  onStop: () => void
}

function beep() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.5)
    osc.onended = () => void ctx.close()
  } catch {
    // 音が鳴らせない環境では黙って諦める
  }
}

/** セット間の休憩タイマー。画面下部に固定表示する */
export default function RestTimer({ endsAt, totalSec, onExtend, onStop }: Props) {
  const [now, setNow] = useState(() => Date.now())
  const notified = useRef(false)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])

  // タイマーが変わったら通知済みフラグを戻す
  useEffect(() => {
    notified.current = false
  }, [endsAt])

  const remain = Math.max(0, Math.ceil((endsAt - now) / 1000))
  const finished = remain === 0

  useEffect(() => {
    if (!finished || notified.current) return
    notified.current = true
    beep()
    navigator.vibrate?.(300)
  }, [finished])

  const mm = String(Math.floor(remain / 60)).padStart(2, '0')
  const ss = String(remain % 60).padStart(2, '0')
  const ratio = totalSec > 0 ? remain / totalSec : 0

  return (
    <div className={`rest-timer${finished ? ' is-done' : ''}`} role="status" aria-live="polite">
      <span className="rest-progress" aria-hidden>
        <span className="rest-progress-fill" style={{ width: `${ratio * 100}%` }} />
      </span>
      <div className="rest-body">
        <span className="rest-label">{finished ? '休憩おわり' : '休憩中'}</span>
        <span className="rest-time">
          {mm}:{ss}
        </span>
        <button type="button" onClick={() => onExtend(30)}>
          +30秒
        </button>
        <button type="button" className="primary" onClick={onStop}>
          {finished ? '閉じる' : 'スキップ'}
        </button>
      </div>
    </div>
  )
}
