export type TraceEntry = { at: string; kind: string } & Record<string, string | number | boolean>

export function readTrace(): TraceEntry[]
export function clearTrace(): void
export function trace(kind: string, detail?: Record<string, string | number | boolean | null | undefined>): void
export function formatTrace(entries?: TraceEntry[]): string
export function visualTop(): number
export function navigationKind(): string
