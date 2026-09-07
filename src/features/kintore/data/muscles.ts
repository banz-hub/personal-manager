import type { BodySide, MuscleId } from '../types'

export interface MuscleDef {
  id: MuscleId
  name: string
  /** 人体図のどちら側に表示するか */
  sides: BodySide[]
  /** 大筋群は週あたりのボリューム配分が大きい */
  large: boolean
}

export const MUSCLES: MuscleDef[] = [
  { id: 'chest', name: '胸', sides: ['front'], large: true },
  { id: 'shoulders', name: '肩', sides: ['front', 'back'], large: false },
  { id: 'biceps', name: '上腕二頭筋', sides: ['front'], large: false },
  { id: 'triceps', name: '上腕三頭筋', sides: ['back'], large: false },
  { id: 'forearms', name: '前腕', sides: ['front', 'back'], large: false },
  { id: 'abs', name: '腹直筋', sides: ['front'], large: false },
  { id: 'obliques', name: '腹斜筋', sides: ['front'], large: false },
  { id: 'traps', name: '僧帽筋', sides: ['front', 'back'], large: false },
  { id: 'lats', name: '広背筋', sides: ['back'], large: true },
  { id: 'lowerback', name: '脊柱起立筋', sides: ['back'], large: false },
  { id: 'glutes', name: '臀筋', sides: ['back'], large: true },
  { id: 'quads', name: '大腿四頭筋', sides: ['front'], large: true },
  { id: 'hamstrings', name: 'ハムストリング', sides: ['back'], large: true },
  { id: 'calves', name: 'ふくらはぎ', sides: ['front', 'back'], large: false },
]

export const MUSCLE_MAP: Record<MuscleId, MuscleDef> = Object.fromEntries(
  MUSCLES.map((m) => [m.id, m]),
) as Record<MuscleId, MuscleDef>

export function muscleName(id: MuscleId): string {
  return MUSCLE_MAP[id]?.name ?? id
}
