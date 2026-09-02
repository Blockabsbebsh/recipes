export const HOLD_MS: number
export const MOMENTUM_MS: number
export const STILL_MS: number
export const RESTORE_PATIENCE_MS: number

export type Movement = 'gesture' | 'coast' | 'system'

export type Gesture = {
  start(y: number): void
  end(now: number): boolean
  pointer(now: number): void
  scroll(y: number, now: number): Movement
  rest(): boolean
  cancel(): void
  readonly isCoasting: boolean
}

export function createGesture(options?: { momentumMs?: number }): Gesture
export function hasDrifted(input: { target: number; y: number; vp: number; tolerance?: number }): boolean
export function reaches(input: { scrollHeight: number; innerHeight: number; target: number }): boolean
export function keepable(y: number): number
