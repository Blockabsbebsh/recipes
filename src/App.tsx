import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { parseRecipeList, titleSimilarity } from './lib/parser'
import { classificationTags, classifyRecipe, CUISINES, cuisineFor, DISH_TAG_PREFIX, DISH_TYPES, dishTypeFor, CUISINE_TAG_PREFIX, recipeTagNames } from './lib/categories'
import type { Household, IngredientSection, QueueEntry, Recipe, RecipeDraft, RosterEntry, VocabularyIngredient } from './lib/types'

type Tab = 'current' | 'library' | 'shop' | 'deleted'
type RecipeDestination = 'library' | 'queue'

const blankDraft = (): RecipeDraft => ({ title: '', ingredients: [], notes: '', sourceUrl: '', dishType: 'Kita', cuisine: 'Tarptautinė' })

// Roughly the order a shop is walked, so the list reads top to bottom.
const SECTION_ORDER: IngredientSection[] =
  ['Produce', 'Bakery', 'Dairy & alternatives', 'Frozen', 'Pantry', 'Spices', 'Other']

const SECTION_LABELS: Record<IngredientSection, string> = {
  Produce: 'Vaisiai ir daržovės',
  Bakery: 'Kepiniai',
  'Dairy & alternatives': 'Pieno produktai ir alternatyvos',
  Frozen: 'Šaldyti produktai',
  Pantry: 'Bakalėja',
  Spices: 'Prieskoniai',
  Other: 'Kita',
}

function formatRelative(dateValue: string | null) {
  if (!dateValue) return 'Niekada'
  const days = Math.floor((Date.now() - new Date(dateValue).getTime()) / 86_400_000)
  if (days <= 0) return 'Šiandien'
  if (days === 1) return 'Vakar'
  return `Prieš ${days} d.`
}

