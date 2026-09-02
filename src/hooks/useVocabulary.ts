import { supabase } from '../lib/supabase'
import { ingredientNameWithoutQuantity } from '../lib/parser'
import { mappingFields } from '../lib/ingredientMapping'
import type { CategoryIndex } from '../lib/barboraMapping'
import type { Household, IngredientSection, Recipe, VocabularyIngredient } from '../lib/types'

/**
 * The household's own list of ingredients: the names they use, the aisle each
 * one lives in, and the Barbora category that follows from those two.
 *
 * Every write goes back to the database and then re-reads, rather than being
 * patched in locally, because the other person's phone has to see it too and
 * there is only one way for that to happen.
 */
export function useVocabulary({ household, recipes, categoryIndex, reload, onError, onMessage }: {
  household: Household | null
  recipes: Recipe[]
  categoryIndex: CategoryIndex
  reload: () => Promise<void>
  onError: (message: string) => void
  onMessage: (message: string) => void
}) {
async function createIngredient(name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) {
  if (!household) return false
  const cleaned = ingredientNameWithoutQuantity(name)
  if (!cleaned) return false
  const { error: createError } = await supabase.from('ingredients').insert({
    household_id: household.id,
    name: cleaned,
    section,
    barbora_direct_url: directUrl || null,
    ...mappingFields(cleaned, section, categoryIndex, manualPath),
  })
  if (createError) {
    onError(createError.code === '23505' ? 'Toks ingredientas jau yra.' : createError.message)
    return false
  }
  await reload()
  onMessage('Ingredientas pridėtas')
  return true
}

/**
 * `manualPath` is the household's own choice. Passing nothing re-runs the
 * mapper, which is how "restore the automatic choice" is expressed.
 */
async function updateIngredient(
  ingredient: VocabularyIngredient,
  name: string,
  section: IngredientSection,
  manualPath?: string | null,
  directUrl?: string | null,
) {
  const cleaned = ingredientNameWithoutQuantity(name)
  if (!cleaned) return false
  const { error: updateError } = await supabase
    .from('ingredients')
    .update({ name: cleaned, section, barbora_direct_url: directUrl || null, ...mappingFields(cleaned, section, categoryIndex, manualPath) })
    .eq('id', ingredient.id)
  if (updateError) {
    onError(updateError.code === '23505' ? 'Toks ingredientas jau yra.' : updateError.message)
    return false
  }
  await reload()
  onMessage('Ingredientas atnaujintas')
  return true
}

async function deleteIngredient(ingredient: VocabularyIngredient) {
  const uses = recipes.reduce(
    (count, recipe) => count + (recipe.recipe_ingredients.some((item) => item.ingredient_id === ingredient.id) ? 1 : 0),
    0,
  )
  const warning = uses
    ? `„${ingredient.name}“ naudojamas ${uses} receptuose. Pašalinti jį ir iš šių receptų?`
    : `Pašalinti ingredientą „${ingredient.name}“?`
  if (!window.confirm(warning)) return
  if (uses) {
    const { error: linkError } = await supabase.from('recipe_ingredients').delete().eq('ingredient_id', ingredient.id)
    if (linkError) {
      onError(linkError.message)
      return
    }
  }
  const { error: deleteError } = await supabase.from('ingredients').delete().eq('id', ingredient.id)
  if (deleteError) onError(deleteError.message)
  else {
    await reload()
    onMessage('Ingredientas pašalintas')
  }
}

  return { createIngredient, updateIngredient, deleteIngredient }
}
