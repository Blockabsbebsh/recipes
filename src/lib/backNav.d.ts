export type BackNav = {
  add(key: string, undo: () => void): () => boolean
  drop(key: string): boolean
  onPop(): boolean
  readonly depth: number
}

export function createBackNav(browser: { pushEntry: () => void; goBack: () => void }): BackNav
export const backNav: BackNav
