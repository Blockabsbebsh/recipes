export type RateVerdict = {
  allowed: boolean
  /** The hit list to keep for the next call. */
  hits: number[]
  /** Seconds until the window has room again; 0 when the request was admitted. */
  retryAfterSeconds: number
}

export function admit(hits: number[], now: number, limit: number, windowMs: number): RateVerdict