function barboraUrl(item: string) {
  return `https://barbora.lt/paieska?q=${encodeURIComponent(item)}`
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [household, setHousehold] = useState<Household | null>(null)
  const [vocabulary, setVocabulary] = useState<VocabularyIngredient[]>([])
  const [setupChecked, setSetupChecked] = useState(false)
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [tab, setTab] = useState<Tab>('current')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ recipe?: Recipe; destination: RecipeDestination } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [similarPrompt, setSimilarPrompt] = useState<{ recipe: Recipe; destination: 'queue' | 'roster'; matches: Recipe[] } | null>(null)
  const [undo, setUndo] = useState<{ entryId: string; label: string } | null>(null)
  const undoTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(null), 5_000)
    return () => window.clearTimeout(timer)
  }, [message])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
      if (!nextSession) {
        setHousehold(null)
        setRecipes([])
        setRoster([])
        setQueue([])
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const findHousehold = useCallback(async () => {
    if (!session) return
    setSetupChecked(false)
    setError(null)
    const { data: memberships, error: membershipError } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', session.user.id)
      .limit(1)
    if (membershipError) {
      setError(membershipError.message)
      setSetupChecked(true)
      return
    }

    let householdId = memberships?.[0]?.household_id as string | undefined
    if (!householdId) {
      const { data: owned } = await supabase
        .from('households')
        .select('id')
        .eq('owner_id', session.user.id)
        .limit(1)
      householdId = owned?.[0]?.id
      if (householdId) {
        const { error: repairError } = await supabase.from('household_members').insert({
          household_id: householdId,
          user_id: session.user.id,
        })
        if (repairError) setError(repairError.message)
      }
    }

    if (!householdId) {
      setHousehold(null)
      setSetupChecked(true)
      return
    }

    const { data: householdRow, error: householdError } = await supabase
      .from('households')
      .select('id, name, invite_code, owner_id')
      .eq('id', householdId)
      .single()
    if (householdError) setError(householdError.message)
    else setHousehold(householdRow as Household)
    setSetupChecked(true)
  }, [session])

  useEffect(() => {
    if (session) void findHousehold()
  }, [session, findHousehold])

  const loadData = useCallback(async () => {
    if (!household) return
    const [recipeResult, rosterResult, queueResult, vocabularyResult] = await Promise.all([
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
    ])
    const firstError = recipeResult.error || rosterResult.error || queueResult.error || vocabularyResult.error
    if (firstError) {
      setError(firstError.message)
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
  }, [household])

  useEffect(() => {
    if (!household) return
    void loadData()
    let timer: number | undefined
    const refreshSoon = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void loadData(), 180)
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
  }, [household, loadData])

  const activeRecipes = useMemo(() => recipes.filter((recipe) => !recipe.deleted_at), [recipes])
  const deletedRecipes = useMemo(() => recipes.filter((recipe) => recipe.deleted_at), [recipes])
  const recipeById = useMemo(() => new Map(recipes.map((recipe) => [recipe.id, recipe])), [recipes])
  const readyEntries = useMemo(() => roster.filter((entry) => entry.status === 'ready'), [roster])
  const recentCooked = useMemo(() => {
    const cutoff = Date.now() - 5 * 86_400_000
    return roster.filter(
      (entry) => entry.status === 'cooked' && entry.resolved_at && new Date(entry.resolved_at).getTime() >= cutoff,
    )
  }, [roster])

  const lastCooked = useCallback(
    (recipeId: string) => {
      const dates = roster
        .filter((entry) => entry.recipe_id === recipeId && entry.status === 'cooked' && entry.resolved_at)
        .map((entry) => entry.resolved_at as string)
        .sort()
      return dates.at(-1) || null
    },
    [roster],
  )

  async function createHousehold(name: string, displayName: string) {
    if (!session) return
    setLoading(true)
    setError(null)
    const { data, error: householdError } = await supabase
      .from('households')
      .insert({ name: name.trim(), owner_id: session.user.id })
      .select('id, name, invite_code, owner_id')
      .single()
    if (householdError) {
      setError(householdError.message)
      setLoading(false)
      return
    }
    const { error: memberError } = await supabase.from('household_members').insert({
      household_id: data.id,
      user_id: session.user.id,
      display_name: displayName.trim() || null,
    })
    if (memberError) setError(memberError.message)
    else setHousehold(data as Household)
    setLoading(false)
  }

  async function joinHousehold(code: string, displayName: string) {
    setLoading(true)
    setError(null)
    const { error: joinError } = await supabase.rpc('join_household', {
      p_invite_code: code,
      p_display_name: displayName.trim() || null,
    })
    if (joinError) setError(joinError.message)
    else await findHousehold()
    setLoading(false)
  }

  async function saveRecipe(draft: RecipeDraft, existing?: Recipe, destination: RecipeDestination = 'library') {
    if (!household || !session) return
    setLoading(true)
    setError(null)
    const cleanedIngredients = [...new Set(draft.ingredients.map((item) => item.trim()).filter(Boolean))]
    let recipeId = existing?.id
    if (existing) {
      const { error: updateError } = await supabase
        .from('recipes')
        .update({ title: draft.title.trim(), notes: draft.notes.trim() || null, source_url: draft.sourceUrl.trim() || null })
        .eq('id', existing.id)
      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }
      const { error: deleteIngredientsError } = await supabase
        .from('recipe_ingredients')
        .delete()
        .eq('recipe_id', existing.id)
      if (deleteIngredientsError) {
        setError(deleteIngredientsError.message)
        setLoading(false)
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
          created_by: session.user.id,
        })
        .select('id')
        .single()
      if (insertError) {
        setError(insertError.message)
        setLoading(false)
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
        if (ingredientError) setError(ingredientError.message)
      }
    }
    if (!existing && destination === 'queue' && recipeId) {
      await supabase.from('shopping_queue').insert({
        household_id: household.id,
        recipe_id: recipeId,
        added_by: session.user.id,
      })
    }
    setEditor(null)
    if (recipeId) await saveRecipeClassification(recipeId, draft)
    setMessage(existing ? 'Receptas atnaujintas' : destination === 'queue' ? 'Pridėta į pirkinių planą' : 'Receptas išsaugotas')
    await loadData()
    setLoading(false)
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
      setError(readError.message)
      return null
    }
    const idByName = new Map((existing || []).map((row) => [row.name.trim().toLocaleLowerCase(), row.id as string]))
    const missing = [...new Map(
      names
        .map((name) => name.trim())
        .filter((name) => name && !idByName.has(name.toLocaleLowerCase()))
        .map((name) => [name.toLocaleLowerCase(), name]),
    ).values()]
    if (missing.length) {
      const { data: created, error: createError } = await supabase
        .from('ingredients')
        .insert(missing.map((name) => ({ household_id: household.id, name })))
        .select('id, name')
      if (createError) {
        setError(createError.message)
        return null
      }
      ;(created || []).forEach((row) => idByName.set(row.name.trim().toLocaleLowerCase(), row.id as string))
    }
    return names
      .map((name) => idByName.get(name.trim().toLocaleLowerCase()))
      .filter((id): id is string => Boolean(id))
  }

  async function saveRecipeClassification(recipeId: string, draft: RecipeDraft) {
    if (!household) return
    const desiredNames = classificationTags(draft)
    const { data: currentTags, error: tagReadError } = await supabase
      .from('tags')
      .select('id, name')
      .eq('household_id', household.id)
    if (tagReadError) {
      setError(tagReadError.message)
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
        setError(createError.message)
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
      setError(classificationReadError.message)
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
        setError(deleteError.message)
        return
      }
    }
    const desiredIds = desiredNames.map((name) => tagIdByName.get(name.toLocaleLowerCase('lt'))).filter((id): id is string => Boolean(id))
    if (desiredIds.length) {
      const { error: linkError } = await supabase.from('recipe_tags').insert(
        desiredIds.map((tag_id) => ({ household_id: household.id, recipe_id: recipeId, tag_id })),
      )
      if (linkError) setError(linkError.message)
    }
  }

  async function saveImported(drafts: RecipeDraft[]) {
    for (const draft of drafts) await saveRecipe(draft)
    setImportOpen(false)
    setMessage(`Importuota receptų: ${drafts.length}`)
  }

  function similarInPlan(recipe: Recipe) {
    const plannedIds = new Set([...readyEntries.map((entry) => entry.recipe_id), ...queue.map((entry) => entry.recipe_id)])
    return activeRecipes.filter(
      (candidate) => candidate.id !== recipe.id && plannedIds.has(candidate.id) && titleSimilarity(recipe.title, candidate.title) >= 0.58,
    )
  }

  async function planRecipe(recipe: Recipe, destination: 'queue' | 'roster', force = false) {
    if (!household || !session) return
    const matches = similarInPlan(recipe)
    if (matches.length && !force) {
      setSimilarPrompt({ recipe, destination, matches })
      return
    }
    setError(null)
    const result = destination === 'queue'
      ? await supabase.from('shopping_queue').insert({ household_id: household.id, recipe_id: recipe.id, added_by: session.user.id })
      : await supabase.from('roster_entries').insert({ household_id: household.id, recipe_id: recipe.id, added_by: session.user.id })
    if (result.error?.code === '23505') setMessage('Šis receptas jau yra pirkinių sąraše')
    else if (result.error) setError(result.error.message)
    else setMessage(destination === 'queue' ? 'Pridėta prie pirkinių' : 'Pridėta prie gaminamų receptų')
    setSimilarPrompt(null)
    await loadData()
  }

  async function resolveEntry(entry: RosterEntry, status: 'cooked' | 'skipped') {
    if (!session) return
    const { error: updateError } = await supabase
      .from('roster_entries')
      .update({ status, resolved_at: new Date().toISOString(), resolved_by: session.user.id })
      .eq('id', entry.id)
    if (updateError) {
      setError(updateError.message)
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
    if (undoError) setError(undoError.message)
    else await loadData()
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
    setUndo(null)
  }

  async function removeFromQueue(entry: QueueEntry) {
    const { error: removeError } = await supabase.from('shopping_queue').delete().eq('id', entry.id)
    if (removeError) setError(removeError.message)
    else setQueue((current) => current.filter((item) => item.id !== entry.id))
  }

  async function completeShopping() {
    if (!household || queue.length === 0) return
    if (!window.confirm(`Perkelti suplanuotus receptus (${queue.length}) į „Gaminama“ ir išvalyti pirkinių sąrašą?`)) return
    setLoading(true)
    const { data, error: completeError } = await supabase.rpc('complete_shopping', { p_household_id: household.id })
    if (completeError) setError(completeError.message)
    else {
      setMessage(`Apsipirkta — gaminimui paruoštų receptų: ${data}`)
      setTab('current')
      await loadData()
    }
    setLoading(false)
  }

  async function softDelete(recipe: Recipe) {
    if (!session || !window.confirm(`Perkelti „${recipe.title}“ į ištrintus?`)) return
    const { error: deleteError } = await supabase
      .from('recipes')
      .update({ deleted_at: new Date().toISOString(), deleted_by: session.user.id })
      .eq('id', recipe.id)
    if (deleteError) setError(deleteError.message)
    else {
      setMessage('Receptas perkeltas į ištrintus')
      await loadData()
    }
  }

  async function restoreRecipe(recipe: Recipe) {
    const { error: restoreError } = await supabase
      .from('recipes')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', recipe.id)
    if (restoreError) setError(restoreError.message)
    else {
      setMessage('Receptas atkurtas')
      await loadData()
    }
  }

  const sectionByIngredient = useMemo(
    () => new Map(vocabulary.map((entry) => [entry.name.trim().toLocaleLowerCase(), entry.section])),
    [vocabulary],
  )

  const shoppingSections = useMemo(() => {
    const grouped = new Map<string, { item: string; section: IngredientSection; recipes: Set<string> }>()
    queue.forEach((entry) => {
      const recipe = recipeById.get(entry.recipe_id)
      recipe?.recipe_ingredients.forEach((ingredient) => {
        const key = ingredient.item.trim().toLocaleLowerCase()
        const group = grouped.get(key) || {
          item: ingredient.item.trim(),
          section: sectionByIngredient.get(key) || 'Other',
          recipes: new Set<string>(),
        }
        group.recipes.add(recipe.title)
        grouped.set(key, group)
      })
    })
    const items = [...grouped.values()]
    return SECTION_ORDER
      .map((section) => ({
        section,
        items: items.filter((item) => item.section === section).sort((a, b) => a.item.localeCompare(b.item, 'lt')),
      }))
      .filter((group) => group.items.length > 0)
  }, [queue, recipeById, sectionByIngredient])

  const shoppingCount = useMemo(
    () => shoppingSections.reduce((total, group) => total + group.items.length, 0),
    [shoppingSections],
  )

  if (!authReady) return <Splash />
  if (!session) return <AuthScreen />
  if (!setupChecked) return <Splash />
  if (!household) return <HouseholdSetup loading={loading} error={error} onCreate={createHousehold} onJoin={joinHousehold} />

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{household.name}</p>
          <h1>{tab === 'current' ? 'Gaminama' : tab === 'library' ? 'Receptų biblioteka' : tab === 'shop' ? 'Pirkiniai' : 'Ištrinti'}</h1>
        </div>
        <button className="icon-button" aria-label="Namų ūkio nustatymai" onClick={() => setSettingsOpen(true)}>•••</button>
      </header>

      <main>
        {error && <Banner tone="error" onClose={() => setError(null)}>{error}</Banner>}
        {message && <Banner onClose={() => setMessage(null)}>{message}</Banner>}

        {tab === 'current' && (
          <CurrentView
            entries={readyEntries}
            recent={recentCooked}
            recipeById={recipeById}
            onCooked={(entry) => void resolveEntry(entry, 'cooked')}
            onSkipped={(entry) => void resolveEntry(entry, 'skipped')}
            onEdit={(recipe) => setEditor({ recipe, destination: 'library' })}
            onQueue={(recipe) => void planRecipe(recipe, 'queue')}
            onAdd={() => { setTab('shop'); setPickerOpen(true) }}
          />
        )}
        {tab === 'library' && (
          <LibraryView
            recipes={activeRecipes}
            lastCooked={lastCooked}
            onAdd={() => setEditor({ destination: 'library' })}
            onImport={() => setImportOpen(true)}
            onEdit={(recipe) => setEditor({ recipe, destination: 'library' })}
            onQueue={(recipe) => void planRecipe(recipe, 'queue')}
            onCurrent={(recipe) => void planRecipe(recipe, 'roster')}
            onDelete={(recipe) => void softDelete(recipe)}
          />
        )}
        {tab === 'shop' && (
          <ShoppingView
            queue={queue}
            recipeById={recipeById}
            sections={shoppingSections}
            count={shoppingCount}
            loading={loading}
            onAdd={() => setPickerOpen(true)}
            onRemove={(entry) => void removeFromQueue(entry)}
            onComplete={() => void completeShopping()}
          />
        )}
        {tab === 'deleted' && <DeletedView recipes={deletedRecipes} onRestore={(recipe) => void restoreRecipe(recipe)} />}
      </main>

      <nav className="bottom-nav" aria-label="Pagrindinė navigacija">
        <NavButton active={tab === 'current'} label="Gaminama" icon={<BowlIcon />} onClick={() => setTab('current')} />
        <NavButton active={tab === 'library'} label="Biblioteka" icon={<BookIcon />} onClick={() => setTab('library')} />
        <NavButton active={tab === 'shop'} label="Pirkiniai" icon={<BasketIcon />} badge={queue.length} onClick={() => setTab('shop')} />
        <NavButton active={tab === 'deleted'} label="Ištrinti" icon={<TrashIcon />} onClick={() => setTab('deleted')} />
      </nav>

      {editor && (
        <RecipeEditor
          vocabulary={vocabulary}
          recipe={editor.recipe}
          destination={editor.destination}
          loading={loading}
          onClose={() => setEditor(null)}
          onSave={(draft) => void saveRecipe(draft, editor.recipe, editor.destination)}
        />
      )}
      {importOpen && <ImportDialog vocabulary={vocabulary} loading={loading} onClose={() => setImportOpen(false)} onSave={(drafts) => void saveImported(drafts)} />}
      {pickerOpen && (
        <MealPicker
          recipes={activeRecipes}
          queuedIds={new Set(queue.map((entry) => entry.recipe_id))}
          onClose={() => setPickerOpen(false)}
          onPick={(recipe) => void planRecipe(recipe, 'queue')}
          onNew={() => { setPickerOpen(false); setEditor({ destination: 'queue' }) }}
        />
      )}
      {settingsOpen && <SettingsDialog household={household} email={session.user.email || ''} onClose={() => setSettingsOpen(false)} />}
      {similarPrompt && (
        <Modal title="Čia jau yra panašių receptų" onClose={() => setSimilarPrompt(null)}>
          <p className="muted">Jau suplanuota:</p>
          <ul className="plain-list">{similarPrompt.matches.map((match) => <li key={match.id}>{match.title}</li>)}</ul>
          <p>Vis tiek galite pridėti <strong>{similarPrompt.recipe.title}</strong>.</p>
          <div className="button-row">
            <button className="button secondary" onClick={() => setSimilarPrompt(null)}>Atšaukti</button>
            <button className="button primary" onClick={() => void planRecipe(similarPrompt.recipe, similarPrompt.destination, true)}>Vis tiek pridėti</button>
          </div>
        </Modal>
      )}
      {undo && (
        <div className="undo-toast" role="status">
          <span>{undo.label}</span>
          <button onClick={() => void undoResolution()}>Atšaukti</button>
        </div>
      )}
    </div>
  )
}

