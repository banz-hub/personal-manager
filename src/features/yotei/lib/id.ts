/** 重複しない ID。端末内でしか使わないので短くてよい */
export function newId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}${Date.now().toString(36)}${rand}`
}
