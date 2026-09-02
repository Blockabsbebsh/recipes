import { supabase } from '../lib/supabase'
import { DISH_TAG_PREFIX } from '../lib/categories'
import type { Household, HouseholdTag, Recipe } from '../lib/types'

/**
 * The groups the library is divided into. Deleting one has to find somewhere
 * for its recipes to go, because a recipe with no category disappears from
 * the library rather than becoming untidy.
 */
export function useRecipeCategories({ household, recipes, tags, reload, onError, onMessage }: {
  household: Household | null
  recipes: Recipe[]
  tags: HouseholdTag[]
  reload: () => Promise<void>
  onError: (message: string) => void
  onMessage: (message: string) => void
}) {
async function createRecipeCategory(name: string) {
  if (!household) return false
  const cleaned = name.replace(DISH_TAG_PREFIX, '').trim()
  if (!cleaned) return false
  const { error: createError } = await supabase.from('tags').insert({ household_id: household.id, name: `${DISH_TAG_PREFIX}${cleaned}` })
  if (createError) {
    onError(createError.code === '23505' ? 'Tokia kategorija jau yra.' : createError.message)
    return false
  }
  await reload()
  onMessage('Kategorija pridėta')
  return true
}

async function updateRecipeCategory(category: HouseholdTag, name: string) {
  const cleaned = name.replace(DISH_TAG_PREFIX, '').trim()
  if (!cleaned) return false
  const { error: updateError } = await supabase
    .from('tags')
    .update({ name: `${DISH_TAG_PREFIX}${cleaned}` })
    .eq('id', category.id)
  if (updateError) {
    onError(updateError.code === '23505' ? 'Tokia kategorija jau yra.' : updateError.message)
    return false
  }
  await reload()
  onMessage('Kategorija atnaujinta')
  return true
}

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

  return { createRecipeCategory, updateRecipeCategory, deleteRecipeCategory }
}
