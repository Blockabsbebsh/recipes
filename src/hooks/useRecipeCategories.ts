import { supabase } from '../lib/supabase'
import { CUISINE_TAG_PREFIX, DISH_TAG_PREFIX } from '../lib/categories'
import type { Household, HouseholdTag, Recipe } from '../lib/types'

/**
 * The two axes a recipe is filed under, both of them household vocabulary
 * rather than a list in the source: dish type, which the library groups by,
 * and cuisine, which is a tag on the tile.
 *
 * Only the dish type has to find somewhere for its recipes to go when one is
 * removed, because a recipe with no dish type disappears from the library
 * rather than becoming untidy. A recipe with no cuisine still shows one — the
 * classifier's guess — so removing a cuisine takes its tag with it and nothing
 * is lost.
 */
export function useRecipeCategories({ household, recipes, tags, reload, onError, onMessage }: {
  household: Household | null
  recipes: Recipe[]
  tags: HouseholdTag[]
  reload: () => Promise<void>
  onError: (message: string) => void
  onMessage: (message: string) => void
}) {
const MAX_LABEL = 40

async function createTagged(prefix: string, name: string, kind: string) {
  if (!household) return false
  const cleaned = name.replace(prefix, '').trim()
  if (!cleaned) return false
  if (cleaned.length + prefix.length > MAX_LABEL) {
    onError(`Pavadinimas per ilgas (iki ${MAX_LABEL - prefix.length} simbolių).`)
    return false
  }
  // The other person may have added the same name a second ago, and the
  // household already having it is the outcome asked for either way.
  const existing = tags.find((tag) => tag.name.toLocaleLowerCase('lt') === `${prefix}${cleaned}`.toLocaleLowerCase('lt'))
  if (existing) return true
  const { error: createError } = await supabase.from('tags').insert({ household_id: household.id, name: `${prefix}${cleaned}` })
  if (createError) {
    onError(createError.code === '23505' ? `Toks ${kind} jau yra.` : createError.message)
    return false
  }
  await reload()
  onMessage(kind === 'virtuvė' ? 'Virtuvė pridėta' : 'Kategorija pridėta')
  return true
}

async function renameTagged(prefix: string, category: HouseholdTag, name: string, kind: string) {
  const cleaned = name.replace(prefix, '').trim()
  if (!cleaned) return false
  if (cleaned.length + prefix.length > MAX_LABEL) {
    onError(`Pavadinimas per ilgas (iki ${MAX_LABEL - prefix.length} simbolių).`)
    return false
  }
  const { error: updateError } = await supabase
    .from('tags')
    .update({ name: `${prefix}${cleaned}` })
    .eq('id', category.id)
  if (updateError) {
    onError(updateError.code === '23505' ? `Toks ${kind} jau yra.` : updateError.message)
    return false
  }
  await reload()
  onMessage(kind === 'virtuvė' ? 'Virtuvė atnaujinta' : 'Kategorija atnaujinta')
  return true
}

const createRecipeCategory = (name: string) => createTagged(DISH_TAG_PREFIX, name, 'kategorija')
const updateRecipeCategory = (category: HouseholdTag, name: string) => renameTagged(DISH_TAG_PREFIX, category, name, 'kategorija')
const createCuisine = (name: string) => createTagged(CUISINE_TAG_PREFIX, name, 'virtuvė')
const updateCuisine = (cuisine: HouseholdTag, name: string) => renameTagged(CUISINE_TAG_PREFIX, cuisine, name, 'virtuvė')

async function deleteRecipeCategory(category: HouseholdTag) {
  if (!household) return
  const affected = recipes.filter((recipe) => recipe.recipe_tags.some((link) => link.tag.id === category.id))
  const label = category.name.slice(DISH_TAG_PREFIX.length)
  const warning = affected.length
    ? `Kategorijoje „${label}“ yra ${affected.length} receptai. Perkelti juos į „Kita“ ir pašalinti kategoriją?`
    : `Pašalinti kategoriją „${label}“?`
  if (!window.confirm(warning)) return

  if (affected.length) {
    const fallbackName = `${DISH_TAG_PREFIX}${label === 'Kita' ? 'Be kategorijos' : 'Kita'}`
    let fallback = tags.find((tag) => tag.name.toLocaleLowerCase('lt') === fallbackName.toLocaleLowerCase('lt'))
    if (!fallback) {
      const { data, error: fallbackError } = await supabase
        .from('tags')
        .insert({ household_id: household.id, name: fallbackName })
        .select('id, household_id, name')
        .single()
      if (fallbackError) {
        onError(fallbackError.message)
        return
      }
      fallback = data as HouseholdTag
    }
    const { error: linkError } = await supabase.from('recipe_tags').upsert(
      affected.map((recipe) => ({ household_id: household.id, recipe_id: recipe.id, tag_id: fallback.id })),
      { onConflict: 'recipe_id,tag_id', ignoreDuplicates: true },
    )
    if (linkError) {
      onError(linkError.message)
      return
    }
  }

  const { error: deleteError } = await supabase.from('tags').delete().eq('id', category.id)
  if (deleteError) onError(deleteError.message)
  else {
    await reload()
    onMessage('Kategorija pašalinta')
  }
}

async function deleteCuisine(cuisine: HouseholdTag) {
  const affected = recipes.filter((recipe) => recipe.recipe_tags.some((link) => link.tag.id === cuisine.id))
  const label = cuisine.name.slice(CUISINE_TAG_PREFIX.length)
  const warning = affected.length
    ? `Virtuvė „${label}“ pažymėta ${affected.length} receptuose. Pašalinti ją iš jų?`
    : `Pašalinti virtuvę „${label}“?`
  if (!window.confirm(warning)) return
  // The link rows go with the tag: `recipe_tags` cascades on delete.
  const { error: deleteError } = await supabase.from('tags').delete().eq('id', cuisine.id)
  if (deleteError) onError(deleteError.message)
  else {
    await reload()
    onMessage('Virtuvė pašalinta')
  }
}

  return {
    createRecipeCategory, updateRecipeCategory, deleteRecipeCategory,
    createCuisine, updateCuisine, deleteCuisine,
  }
}
