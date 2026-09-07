import type { EquipmentId } from '../types'

export interface EquipmentDef {
  id: EquipmentId
  name: string
  /** 重量を持つ機材か (所有重量の入力欄を出す) */
  hasWeights: boolean
  /** 常に利用可能とみなす機材 */
  alwaysAvailable?: boolean
}

export const EQUIPMENT: EquipmentDef[] = [
  { id: 'bodyweight', name: '自重のみ', hasWeights: false, alwaysAvailable: true },
  { id: 'dumbbell', name: 'ダンベル', hasWeights: true },
  { id: 'barbell', name: 'バーベル', hasWeights: true },
  { id: 'kettlebell', name: 'ケトルベル', hasWeights: true },
  { id: 'bench', name: 'ベンチ台', hasWeights: false },
  { id: 'pullup_bar', name: '懸垂バー', hasWeights: false },
  { id: 'band', name: 'トレーニングチューブ', hasWeights: false },
  { id: 'cable', name: 'ケーブルマシン', hasWeights: false },
  { id: 'machine', name: 'トレーニングマシン', hasWeights: false },
  { id: 'ab_wheel', name: 'アブローラー', hasWeights: false },
  { id: 'jump_rope', name: '縄跳び', hasWeights: false },
  { id: 'cardio_machine', name: '有酸素マシン (ランニングマシン/バイク)', hasWeights: false },
]

export const EQUIPMENT_MAP: Record<EquipmentId, EquipmentDef> = Object.fromEntries(
  EQUIPMENT.map((e) => [e.id, e]),
) as Record<EquipmentId, EquipmentDef>

export function equipmentName(id: EquipmentId): string {
  return EQUIPMENT_MAP[id]?.name ?? id
}
