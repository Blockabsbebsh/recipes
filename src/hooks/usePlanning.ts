import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Household, QueueEntry, Recipe, RosterEntry } from '../lib/types'

/**
 * The week itself: what is planned, what is bought, what got cooked.
 *
 * Two of these answer before the database does, because a tick and a removal
 * have to feel immediate; the rest wait for the round trip. Marking a meal
 * cooked is undoable for five seconds, which is the whole reason it does not
 * ask first.
 */
export function usePlanning({ household, userId, queue, reload, onError, onMessage, setBusy, setRoster, setQueue, showMenu }: {
  household: Household | null
  userId: string | null
  queue: QueueEntry[]
  reload: () => Promise<void>
  onError: (message: string | null) => void
  onMessage: (message: string) => void
  setBusy: (busy: boolean) => void
  setRoster: (update: (current: RosterEntry[]) => RosterEntry[]) => void
  setQueue: (update: (current: QueueEntry[]) => QueueEntry[]) => void
  showMenu: () => void
}) {
  const [undo, setUndo] = useState<{ entryId: string; label: string } | null>(null)
  const undoTimer = useRef<number | null>(null)

async function planRecipe(recipe: Recipe, destination: 'queue' | 'roster') {
  if (!household || !userId) return
  onError(null)
  const result = destination === 'queue'
    ? await supabase.from('shopping_queue').insert({ household_id: household.id, recipe_id: recipe.id, added_by: userId })
    : await supabase.from('roster_entries').insert({ household_id: household.id, recipe_id: recipe.id, added_by: userId })
  if (result.error?.code === '23505') onMessage(destination === 'queue' ? 'Šis receptas jau yra krepšelyje' : 'Šis receptas jau yra meniu')
  else if (result.error) onError(result.error.message)
  else onMessage(destination === 'queue' ? 'Pridėta į krepšelį' : 'Pridėta į meniu')
  await reload()
}

async function resolveEntry(entry: RosterEntry, status: 'cooked' | 'skipped') {
  if (!userId) return
  const { error: updateError } = await supabase
    .from('roster_entries')
    .update({ status, resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq('id', entry.id)
  if (updateError) {
    onError(updateError.message)
    return
  }
  setRoster((current) => current.map((item) => item.id === entry.id ? { ...item, status, resolved_at: new Date().toISOString() } : item))
  if (undoTimer.current) window.clearTimeout(undoTimer.current)
  setUndo({ entryId: entry.id, label: status === 'cooked' ? 'Pažymėta kaip pagaminta' : 'Praleista' })
  undoTimer.current = window.setTimeout(() => setUndo(null), 5_000)
}

async function undoResolution() {
  if (!undo) return
  const { error: undoError } = await supabase
    .from('roster_entries')
    .update({ status: 'ready', resolved_at: null, resolved_by: null })
    .eq('id', undo.entryId)
  if (undoError) onError(undoError.message)
  else await reload()
  if (undoTimer.current) window.clearTimeout(undoTimer.current)
  setUndo(null)
}

async function removeFromQueue(entry: QueueEntry) {
  const { error: removeError } = await supabase.from('shopping_queue').delete().eq('id', entry.id)
  if (removeError) onError(removeError.message)
  else setQueue((current) => current.filter((item) => item.id !== entry.id))
}

async function completeShopping() {
  if (!household || queue.length === 0) return
  if (!window.confirm(`Perkelti suplanuotus receptus (${queue.length}) į „Meniu“ ir išvalyti krepšelį?`)) return
  setBusy(true)
  const { data, error: completeError } = await supabase.rpc('complete_shopping', { p_household_id: household.id })
  if (completeError) onError(completeError.message)
  else {
    onMessage(`Apsipirkta — gaminimui paruoštų receptų: ${data}`)
    showMenu()
    await reload()
  }
  setBusy(false)
}

  return { undo, planRecipe, resolveEntry, undoResolution, removeFromQueue, completeShopping }
}
