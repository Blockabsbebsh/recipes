import { supabase } from '../lib/supabase'
import { ingredientLookupKey, ingredientNameWithoutQuantity } from '../lib/parser'
import { classificationTags, classifyRecipe, CUISINE_TAG_PREFIX, DISH_TAG_PREFIX } from '../lib/categories'
import type { Household, Recipe, RecipeDestination, RecipeDraft } from '../lib/types'

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
export function useRecipeWriting({ household, userId, recipeCategories, reload, onError, onMessage, setBusy, dismissEditor, dismissImporter }: {
  household: Household | null
  userId: string | null
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
 *
 * Taking every name an import needs at once matters: one read and one insert
 * for thirty recipes rather than sixty round trips over a phone connection.
 */
async function resolveIngredientMap(names: string[]): Promise<Map<string, string> | null> {
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
  return idByName
}

async function resolveIngredientIds(names: string[]): Promise<string[] | null> {
  const idByName = await resolveIngredientMap(names)
  if (!idByName) return null
  return [...new Set(names
    .map((name) => idByName.get(ingredientLookupKey(name)))
    .filter((id): id is string => Boolean(id)))]
}

/**
 * The ids of the tags named here, creating the ones the household has not
 * used yet. A duplicate is not a failure: two phones importing at once both
 * want the tag to exist, and it does either way.
 */
async function ensureTagIds(names: string[]): Promise<Map<string, string> | null> {
  if (!household) return null
  const key = (name: string) => name.toLocaleLowerCase('lt')
  const read = async () => {
    const { data, error: readError } = await supabase
      .from('tags')
      .select('id, name')
      .eq('household_id', household.id)
    if (readError) {
      onError(readError.message)
      return null
    }
    return new Map((data || []).map((tag) => [key(tag.name), tag.id as string]))
  }
  const found = await read()
  if (!found) return null
  let idByName = found
  const missing = [...new Set(names.filter((name) => !idByName.has(key(name))))]
  if (!missing.length) return idByName
  const { data: created, error: createError } = await supabase
    .from('tags')
    .insert(missing.map((name) => ({ household_id: household.id, name })))
    .select('id, name')
  if (createError && createError.code !== '23505') {
    onError(createError.message)
    return null
  }
  if (createError?.code === '23505') {
    const refreshed = await read()
    if (!refreshed) return null
    idByName = refreshed
  } else {
    ;(created || []).forEach((tag) => idByName.set(key(tag.name), tag.id as string))
  }
  return idByName
}

async function saveRecipeClassification(recipeId: string, draft: RecipeDraft) {
  if (!household) return
  const desiredNames = classificationTags(draft)
  const tagIdByName = await ensureTagIds(desiredNames)
  if (!tagIdByName) return
  const classificationIds = [...tagIdByName.entries()]
    .filter(([name]) => name.startsWith(DISH_TAG_PREFIX.toLocaleLowerCase('lt')) || name.startsWith(CUISINE_TAG_PREFIX.toLocaleLowerCase('lt')))
    .map(([, id]) => id)
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

/**
 * A whole pasted list, written in five round trips rather than six per recipe.
 *
 * Importing used to call `saveRecipe` in a loop, and each pass read the
 * vocabulary, read the tags, wrote its rows and then reloaded the entire
 * household before the next one started. Twenty recipes was a minute of a
 * dialog that would not close, and the preview behind it kept re-deciding
 * which recipes looked familiar — so as the first ones landed, the ones still
 * on screen started announcing that a similar recipe already existed. They
 * were describing themselves.
 *
 * So: the dialog closes first, because the answer is already known and there
 * is nothing left to decide in it; the ids are made here rather than read
 * back, which is what lets every recipe, every ingredient link and every tag
 * go in one statement each; and the household is reloaded once, at the end.
 */
async function saveImported(drafts: RecipeDraft[]) {
  if (!household || !userId || !drafts.length) return
  setBusy(true)
  onError(null)
  dismissImporter()
  const fallbackCategory = recipeCategories.includes('Kita') ? 'Kita' : recipeCategories[0] || 'Kita'
  const prepared = drafts.map((draft) => {
    const detected = classifyRecipe(draft.title, draft.ingredients)
    return {
      id: crypto.randomUUID(),
      title: draft.title.trim(),
      notes: draft.notes.trim() || null,
      sourceUrl: draft.sourceUrl.trim() || null,
      ingredients: [...new Map(
        draft.ingredients
          .map((item) => ingredientNameWithoutQuantity(item))
          .filter(Boolean)
          .map((item) => [ingredientLookupKey(item), item]),
      ).values()],
      // What was chosen in the preview, and only the classifier's guess where
      // nothing was. A type the household has since stopped keeping falls back
      // rather than creating itself again behind everyone's back.
      tags: classificationTags({
        ...draft,
        dishType: recipeCategories.includes(draft.dishType ?? '') ? draft.dishType
          : recipeCategories.includes(detected.dishType) ? detected.dishType : fallbackCategory,
        cuisine: draft.cuisine || detected.cuisine,
      }),
    }
  })

  const { error: recipeError } = await supabase.from('recipes').insert(prepared.map((recipe) => ({
    id: recipe.id,
    household_id: household.id,
    title: recipe.title,
    notes: recipe.notes,
    source_url: recipe.sourceUrl,
    created_by: userId,
  })))
  if (recipeError) {
    onError(recipeError.message)
    setBusy(false)
    return
  }

  const idByName = await resolveIngredientMap(prepared.flatMap((recipe) => recipe.ingredients))
  const links = idByName ? prepared.flatMap((recipe) => {
    const ids = [...new Set(recipe.ingredients
      .map((name) => idByName.get(ingredientLookupKey(name)))
      .filter((id): id is string => Boolean(id)))]
    return ids.map((ingredient_id, position) => ({
      household_id: household.id,
      recipe_id: recipe.id,
      ingredient_id,
      position,
    }))
  }) : []
  if (links.length) {
    const { error: linkError } = await supabase.from('recipe_ingredients').insert(links)
    if (linkError) onError(linkError.message)
  }

  const tagIdByName = await ensureTagIds([...new Set(prepared.flatMap((recipe) => recipe.tags))])
  if (tagIdByName) {
    const tagLinks = prepared.flatMap((recipe) => recipe.tags
      .map((name) => tagIdByName.get(name.toLocaleLowerCase('lt')))
      .filter((tag_id): tag_id is string => Boolean(tag_id))
      .map((tag_id) => ({ household_id: household.id, recipe_id: recipe.id, tag_id })))
    if (tagLinks.length) {
      const { error: tagLinkError } = await supabase.from('recipe_tags').insert(tagLinks)
      if (tagLinkError) onError(tagLinkError.message)
    }
  }

  onMessage(`Importuota receptų: ${prepared.length}`)
  await reload()
  setBusy(false)
}

async function softDelete(recipe: Recipe) {
  if (!userId || !window.confirm(`Perkelti „${recipe.title}“ į ištrintus?`)) return
  const { error: deleteError } = await supabase
    .from('recipes')
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq('id', recipe.id)
  if (deleteError) {
    onError(deleteError.message)
    return
  }
  // Take it out of the basket as well. Leaving it there shows a recipe that
  // cannot be cooked, and `complete_shopping` would drop it without saying so.
  const { error: queueError } = await supabase.from('shopping_queue').delete().eq('recipe_id', recipe.id)
  if (queueError) onError(queueError.message)
  onMessage('Receptas perkeltas į ištrintus')
  await reload()
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
