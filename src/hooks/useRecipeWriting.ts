import { useConfirmation } from '../components/Confirmation'
import { supabase } from '../lib/supabase'
import { ingredientLookupKey, ingredientNameWithoutQuantity } from '../lib/parser'
import { classificationTags, classifyRecipe } from '../lib/categories'
import type { Household, Recipe, RecipeDestination, RecipeDraft } from '../lib/types'

/**
 * Recipe writes are database procedures: the recipe, its ingredients, its
 * classification and optional basket row either all commit or all roll back.
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
  const confirm = useConfirmation()

  const cleanIngredients = (items: string[]) => [...new Map(
    items
      .map((item) => ingredientNameWithoutQuantity(item))
      .filter(Boolean)
      .map((item) => [ingredientLookupKey(item), item]),
  ).values()]

  async function saveRecipe(draft: RecipeDraft, existing?: Recipe, destination: RecipeDestination = 'library'): Promise<boolean> {
    if (!household || !userId) return false
    setBusy(true)
    onError(null)
    try {
      const { error } = await supabase.rpc('save_recipe', {
        p_household_id: household.id,
        p_recipe_id: existing?.id ?? null,
        p_expected_updated_at: existing?.updated_at ?? null,
        p_title: draft.title.trim(),
        p_notes: draft.notes.trim() || null,
        p_source_url: draft.sourceUrl.trim() || null,
        p_ingredient_names: cleanIngredients(draft.ingredients),
        p_tag_names: classificationTags(draft),
        p_add_to_queue: !existing && destination === 'queue',
      })
      if (error) {
        onError(error.code === '40001'
          ? 'Šį receptą ką tik pakeitė kitas įrenginys. Atnaujinkite ir pabandykite dar kartą.'
          : error.message)
        return false
      }
      dismissEditor()
      onMessage(existing ? 'Receptas atnaujintas' : destination === 'queue' ? 'Pridėta į krepšelį' : 'Receptas išsaugotas')
      await reload()
      return true
    } finally {
      setBusy(false)
    }
  }

  async function saveImported(drafts: RecipeDraft[]): Promise<boolean> {
    if (!household || !userId || !drafts.length) return false
    setBusy(true)
    onError(null)
    const fallbackCategory = recipeCategories.includes('Kita') ? 'Kita' : recipeCategories[0] || 'Kita'
    const prepared = drafts.map((draft) => {
      const detected = classifyRecipe(draft.title, draft.ingredients)
      return {
        title: draft.title.trim(),
        notes: draft.notes.trim() || null,
        source_url: draft.sourceUrl.trim() || null,
        ingredients: cleanIngredients(draft.ingredients),
        tags: classificationTags({
          ...draft,
          dishType: recipeCategories.includes(draft.dishType ?? '') ? draft.dishType
            : recipeCategories.includes(detected.dishType) ? detected.dishType : fallbackCategory,
          cuisine: draft.cuisine || detected.cuisine,
        }),
      }
    })
    try {
      const { error } = await supabase.rpc('save_recipes_import', {
        p_household_id: household.id,
        p_recipes: prepared,
      })
      if (error) {
        onError(error.message)
        return false
      }
      dismissImporter()
      onMessage(`Importuota receptų: ${prepared.length}`)
      await reload()
      return true
    } finally {
      setBusy(false)
    }
  }

  async function softDelete(recipe: Recipe) {
    if (!userId || !await confirm(`Perkelti „${recipe.title}“ į ištrintus?`)) return false
    const { error: deleteError } = await supabase
      .from('recipes')
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
      .eq('id', recipe.id)
    if (deleteError) {
      onError(deleteError.message)
      return false
    }
    const { error: queueError } = await supabase.from('shopping_queue').delete().eq('recipe_id', recipe.id)
    if (queueError) onError(queueError.message)
    onMessage('Receptas perkeltas į ištrintus')
    await reload()
    return true
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
