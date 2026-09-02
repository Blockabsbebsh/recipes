import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Household, HouseholdTag, QueueEntry, Recipe, RosterEntry, VocabularyIngredient } from '../lib/types'

/**
 * Everything one household has: its recipes, what is planned, what is on the
 * list, the ingredient vocabulary and the tags.
 *
 * It is read in one round trip rather than five sequential ones, and read
 * again — coalesced — whenever the other person in the household changes
 * anything, which is what makes two phones agree without either being told to
 * refresh. `ready` says the first read has landed; the scroll position waits
 * for it, because there is nothing to scroll until then.
 *
 * `setRoster` and `setQueue` are handed back for the two places that answer
 * before the round trip does: ticking a meal off and taking something out of
 * the basket both have to feel instant.
 */
export function useHouseholdData(household: Household | null, onError: (message: string) => void) {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [vocabulary, setVocabulary] = useState<VocabularyIngredient[]>([])
  const [tags, setTags] = useState<HouseholdTag[]>([])
  const [ready, setReady] = useState(false)

  const reload = useCallback(async () => {
    if (!household) return
    const [recipeResult, rosterResult, queueResult, vocabularyResult, tagResult] = await Promise.all([
      supabase
        .from('recipes')
        .select('*, recipe_ingredients(*), recipe_tags(tag:tags(id, name))')
        .eq('household_id', household.id)
        .order('updated_at', { ascending: false }),
      supabase
        .from('roster_entries')
        .select('*')
        .eq('household_id', household.id)
        .order('added_at', { ascending: false }),
      supabase
        .from('shopping_queue')
        .select('*')
        .eq('household_id', household.id)
        .order('added_at', { ascending: true }),
      supabase
        .from('ingredients')
        .select('*')
        .eq('household_id', household.id)
        .order('name', { ascending: true }),
      supabase
        .from('tags')
        .select('id, household_id, name')
        .eq('household_id', household.id)
        .order('name', { ascending: true }),
    ])
    const firstError = recipeResult.error || rosterResult.error || queueResult.error || vocabularyResult.error || tagResult.error
    if (firstError) {
      onError(firstError.message)
      return
    }
    const vocabularyRows = (vocabularyResult.data || []) as VocabularyIngredient[]
    const nameById = new Map(vocabularyRows.map((entry) => [entry.id, entry.name]))
    // recipe_ingredients still carries a denormalised `item`, but the vocabulary
    // is the source of truth for the name, so resolve through it here. That
    // leaves the column unread and free to be dropped.
    setRecipes(((recipeResult.data || []) as Recipe[]).map((recipe) => ({
      ...recipe,
      recipe_ingredients: recipe.recipe_ingredients.map((ingredient) => ({
        ...ingredient,
        item: nameById.get(ingredient.ingredient_id) ?? ingredient.item,
      })),
    })))
    setRoster((rosterResult.data || []) as RosterEntry[])
    setQueue((queueResult.data || []) as QueueEntry[])
    setVocabulary(vocabularyRows)
    setTags((tagResult.data || []) as HouseholdTag[])
    setReady(true)
  }, [household, onError])

  useEffect(() => {
    if (!household) return
    void reload()
    let timer: number | undefined
    const refreshSoon = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void reload(), 180)
    }
    const channel = supabase.channel(`household:${household.id}`)
    ;['recipes', 'recipe_ingredients', 'recipe_tags', 'tags', 'roster_entries', 'shopping_queue', 'ingredients'].forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `household_id=eq.${household.id}` },
        refreshSoon,
      )
    })
    channel.subscribe()
    return () => {
      window.clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [household, reload])


  useEffect(() => {
    setReady(false)
    if (household) return
    // Signed out, or between households: none of this belongs to anyone yet.
    setRecipes([])
    setRoster([])
    setQueue([])
    setVocabulary([])
    setTags([])
  }, [household?.id])

  return { recipes, roster, queue, vocabulary, tags, ready, reload, setRoster, setQueue }
}