function Splash() {
  return <div className="splash"><div className="brand-mark">R</div><p>Ruošiama virtuvė…</p></div>
}

function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setNotice(null)
    const result = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}` },
        })
    if (result.error) setNotice(result.error.message)
    else if (mode === 'signup' && !result.data.session) setNotice('Patvirtinkite paskyrą el. paštu, tada grįžkite ir prisijunkite.')
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <section className="auth-card">
        <div className="brand-mark">R</div>
        <p className="eyebrow">Bendra virtuvė</p>
        <h1>Ką gaminsime?</h1>
        <p className="lead">Saugokite mėgstamus receptus, suplanuokite valgius ir apsipirkite pagal vieną tvarkingą sąrašą.</p>
        <div className="segmented">
          <button className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Prisijungti</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Kurti paskyrą</button>
        </div>
        <form onSubmit={submit} className="form-stack">
          <label>El. paštas<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Slaptažodis<input type="password" minLength={8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {notice && <p className="form-notice">{notice}</p>}
          <button className="button primary wide" disabled={loading}>{loading ? 'Akimirką…' : mode === 'signin' ? 'Prisijungti' : 'Kurti paskyrą'}</button>
        </form>
      </section>
    </div>
  )
}

function HouseholdSetup({ loading, error, onCreate, onJoin }: {
  loading: boolean
  error: string | null
  onCreate: (name: string, displayName: string) => void
  onJoin: (code: string, displayName: string) => void
}) {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('Mūsų virtuvė')
  const [displayName, setDisplayName] = useState('')
  const [code, setCode] = useState('')
  return (
    <div className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">Pradėkime</p>
        <h1>Sukurkite savo virtuvę</h1>
        <p className="lead">Vienas žmogus ją sukuria, o kitas prisijungia trumpu kodu.</p>
        <div className="segmented">
          <button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>Sukurti</button>
          <button className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>Prisijungti</button>
        </div>
        <form className="form-stack" onSubmit={(event) => {
          event.preventDefault()
          if (mode === 'create') onCreate(name, displayName)
          else onJoin(code, displayName)
        }}>
          <label>Jūsų vardas <span className="optional">nebūtina</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          {mode === 'create'
            ? <label>Virtuvės pavadinimas<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
            : <label>Pakvietimo kodas<input className="code-input" required maxLength={8} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /></label>}
          {error && <p className="form-notice">{error}</p>}
          <button className="button primary wide" disabled={loading}>{loading ? 'Ruošiama…' : mode === 'create' ? 'Sukurti virtuvę' : 'Prisijungti prie virtuvės'}</button>
        </form>
      </section>
    </div>
  )
}

function CurrentView({ entries, recent, recipeById, onCooked, onSkipped, onEdit, onQueue, onAdd }: {
  entries: RosterEntry[]
  recent: RosterEntry[]
  recipeById: Map<string, Recipe>
  onCooked: (entry: RosterEntry) => void
  onSkipped: (entry: RosterEntry) => void
  onEdit: (recipe: Recipe) => void
  onQueue: (recipe: Recipe) => void
  onAdd: () => void
}) {
  return (
    <div className="page-stack">
      <button className="button primary add-meals" onClick={onAdd}>＋ Pridėti patiekalų</button>
      {entries.length === 0 ? (
        <EmptyState title="Nėra laukiančių receptų" text="Pridėkite kelis patiekalus, apsipirkite, ir jie atsiras čia." action="Planuoti patiekalus" onAction={onAdd} />
      ) : (
        <section className="card-grid">
          {entries.map((entry) => {
            const recipe = recipeById.get(entry.recipe_id)
            if (!recipe || recipe.deleted_at) return null
            return (
              <article className="meal-card" key={entry.id}>
                <div className="meal-copy">
                  <div className="meal-head">
                    <p className="eyebrow">Paruošta gaminti</p>
                    <button className="text-button" onClick={() => onEdit(recipe)}>Redaguoti</button>
                  </div>
                  <h2>{recipe.title}</h2>
                  <RecipeTags recipe={recipe} />
                  <IngredientLine recipe={recipe} />
                  {recipe.notes && <p className="notes">{recipe.notes}</p>}
                </div>
                <div className="resolve-actions">
                  <button className="resolve cooked" onClick={() => onCooked(entry)} aria-label={`Pažymėti „${recipe.title}“ kaip pagamintą`}>✓ <span>Pagaminta</span></button>
                  <button className="resolve skipped" onClick={() => onSkipped(entry)} aria-label={`Praleisti „${recipe.title}“`}>× <span>Praleisti</span></button>
                </div>
              </article>
            )
          })}
        </section>
      )}
      {recent.length > 0 && (
        <section className="recent-section">
          <div className="section-heading"><div><p className="eyebrow">Pastarosios 5 dienos</p><h2>Neseniai gaminta</h2></div></div>
          <div className="recent-strip">
            {recent.map((entry) => {
              const recipe = recipeById.get(entry.recipe_id)
              return recipe ? (
                <div className="recent-chip" key={entry.id}>
                  <span>✓</span>
                  <div><strong>{recipe.title}</strong><small>{formatRelative(entry.resolved_at)}</small></div>
                  <button className="recent-again" onClick={() => onQueue(recipe)} aria-label={`Vėl pridėti „${recipe.title}“ į pirkinių sąrašą`} title="Vėl pridėti prie pirkinių">＋</button>
                </div>
              ) : null
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function LibraryView({ recipes, lastCooked, onAdd, onImport, onEdit, onQueue, onCurrent, onDelete }: {
  recipes: Recipe[]
  lastCooked: (id: string) => string | null
  onAdd: () => void
  onImport: () => void
  onEdit: (recipe: Recipe) => void
  onQueue: (recipe: Recipe) => void
  onCurrent: (recipe: Recipe) => void
  onDelete: (recipe: Recipe) => void
}) {
  const [search, setSearch] = useState('')
  const needle = search.trim().toLocaleLowerCase('lt')
  const filtered = recipes.filter((recipe) => {
    const tags = recipeTagNames(recipe).map((name) => name.replace(DISH_TAG_PREFIX, '').replace(CUISINE_TAG_PREFIX, ''))
    const haystack = `${recipe.title} ${recipe.recipe_ingredients.map((item) => item.item).join(' ')} ${tags.join(' ')}`.toLocaleLowerCase('lt')
    return haystack.includes(needle)
  })
  const groups = DISH_TYPES
    .map((dishType) => ({ dishType, recipes: filtered.filter((recipe) => dishTypeFor(recipe) === dishType) }))
    .filter((group) => group.recipes.length > 0)
  return (
    <div className="page-stack">
      <div className="toolbar">
        <input className="search" type="search" placeholder="Ieškoti receptų, produktų ar virtuvių" value={search} onChange={(event) => setSearch(event.target.value)} />
        <button className="button primary" onClick={onAdd}>＋ Naujas</button>
      </div>
      <button className="text-button import-button" onClick={onImport}>Importuoti įklijuotą receptų sąrašą</button>
      {filtered.length === 0 ? <EmptyState title={recipes.length ? 'Nieko nerasta' : 'Biblioteka tuščia'} text={recipes.length ? 'Pabandykite kitą paiešką.' : 'Pridėkite receptą arba įklijuokite turimą savaitės sąrašą.'} action={recipes.length ? undefined : 'Pridėti receptą'} onAction={recipes.length ? undefined : onAdd} /> : (
        <div className="library-groups">
          {groups.map((group) => (
            <section className="library-group" key={group.dishType}>
              <div className="library-group-heading"><h2>{group.dishType}</h2><span>{group.recipes.length}</span></div>
              <div className="library-list">
                {group.recipes.map((recipe) => (
                  <article className="library-card" key={recipe.id}>
                    <div className="library-main">
                      <div><p className="eyebrow">Gaminta · {formatRelative(lastCooked(recipe.id))}</p><h2>{recipe.title}</h2></div>
                      <RecipeTags recipe={recipe} />
                      <IngredientLine recipe={recipe} />
                      {recipe.notes && <p className="notes">{recipe.notes}</p>}
                      {recipe.source_url && <a className="source-link" href={recipe.source_url} target="_blank" rel="noreferrer">Atverti originalų receptą ↗</a>}
                    </div>
                    <div className="library-actions">
                      <button onClick={() => onQueue(recipe)}>Prie pirkinių</button>
                      <button onClick={() => onCurrent(recipe)}>Gaminti dabar</button>
                      <button onClick={() => onEdit(recipe)}>Redaguoti</button>
                      <button className="danger-text" onClick={() => onDelete(recipe)}>Ištrinti</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function ShoppingView({ queue, recipeById, sections, count, loading, onAdd, onRemove, onComplete }: {
  queue: QueueEntry[]
  recipeById: Map<string, Recipe>
  sections: { section: IngredientSection; items: { item: string; recipes: Set<string> }[] }[]
  count: number
  loading: boolean
  onAdd: () => void
  onRemove: (entry: QueueEntry) => void
  onComplete: () => void
}) {
  return (
    <div className="page-stack shop-page">
      <div className="section-heading"><div><p className="eyebrow">Laikinas planas</p><h2>Suplanuota patiekalų: {queue.length}</h2></div><button className="button primary" onClick={onAdd}>＋ Pridėti</button></div>
      {queue.length === 0 ? <EmptyState title="Pirkinių planas tuščias" text="Pasirinkite visus norimus patiekalus ir gausite vieną bendrą sąrašą." action="Pridėti patiekalų" onAction={onAdd} /> : (
        <>
          <div className="queue-chips">
            {queue.map((entry) => {
              const recipe = recipeById.get(entry.recipe_id)
              return recipe ? <div className="queue-chip" key={entry.id}><span>{recipe.title}</span><button aria-label={`Pašalinti „${recipe.title}“`} onClick={() => onRemove(entry)}>×</button></div> : null
            })}
          </div>
          <section className="shopping-card">
            <div className="section-heading"><div><p className="eyebrow">Bendras sąrašas</p><h2>Produktai</h2></div><span className="count-pill">{count}</span></div>
            {count ? sections.map((group) => (
              <div className="shop-section" key={group.section}>
                <h3 className="shop-section-title">{SECTION_LABELS[group.section]}<span>{group.items.length}</span></h3>
                <ul className="ingredient-shopping-list">
                  {group.items.map((item) => {
                    const titles = [...item.recipes]
                    const usage = titles.length === 1 ? `reikia „${titles[0]}“` : titles.length === 2 ? `reikia „${titles[0]}“ ir „${titles[1]}“` : `reikia ${titles.length} receptams`
                    return <li key={item.item}><a href={barboraUrl(item.item)} target="_blank" rel="noreferrer"><strong>{item.item}</strong><span>{usage} · ieškoti „Barboroje“ ↗</span></a></li>
                  })}
                </ul>
              </div>
            )) : <p className="muted">Šiuose receptuose produktų dar nėra.</p>}
          </section>
          <button className="button success wide complete-button" disabled={loading} onClick={onComplete}>✓ Apsipirkta</button>
          <p className="center-note">Visi suplanuoti patiekalai bus perkelti į „Gaminama“, o šis sąrašas išvalytas.</p>
        </>
      )}
    </div>
  )
}

function DeletedView({ recipes, onRestore }: { recipes: Recipe[]; onRestore: (recipe: Recipe) => void }) {
  return recipes.length === 0
    ? <EmptyState title="Ištrintų receptų nėra" text="Pašalintus receptus čia visada galėsite atkurti." />
    : <section className="library-list">{recipes.map((recipe) => <article className="library-card" key={recipe.id}><div className="library-main"><p className="eyebrow">Ištrinta · {formatRelative(recipe.deleted_at)}</p><h2>{recipe.title}</h2><IngredientLine recipe={recipe} /></div><button className="button secondary" onClick={() => onRestore(recipe)}>Atkurti</button></article>)}</section>
}

function IngredientLine({ recipe }: { recipe: Recipe }) {
  const sorted = [...recipe.recipe_ingredients].sort((a, b) => a.position - b.position)
  return sorted.length ? <p className="ingredients">{sorted.map((ingredient) => ingredient.item).join(' · ')}</p> : <p className="ingredients empty">Produktų nepridėta</p>
}

function RecipeTags({ recipe }: { recipe: Recipe }) {
  const cuisine = cuisineFor(recipe)
  return <div className="recipe-tags"><span>{cuisine}</span></div>
}

function RecipeEditor({ recipe, destination, vocabulary, loading, onClose, onSave }: {
  recipe?: Recipe
  destination: RecipeDestination
  vocabulary: VocabularyIngredient[]
  loading: boolean
  onClose: () => void
  onSave: (draft: RecipeDraft) => void
}) {
  const [draft, setDraft] = useState<RecipeDraft>(() => recipe ? {
    title: recipe.title,
    ingredients: [...recipe.recipe_ingredients].sort((a, b) => a.position - b.position).map((item) => item.item),
    notes: recipe.notes || '',
    sourceUrl: recipe.source_url || '',
    dishType: dishTypeFor(recipe),
    cuisine: cuisineFor(recipe),
  } : blankDraft())
  const [categoriesTouched, setCategoriesTouched] = useState(Boolean(recipe))

  function updateContent(next: Pick<RecipeDraft, 'title' | 'ingredients'>) {
    const detected = categoriesTouched ? {} : classifyRecipe(next.title, next.ingredients)
    setDraft((current) => ({ ...current, ...next, ...detected }))
  }

  return (
    <Modal title={recipe ? 'Redaguoti receptą' : destination === 'queue' ? 'Naujas patiekalas' : 'Naujas receptas'} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault()
        onSave(draft)
      }}>
        <label>Patiekalo pavadinimas<input autoFocus required value={draft.title} onChange={(event) => updateContent({ title: event.target.value, ingredients: draft.ingredients })} placeholder="Pasta e ceci" /></label>
        <div className="field"><span className="field-label">Produktai <span className="optional">po vieną</span></span>
          <IngredientChips value={draft.ingredients} vocabulary={vocabulary} onChange={(ingredients) => updateContent({ title: draft.title, ingredients })} />
        </div>
        <div className="category-grid">
          <label>Patiekalo tipas<select value={draft.dishType} onChange={(event) => { setCategoriesTouched(true); setDraft({ ...draft, dishType: event.target.value }) }}>{DISH_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Virtuvė<select value={draft.cuisine} onChange={(event) => { setCategoriesTouched(true); setDraft({ ...draft, cuisine: event.target.value }) }}>{CUISINES.map((value) => <option key={value}>{value}</option>)}</select></label>
        </div>
        {!categoriesTouched && <p className="category-hint">Kategorijos parenkamos automatiškai pagal pavadinimą ir produktus.</p>}
        <label>Trumpi gaminimo žingsniai <span className="optional">nebūtina</span><textarea rows={4} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Kas svarbu gaminant…" /></label>
        <label>Šaltinio nuoroda <span className="optional">nebūtina</span><input type="url" value={draft.sourceUrl} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} placeholder="https://…" /></label>
        <button className="button primary wide" disabled={loading}>{loading ? 'Saugoma…' : recipe ? 'Išsaugoti pakeitimus' : destination === 'queue' ? 'Išsaugoti ir pridėti prie pirkinių' : 'Išsaugoti receptą'}</button>
      </form>
    </Modal>
  )
}

function ImportDialog({ vocabulary, loading, onClose, onSave }: { vocabulary: VocabularyIngredient[]; loading: boolean; onClose: () => void; onSave: (drafts: RecipeDraft[]) => void }) {
  const [raw, setRaw] = useState('')
  const [drafts, setDrafts] = useState<RecipeDraft[] | null>(null)
  if (!drafts) return (
    <Modal title="Importuoti receptų sąrašą" onClose={onClose}>
      <p className="muted">Įklijuokite po vieną patiekalą eilutėje. Brūkšnys atskiria pavadinimą nuo kableliais išvardytų produktų. Žymimieji langeliai ir numeracija bus pašalinti.</p>
      <textarea className="import-area" rows={10} value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="[ ] 1. Pasta e ceci — makaronai, avinžirniai, pomidorai" />
      <p className="fine-print">Kalba nekeičiama. Prieš išsaugodami galėsite pataisyti kiekvieną receptą.</p>
      <button className="button primary wide" disabled={!raw.trim()} onClick={() => setDrafts(parseRecipeList(raw))}>Peržiūrėti receptus</button>
    </Modal>
  )
  return (
    <Modal title={`Peržiūrėti receptus (${drafts.length})`} onClose={onClose} wide>
      <div className="import-preview">
        {drafts.map((draft, index) => <div className="preview-card" key={index}>
          <div className="preview-number">{index + 1}</div>
          <label>Patiekalas<input value={draft.title} onChange={(event) => setDrafts(drafts.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /></label>
          <div className="field"><span className="field-label">Produktai</span>
            <IngredientChips value={draft.ingredients} vocabulary={vocabulary} onChange={(ingredients) => setDrafts(drafts.map((item, itemIndex) => itemIndex === index ? { ...item, ingredients } : item))} />
          </div>
          <button className="text-button danger-text" onClick={() => setDrafts(drafts.filter((_, itemIndex) => itemIndex !== index))}>Pašalinti</button>
        </div>)}
      </div>
      <div className="button-row sticky-actions"><button className="button secondary" onClick={() => setDrafts(null)}>Atgal</button><button className="button primary" disabled={loading || drafts.length === 0 || drafts.some((draft) => !draft.title.trim())} onClick={() => onSave(drafts)}>{loading ? 'Importuojama…' : `Importuoti (${drafts.length})`}</button></div>
    </Modal>
  )
}

function MealPicker({ recipes, queuedIds, onClose, onPick, onNew }: {
  recipes: Recipe[]
  queuedIds: Set<string>
  onClose: () => void
  onPick: (recipe: Recipe) => void
  onNew: () => void
}) {
  const [search, setSearch] = useState('')
  const filtered = recipes.filter((recipe) => `${recipe.title} ${cuisineFor(recipe)} ${dishTypeFor(recipe)}`.toLocaleLowerCase('lt').includes(search.toLocaleLowerCase('lt')))
  return (
    <Modal title="Pridėti patiekalų" onClose={onClose}>
      <div className="picker-actions"><input autoFocus className="search" type="search" placeholder="Rasti receptą" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="button secondary" onClick={onNew}>＋ Naujas</button></div>
      <div className="picker-list">{filtered.map((recipe) => <button className="picker-row" key={recipe.id} disabled={queuedIds.has(recipe.id)} onClick={() => onPick(recipe)}><span><strong>{recipe.title}</strong><small>Produktų: {recipe.recipe_ingredients.length}</small></span><span>{queuedIds.has(recipe.id) ? 'Pridėta' : '＋'}</span></button>)}</div>
    </Modal>
  )
}

function SettingsDialog({ household, email, onClose }: { household: Household; email: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  async function copyCode() {
    await navigator.clipboard.writeText(household.invite_code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  return (
    <Modal title="Jūsų virtuvė" onClose={onClose}>
      <p className="muted">Kai kitas žmogus susikurs paskyrą, pasidalykite su juo šiuo kodu.</p>
      <button className="invite-code" onClick={() => void copyCode()}><span>{household.invite_code}</span><small>{copied ? 'Nukopijuota!' : 'Paliesti ir kopijuoti'}</small></button>
      <div className="settings-meta"><span>Prisijungta kaip</span><strong>{email}</strong></div>
      <button className="button secondary wide" onClick={() => void supabase.auth.signOut()}>Atsijungti</button>
    </Modal>
  )
}

function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal ${wide ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="icon-button" aria-label="Uždaryti" onClick={onClose}>×</button></header><div className="modal-body">{children}</div></section></div>
}

function Banner({ tone = 'info', onClose, children }: { tone?: 'info' | 'error'; onClose: () => void; children: React.ReactNode }) {
  return <div className={`banner ${tone}`} role={tone === 'error' ? 'alert' : 'status'}><span>{children}</span><button onClick={onClose}>×</button></div>
}

function EmptyState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <section className="empty-state"><div className="empty-icon">◇</div><h2>{title}</h2><p>{text}</p>{action && onAction && <button className="button secondary" onClick={onAction}>{action}</button>}</section>
}

function NavButton({ active, label, icon, badge, onClick }: { active: boolean; label: string; icon: ReactNode; badge?: number; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}><span className="nav-icon">{icon}{badge ? <i>{badge}</i> : null}</span><span>{label}</span></button>
}

export default App

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function BowlIcon() {
  return <svg {...iconProps}><path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z" /><path d="M9.5 8.2c0-1.5 1.5-1.5 1.5-3.2" /><path d="M13.5 8.2c0-1.5 1.5-1.5 1.5-3.2" /></svg>
}

function BookIcon() {
  return <svg {...iconProps}><path d="M5 4.5h11.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2V4.5Z" /><path d="M5 17.5a2 2 0 0 1 2-2h11.5" /></svg>
}

function BasketIcon() {
  return <svg {...iconProps}><path d="M4.6 8.5h14.8l-1.2 10.1a2 2 0 0 1-2 1.8H7.8a2 2 0 0 1-2-1.8L4.6 8.5Z" /><path d="M9 8.5v-2a3 3 0 0 1 6 0v2" /></svg>
}

function TrashIcon() {
  return <svg {...iconProps}><path d="M4.5 6.6h15" /><path d="M9.6 6.6V5.1A1.6 1.6 0 0 1 11.2 3.5h1.6a1.6 1.6 0 0 1 1.6 1.6v1.5" /><path d="M6.6 6.6l.85 12.05a2 2 0 0 0 2 1.85h5.1a2 2 0 0 0 2-1.85L17.4 6.6" /></svg>
}

/**
 * Shared ingredient editor. Typing filters the household vocabulary, first on
 * plain substring matches and then on the same bigram similarity the importer
 * uses, so "svogun" still reaches "Svogūnai" despite the declension. Anything
 * unrecognised is kept as typed; the database links or creates the vocabulary
 * entry when the recipe is saved.
 */
function IngredientChips({ value, vocabulary, onChange }: {
  value: string[]
  vocabulary: VocabularyIngredient[]
  onChange: (next: string[]) => void
}) {
  const [entry, setEntry] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [adding, setAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const taken = useMemo(() => new Set(value.map((item) => item.trim().toLocaleLowerCase())), [value])

  const suggestions = useMemo(() => {
    const query = entry.trim()
    if (!query) return []
    const needle = query.toLocaleLowerCase()
    return vocabulary
      .filter((item) => !taken.has(item.name.trim().toLocaleLowerCase()))
      .map((item) => {
        const name = item.name.toLocaleLowerCase()
        const score = name.startsWith(needle) ? 1 : name.includes(needle) ? 0.9 : titleSimilarity(query, item.name)
        return { item, score }
      })
      .filter((row) => row.score >= 0.45)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'lt'))
      .slice(0, 6)
      .map((row) => row.item)
  }, [entry, vocabulary, taken])

  const exactMatch = suggestions.some((item) => item.name.toLocaleLowerCase() === entry.trim().toLocaleLowerCase())

  function add(name: string) {
    const cleaned = name.trim()
    setEntry('')
    setHighlight(0)
    if (!cleaned || taken.has(cleaned.toLocaleLowerCase())) return
    onChange([...value, cleaned])
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      add(suggestions[highlight] ? suggestions[highlight].name : entry)
      return
    }
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault()
      setHighlight((current) => (current + 1) % suggestions.length)
      return
    }
    if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault()
      setHighlight((current) => (current - 1 + suggestions.length) % suggestions.length)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setEntry('')
      setAdding(false)
      return
    }
    if (event.key === 'Backspace' && !entry && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className="chip-field">
      <div className="chip-row">
        {value.map((item, index) => (
          <span className="chip" key={`${item}-${index}`}>
            {item}
            <button type="button" aria-label={`Pašalinti „${item}“`} onClick={() => onChange(value.filter((_, i) => i !== index))}>×</button>
          </span>
        ))}
        {adding ? (
          <div className="chip-input">
            <input
              ref={inputRef}
              autoFocus
              value={entry}
              onChange={(event) => { setEntry(event.target.value); setHighlight(0) }}
              onKeyDown={onKeyDown}
              onBlur={() => { if (!entry.trim()) setAdding(false) }}
              placeholder="Pradėkite rašyti…"
              aria-label="Pridėti produktą"
            />
            {suggestions.length > 0 && (
              <ul className="chip-suggestions">
                {suggestions.map((item, index) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={index === highlight ? 'active' : ''}
                      onMouseDown={(event) => { event.preventDefault(); add(item.name) }}
                    >
                      <strong>{item.name}</strong><span>{SECTION_LABELS[item.section]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {entry.trim() && !exactMatch && (
              <p className="chip-hint">„Enter“ pridės <strong>{entry.trim()}</strong> kaip naują produktą</p>
            )}
          </div>
        ) : (
          <button type="button" className="chip-add" onClick={() => setAdding(true)}>＋ Pridėti</button>
        )}
      </div>
      {value.length === 0 && !adding && <p className="chip-empty">Produktų dar nėra.</p>}
    </div>
  )
}
