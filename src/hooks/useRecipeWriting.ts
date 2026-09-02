import { supabase } from '../lib/supabase'
import { ingredientLookupKey, ingredientNameWithoutQuantity, normalizeTitle } from '../lib/parser'
import { classificationTags, classifyRecipe, CUISINE_TAG_PREFIX, DISH_TAG_PREFIX } from '../lib/categories'
import type { Household, HouseholdTag, Recipe, RecipeDestination, RecipeDraft, VocabularyIngredient } from '../lib/types'

/**
 * Writing recipes down: saving one, importing a list of them, and moving them
 * in and out of the bin.
 *
 * Ingredient names are resolved to vocabulary ids against the database rather
 * than against what this page happens to be holding, because the other person
 * may have added something since it loaded. Anything they have not used before
 * is added to the vocabulary as it goes, so it is offered on every later
 * recipe.
 */
export function useRecipeWriting({ household, userId, vocabulary, recipes, tags, recipeCategories, reload, onError, onMessage, setBusy, dismissEditor, dismissImporter }: {
  household: Household | null
  userId: string | null
  vocabulary: VocabularyIngredient[]
  recipes: Recipe[]
  tags: HouseholdTag[]
  recipeCategories: string[]
  reload: () => Promise<void>
  onError: (message: string | null) => void
  onMessage: (message: string) => void
  setBusy: (busy: boolean) => void
  dismissEditor: () => void
  dismissImporter: () => void
}) {
async function saveRecipe(draft: RecipeDraft, existing?: Recipe, destination: RecipeDestination = 'library') {
  if (!household || !userId) return
  setBusy(true)
  onError(null)
  const cleanedIngredients = [...new Map(
    draft.ingredients
      .map((item) => ingredientNameWithoutQuantity(item))
      .filter(Boolean)
      .map((item) => [ingredientLookupKey(item), item]),
  ).values()]
  let recipeId = existing?.id
  if (existing) {
    const { error: updateError } = await supabase
      .from('recipes')
      .update({ title: draft.title.trim(), notes: draft.notes.trim() || null, source_url: draft.sourceUrl.trim() || null })
      .eq('id', existing.id)
    if (updateError) {
      onError(updateError.message)
      setBusy(false)
      return
    }
    const { error: deleteIngredientsError } = await supabase
      .from('recipe_ingredients')
      .delete()
      .eq('recipe_id', existing.id)
    if (deleteIngredientsError) {
      onError(deleteIngredientsError.message)
      setBusy(false)
      return
    }
  } else {
    const { data, error: insertError } = await supabase
      .from('recipes')
      .insert({
        household_id: household.id,
        title: draft.title.trim(),
        notes: draft.notes.trim() || null,
        source_url: draft.sourceUrl.trim() || null,
        created_by: userId,
      })
      .select('id')
      .single()
    if (insertError) {
      onError(insertError.message)
      setBusy(false)
      return
    }
    recipeId = data.id
  }

  if (cleanedIngredients.length) {
    const ingredientIds = await resolveIngredientIds(cleanedIngredients)
    if (ingredientIds) {
      const { error: ingredientError } = await supabase.from('recipe_ingredients').insert(
        ingredientIds.map((ingredient_id, position) => ({
          household_id: household.id,
          recipe_id: recipeId,
          ingredient_id,
          position,
        })),
      )
      if (ingredientError) onError(ingredientError.message)
    }
  }
  if (!existing && destination === 'queue' && recipeId) {
    await supabase.from('shopping_queue').insert({
      household_id: household.id,
      recipe_id: recipeId,
      added_by: userId,
    })
  }
  dismissEditor()
  if (recipeId) await saveRecipeClassification(recipeId, draft)
  onMessage(existing ? 'Receptas atnaujintas' : destination === 'queue' ? 'Pridėta į krepšelį' : 'Receptas išsaugotas')
  await reload()
  setBusy(false)
}

/**
 * Maps ingredient names onto vocabulary ids, adding any the household has
 * not used before so they are offered on every later recipe. Reads the
 * vocabulary fresh rather than trusting component state, since the other
 * person may have added something since this page loaded.
 */
async function resolveIngredientIds(names: string[]): Promise<string[] | null> {
  if (!household) return null
  const { data: existing, error: readError } = await supabase
    .from('ingredients')
    .select('id, name')
    .eq('household_id', household.id)
  if (readError) {
    onError(readError.message)
    return null
  }
  const idByName = new Map((existing || []).map((row) => [ingredientLookupKey(row.name), row.id as string]))
  const missing = [...new Map(
    names
      .map(ingredientNameWithoutQuantity)
      .filter((name) => name && !idByName.has(ingredientLookupKey(name)))
      .map((name) => [ingredientLookupKey(name), name]),
  ).values()]
  if (missing.length) {
    const { data: created, error: createError } = await supabase
      .from('ingredients')
      .insert(missing.map((name) => ({ household_id: household.id, name })))
      .select('id, name')
    if (createError) {
      onError(createError.message)
      return null
    }
    ;(created || []).forEach((row) => idByName.set(ingredientLookupKey(row.name), row.id as string))
  }
  return [...new Set(names
    .map((name) => idByName.get(ingredientLookupKey(name)))
    .filter((id): id is string => Boolean(id)))]
}

async function saveRecipeClassification(recipeId: string, draft: RecipeDraft) {
  if (!household) return
  const desiredNames = classificationTags(draft)
  const { data: currentTags, error: tagReadError } = await supabase
    .from('tags')
    .select('id, name')
    .eq('household_id', household.id)
  if (tagReadError) {
    onError(tagReadError.message)
    return
  }
  const tagIdByName = new Map((currentTags || []).map((tag) => [tag.name.toLocaleLowerCase('lt'), tag.id as string]))
  const missing = desiredNames.filter((name) => !tagIdByName.has(name.toLocaleLowerCase('lt')))
  if (missing.length) {
    const { data: created, error: createError } = await supabase
      .from('tags')
      .insert(missing.map((name) => ({ household_id: household.id, name })))
      .select('id, name')
    if (createError && createError.code !== '23505') {
      onError(createError.message)
      return
    }
    ;(created || []).forEach((tag) => tagIdByName.set(tag.name.toLocaleLowerCase('lt'), tag.id as string))
    if (createError?.code === '23505') {
      const { data: refreshed } = await supabase.from('tags').select('id, name').eq('household_id', household.id)
      ;(refreshed || []).forEach((tag) => tagIdByName.set(tag.name.toLocaleLowerCase('lt'), tag.id as string))
    }
  }
  const { data: classifications, error: classificationReadError } = await supabase
    .from('tags')
    .select('id, name')
    .eq('household_id', household.id)
  if (classificationReadError) {
    onError(classificationReadError.message)
    return
  }
  const classificationIds = (classifications || [])
    .filter((tag) => tag.name.startsWith(DISH_TAG_PREFIX) || tag.name.startsWith(CUISINE_TAG_PREFIX))
    .map((tag) => tag.id)
  if (classificationIds.length) {
    const { error: deleteError } = await supabase
      .from('recipe_tags')
      .delete()
      .eq('recipe_id', recipeId)
      .in('tag_id', classificationIds)
    if (deleteError) {
      onError(deleteError.message)
      return
    }
  }
  const desiredIds = desiredNames.map((name) => tagIdByName.get(name.toLocaleLowerCase('lt'))).filter((id): id is string => Boolean(id))
  if (desiredIds.length) {
    const { error: linkError } = await supabase.from('recipe_tags').insert(
      desiredIds.map((tag_id) => ({ household_id: household.id, recipe_id: recipeId, tag_id })),
    )
    if (linkError) onError(linkError.message)
  }
}

async function saveImported(drafts: RecipeDraft[]) {
  const fallbackCategory = recipeCategories.includes('Kita') ? 'Kita' : recipeCategories[0] || 'Kita'
  for (const draft of drafts) {
    const detected = classifyRecipe(draft.title, draft.ingredients)
    await saveRecipe({
      ...draft,
      dishType: recipeCategories.includes(detected.dishType) ? detected.dishType : fallbackCategory,
      cuisine: detected.cuisine,
    })
  }
  dismissImporter()
  onMessage(`Importuota receptų: ${drafts.length}`)
}
async function softDelete(recipe: Recipe) {
  if (!userId || !window.confirm(`Perkelti „${recipe.title}“ į ištrintus?`)) return
  const { error: deleteError } = await supabase
    .from('recipes')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', recipe.id)
  if (deleteError) onError(deleteError.message)
  else {
    onMessage('Receptas perkeltas į ištrintus')
    await reload()
  }
}

async function restoreRecipe(recipe: Recipe) {
  const { error: restoreError } = await supabase
    .from('recipes')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', recipe.id)
  if (restoreError) onError(restoreError.message)
  else {
    onMessage('Receptas atkurtas')
    await reload()
  }
}

  return { saveRecipe, saveImported, softDelete, restoreRecipe }
}
