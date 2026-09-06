export function ticksKey(householdId: string): string
export function readTicks(key: string, present: Iterable<string>, storage?: Storage): Set<string>
export function writeTicks(key: string, ticks: Iterable<string>, storage?: Storage): boolean
export function clearTicks(key: string, storage?: Storage): void
export function toggleTick(ticks: Set<string>, item: string): Set<string>
export function shoppingProgress(total: number, ticked: number): {
  total: number
  ticked: number
  left: number
  fraction: number
}
