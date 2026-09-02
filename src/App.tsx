import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { ingredientLookupKey, ingredientNameWithoutQuantity, normalizeTitle, parseRecipeList, titleSimilarity } from './lib/parser'
import { classificationTags, classifyRecipe, CUISINES, cuisineFor, DISH_TAG_PREFIX, DISH_TYPES, dishTypeFor, CUISINE_TAG_PREFIX, recipeTagNames } from './lib/categories'
import { SECTION_ROOTS, buildCategoryIndex, mapIngredient, shoppingUrl, trailTo } from './lib/barboraMapping'
import type { CategoryIndex } from './lib/barboraMapping'
import type { BarboraCategory, Household, HouseholdTag, IngredientSection, QueueEntry, Recipe, RecipeDraft, RosterEntry, VocabularyIngredient } from './lib/types'

type Tab = 'current' | 'library' | 'shop' | 'deleted'
type RecipeDestination = 'library' | 'queue'

type PersistedViewState = {
  version: 1
  tab: Tab
  scrollByTab: Record<Tab, number>
  expandedRecipeId: string | null
}

const EMPTY_SCROLL: Record<Tab, number> = { current: 0, library: 0, shop: 0, deleted: 0 }

function viewStateKey(userId: string, householdId: string) {
  return `recipes:view:v1:${userId}:${householdId}`
}

function readViewState(key: string): PersistedViewState | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null') as Partial<PersistedViewState> | null
    if (!parsed || parsed.version !== 1 || !['current', 'library', 'shop', 'deleted'].includes(parsed.tab ?? '')) return null
    const savedScroll = parsed.scrollByTab as Partial<Record<Tab, unknown>> | undefined
    const scroll = (tab: Tab) => {
      const value = savedScroll?.[tab]
      return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
    }
    return {
      version: 1,
      tab: parsed.tab as Tab,
      scrollByTab: {
        current: scroll('current'),
        library: scroll('library'),
        shop: scroll('shop'),
        deleted: scroll('deleted'),
      },
      expandedRecipeId: typeof parsed.expandedRecipeId === 'string' ? parsed.expandedRecipeId : null,
    }
  } catch {
    return null
  }
}

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

// The aisle each section falls back to, read from the same crawled catalogue
// the mapper walks. Association-file aliases are deliberately not used here:
// some open Barbora but point its app at a retired, 404ing route.
const SECTION_BARBORA_URLS = Object.fromEntries(
  Object.entries(SECTION_ROOTS)
    .filter(([, path]) => path !== null)
    .map(([section, path]) => [section, shoppingUrl(path as string)]),
) as Partial<Record<IngredientSection, string>>

function formatRelative(dateValue: string | null) {
  if (!dateValue) return 'Niekada'
  const now = new Date()
  const date = new Date(dateValue)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const target = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.max(0, Math.round((today - target) / 86_400_000))
  if (days <= 0) return 'Šiandien'
  if (days === 1) return 'Vakar'
  return `Prieš ${days} d.`
}

/**
 * iOS receives Barbora's exact live HTTPS URL. On Android, a user click tries
 * an explicit intent for the Barbora package and carries that same URL as the
 * browser fallback. This may bypass a stale App Link path filter without ever
 * replacing a working catalogue path with an obsolete one.
 *
 * With no category to point at, the name stays plain text rather than becoming
 * a link to somewhere invented.
 */
function BarboraLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (href === null) return <>{children}</>
  return <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
  >{children}</a>
}

/**
 * The mapping columns for an ingredient. A category the household picked by
 * hand is recorded as such and is never recomputed; everything else is the
 * mapper's proposal, which may be nothing at all.
 */
function mappingFields(
  name: string,
  section: IngredientSection,
  index: CategoryIndex,
  manualPath?: string | null,
) {
  const stamp = new Date().toISOString()
  // No catalogue loaded means no opinion, not "no category": clearing the
  // columns here would quietly discard a mapping because a fetch was slow.
  if (index.byPath.size === 0 && !manualPath) return {}
  if (manualPath) {
    return {
      barbora_category_path: manualPath,
      barbora_mapping_reason: 'manual',
      barbora_mapping_source: 'manual',
      barbora_mapping_updated_at: stamp,
    }
  }
  const proposal = mapIngredient(name, section, index)
  if (!proposal) {
    return {
      barbora_category_path: null,
      barbora_mapping_reason: null,
      barbora_mapping_source: null,
      barbora_mapping_updated_at: null,
    }
  }
  return {
    barbora_category_path: proposal.path,
    barbora_mapping_reason: proposal.reason,
    barbora_mapping_source: 'automatic',
    barbora_mapping_updated_at: stamp,
  }
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [barboraCategories, setBarboraCategories] = useState<BarboraCategory[]>([])
  const [authReady, setAuthReady] = useState(false)
  const [household, setHousehold] = useState<Household | null>(null)
  const [vocabulary, setVocabulary] = useState<VocabularyIngredient[]>([])
  const [tags, setTags] = useState<HouseholdTag[]>([])
  const [setupChecked, setSetupChecked] = useState(false)
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [tab, setTab] = useState<Tab>('current')
  const [libraryExpanded, setLibraryExpanded] = useState<string | null>(null)
  const [dataReady, setDataReady] = useState(false)
  const [viewStateReady, setViewStateReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ recipe?: Recipe; destination: RecipeDestination } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [undo, setUndo] = useState<{ entryId: string; label: string } | null>(null)
  const undoTimer = useRef<number | null>(null)
  const tabRef = useRef<Tab>('current')
  const expandedRecipeRef = useRef<string | null>(null)
  const scrollByTab = useRef<Record<Tab, number>>({ ...EMPTY_SCROLL })

  const persistedViewKey = session && household ? viewStateKey(session.user.id, household.id) : null

  /**
   * Put the page back where it was, once it is tall enough to go there.
   *
   * Restoring happens as soon as the data arrives, but React still has to
   * render the restored tab, and on a slow phone that takes several frames.
   * Scrolling into a page that is still short silently clamps to the top —
   * which is why scrolling after a fixed two frames worked against a fast
   * stub and not on a real device. Wait for the height instead of guessing at
   * a delay, and touch the scroll only once it can actually land.
   */
  function restoreScroll(nextTab: Tab) {
    const target = scrollByTab.current[nextTab] ?? 0
    if (target <= 0) return
    let frames = 0
    const attempt = () => {
      const reachable = document.documentElement.scrollHeight - window.innerHeight
      if (reachable >= target) {
        window.scrollTo(0, target)
        return
      }
      // Give up after about a second: the content is shorter than it was.
      if (frames < 60) {
        frames += 1
        window.requestAnimationFrame(attempt)
      }
    }
    window.requestAnimationFrame(attempt)
  }

  function saveViewState(captureScroll = true) {
    if (!persistedViewKey || !viewStateReady) return
    if (captureScroll) scrollByTab.current[tabRef.current] = window.scrollY
    const state: PersistedViewState = {
      version: 1,
      tab: tabRef.current,
      scrollByTab: scrollByTab.current,
      expandedRecipeId: expandedRecipeRef.current,
    }
    try {
      window.localStorage.setItem(persistedViewKey, JSON.stringify(state))
    } catch {
      // A full or unavailable localStorage must never make the app unusable.
    }
  }

  function changeTab(nextTab: Tab) {
    scrollByTab.current[tabRef.current] = window.scrollY
    tabRef.current = nextTab
    setTab(nextTab)
    saveViewState(false)
    restoreScroll(nextTab)
  }

  function changeExpandedRecipe(recipeId: string | null) {
    expandedRecipeRef.current = recipeId
    setLibraryExpanded(recipeId)
    saveViewState(false)
  }

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
        setDataReady(false)
        setViewStateReady(false)
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
    setTags((tagResult.data || []) as HouseholdTag[])
    setDataReady(true)
  }, [household])

  useEffect(() => {
    setDataReady(false)
    setViewStateReady(false)
  }, [household?.id])

  useEffect(() => {
    if (!persistedViewKey || !dataReady) return
    const saved = readViewState(persistedViewKey)
    const nextTab = saved?.tab ?? 'current'
    const expandedStillExists = saved?.expandedRecipeId
      ? recipes.some((recipe) => recipe.id === saved.expandedRecipeId && !recipe.deleted_at)
      : false
    scrollByTab.current = saved ? { ...EMPTY_SCROLL, ...saved.scrollByTab } : { ...EMPTY_SCROLL }
    tabRef.current = nextTab
    expandedRecipeRef.current = expandedStillExists ? saved?.expandedRecipeId ?? null : null
    setTab(nextTab)
    setLibraryExpanded(expandedRecipeRef.current)
    setViewStateReady(true)
    restoreScroll(nextTab)
    // Restore once for this user/household after its first successful load.
    // Realtime refreshes must not pull an older scroll position back in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedViewKey, dataReady])

  useEffect(() => {
    if (!persistedViewKey || !viewStateReady) return
    /**
     * Only a scroll the household actually made is worth remembering.
     *
     * A hidden page still emits scroll events — iOS moves the web view around
     * as it backgrounds and reclaims it — and a modal parks the body at the
     * top through `position: fixed`, which reports a scroll of zero. Recording
     * either overwrites the position we mean to come back to, which is how
     * switching apps used to return you to the top of the library.
     */
    /**
     * Remember where the finger left the page, not every scroll that happens.
     *
     * iOS shifts the web view as it backgrounds the app, sometimes before it
     * reports the page hidden and often within a second of the last real
     * scroll — so neither the visibility flag nor a time window separates the
     * two. What does separate them is contact: the household's scrolling
     * happens while a touch is down, or settles shortly after it lifts. A
     * scroll with no touch behind it is the system moving the page, and is
     * exactly the position we must not save.
     */
    let touching = false
    let pointerAt = 0
    let settleTimer = 0

    const capture = () => {
      if (document.visibilityState === 'hidden') return
      if (document.body.style.position === 'fixed') return
      scrollByTab.current[tabRef.current] = window.scrollY
    }
    const startGesture = () => { touching = true }
    const endGesture = () => {
      touching = false
      // Momentum runs on after the finger lifts; take the resting position.
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(capture, 400)
    }
    const notePointer = () => { pointerAt = Date.now() }
    const rememberScroll = () => {
      if (touching || Date.now() - pointerAt < 150) capture()
    }

    const save = () => {
      capture()
      const state: PersistedViewState = {
        version: 1,
        tab: tabRef.current,
        scrollByTab: scrollByTab.current,
        expandedRecipeId: expandedRecipeRef.current,
      }
      try {
        window.localStorage.setItem(persistedViewKey, JSON.stringify(state))
      } catch {
        // A full or unavailable localStorage must never make the app unusable.
      }
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') save()
      else restoreScroll(tabRef.current)
    }
    const restoreOnReturn = (event: PageTransitionEvent) => {
      if (event.persisted) restoreScroll(tabRef.current)
    }
    window.addEventListener('touchstart', startGesture, { passive: true })
    window.addEventListener('touchend', endGesture, { passive: true })
    window.addEventListener('touchcancel', endGesture, { passive: true })
    window.addEventListener('wheel', notePointer, { passive: true })
    window.addEventListener('keydown', notePointer)
    window.addEventListener('scroll', rememberScroll, { passive: true })
    window.addEventListener('pagehide', save)
    window.addEventListener('pageshow', restoreOnReturn)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      save()
      window.clearTimeout(settleTimer)
      window.removeEventListener('touchstart', startGesture)
      window.removeEventListener('touchend', endGesture)
      window.removeEventListener('touchcancel', endGesture)
      window.removeEventListener('wheel', notePointer)
      window.removeEventListener('keydown', notePointer)
      window.removeEventListener('scroll', rememberScroll)
      window.removeEventListener('pagehide', save)
      window.removeEventListener('pageshow', restoreOnReturn)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [persistedViewKey, viewStateReady])

  useEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => { window.history.scrollRestoration = previous }
  }, [])

  // Global reference data, not household data: fetched once per session and
  // left alone. It changes when the crawler publishes, not when a recipe does.
  useEffect(() => {
    if (!session) return
    let cancelled = false
    void supabase
      .from('barbora_categories')
      .select('path, name, parent_path, depth, sort_order, active')
      .order('depth', { ascending: true })
      .order('sort_order', { ascending: true })
      .then(({ data, error: categoryError }) => {
        if (cancelled) return
        // A missing catalogue is not worth an error banner: every link falls
        // back to its section aisle, exactly as before this existed.
        if (categoryError) return
        setBarboraCategories((data ?? []) as BarboraCategory[])
      })
    return () => { cancelled = true }
  }, [session])

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
  const recipeCategories = useMemo(() => {
    const configured = tags
      .filter((tag) => tag.name.startsWith(DISH_TAG_PREFIX))
      .map((tag) => tag.name.slice(DISH_TAG_PREFIX.length))
    const preferred = DISH_TYPES.filter((name) => configured.includes(name))
    const custom = configured.filter((name) => !DISH_TYPES.includes(name)).sort((a, b) => a.localeCompare(b, 'lt'))
    return [...preferred, ...custom]
  }, [tags])
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
    setMessage(existing ? 'Receptas atnaujintas' : destination === 'queue' ? 'Pridėta į krepšelį' : 'Receptas išsaugotas')
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
        setError(createError.message)
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
    const fallbackCategory = recipeCategories.includes('Kita') ? 'Kita' : recipeCategories[0] || 'Kita'
    for (const draft of drafts) {
      const detected = classifyRecipe(draft.title, draft.ingredients)
      await saveRecipe({
        ...draft,
        dishType: recipeCategories.includes(detected.dishType) ? detected.dishType : fallbackCategory,
        cuisine: detected.cuisine,
      })
    }
    setImportOpen(false)
    setMessage(`Importuota receptų: ${drafts.length}`)
  }

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
      setError(createError.code === '23505' ? 'Toks ingredientas jau yra.' : createError.message)
      return false
    }
    await loadData()
    setMessage('Ingredientas pridėtas')
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
      setError(updateError.code === '23505' ? 'Toks ingredientas jau yra.' : updateError.message)
      return false
    }
    await loadData()
    setMessage('Ingredientas atnaujintas')
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
        setError(linkError.message)
        return
      }
    }
    const { error: deleteError } = await supabase.from('ingredients').delete().eq('id', ingredient.id)
    if (deleteError) setError(deleteError.message)
    else {
      await loadData()
      setMessage('Ingredientas pašalintas')
    }
  }

  async function createRecipeCategory(name: string) {
    if (!household) return false
    const cleaned = name.replace(DISH_TAG_PREFIX, '').trim()
    if (!cleaned) return false
    const { error: createError } = await supabase.from('tags').insert({ household_id: household.id, name: `${DISH_TAG_PREFIX}${cleaned}` })
    if (createError) {
      setError(createError.code === '23505' ? 'Tokia kategorija jau yra.' : createError.message)
      return false
    }
    await loadData()
    setMessage('Kategorija pridėta')
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
      setError(updateError.code === '23505' ? 'Tokia kategorija jau yra.' : updateError.message)
      return false
    }
    await loadData()
    setMessage('Kategorija atnaujinta')
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
          setError(fallbackError.message)
          return
        }
        fallback = data as HouseholdTag
      }
      const { error: linkError } = await supabase.from('recipe_tags').upsert(
        affected.map((recipe) => ({ household_id: household.id, recipe_id: recipe.id, tag_id: fallback.id })),
        { onConflict: 'recipe_id,tag_id', ignoreDuplicates: true },
      )
      if (linkError) {
        setError(linkError.message)
        return
      }
    }

    const { error: deleteError } = await supabase.from('tags').delete().eq('id', category.id)
    if (deleteError) setError(deleteError.message)
    else {
      await loadData()
      setMessage('Kategorija pašalinta')
    }
  }

  async function planRecipe(recipe: Recipe, destination: 'queue' | 'roster') {
    if (!household || !session) return
    setError(null)
    const result = destination === 'queue'
      ? await supabase.from('shopping_queue').insert({ household_id: household.id, recipe_id: recipe.id, added_by: session.user.id })
      : await supabase.from('roster_entries').insert({ household_id: household.id, recipe_id: recipe.id, added_by: session.user.id })
    if (result.error?.code === '23505') setMessage(destination === 'queue' ? 'Šis receptas jau yra krepšelyje' : 'Šis receptas jau yra meniu')
    else if (result.error) setError(result.error.message)
    else setMessage(destination === 'queue' ? 'Pridėta į krepšelį' : 'Pridėta į meniu')
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
    if (!window.confirm(`Perkelti suplanuotus receptus (${queue.length}) į „Meniu“ ir išvalyti krepšelį?`)) return
    setLoading(true)
    const { data, error: completeError } = await supabase.rpc('complete_shopping', { p_household_id: household.id })
    if (completeError) setError(completeError.message)
    else {
      setMessage(`Apsipirkta — gaminimui paruoštų receptų: ${data}`)
      changeTab('current')
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

  const categoryIndex = useMemo(() => buildCategoryIndex(barboraCategories), [barboraCategories])

  const vocabularyByName = useMemo(
    () => new Map(vocabulary.map((entry) => [ingredientLookupKey(entry.name), entry])),
    [vocabulary],
  )

  /**
   * The mapped category when there is one, the section's aisle when there is
   * not, and nothing at all rather than a guessed URL. A mapping pointing at a
   * category the catalogue no longer carries falls back too.
   */
  const shoppingHref = useCallback((entry: VocabularyIngredient | undefined, section: IngredientSection) => {
    if (entry?.barbora_direct_url) return entry.barbora_direct_url
    const path = entry?.barbora_category_path
    if (path && categoryIndex.byPath.has(path)) return shoppingUrl(path)
    return SECTION_BARBORA_URLS[section] ?? null
  }, [categoryIndex])

  const shoppingSections = useMemo(() => {
    const grouped = new Map<string, { item: string; section: IngredientSection; href: string | null; recipes: Set<string> }>()
    queue.forEach((entry) => {
      const recipe = recipeById.get(entry.recipe_id)
      recipe?.recipe_ingredients.forEach((ingredient) => {
        const key = ingredientLookupKey(ingredient.item)
        const known = vocabularyByName.get(key)
        const section = known?.section ?? 'Other'
        const group = grouped.get(key) || {
          item: ingredient.item.trim(),
          section,
          href: shoppingHref(known, section),
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
  }, [queue, recipeById, vocabularyByName, shoppingHref])

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
          <h1>{tab === 'current' ? 'Meniu' : tab === 'library' ? 'Receptai' : tab === 'shop' ? 'Krepšelis' : 'Ištrinti'}</h1>
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
            onAdd={() => setPickerOpen(true)}
          />
        )}
        {tab === 'library' && (
          <LibraryView
            recipes={activeRecipes}
            categories={recipeCategories}
            lastCooked={lastCooked}
            expanded={libraryExpanded}
            onExpandedChange={changeExpandedRecipe}
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
        <NavButton active={tab === 'current'} label="Meniu" icon={<BowlIcon />} onClick={() => changeTab('current')} />
        <NavButton active={tab === 'library'} label="Receptai" icon={<BookIcon />} onClick={() => changeTab('library')} />
        <NavButton active={tab === 'shop'} label="Krepšelis" icon={<BasketIcon />} badge={queue.length} onClick={() => changeTab('shop')} />
        <NavButton active={tab === 'deleted'} label="Ištrinti" icon={<TrashIcon />} onClick={() => changeTab('deleted')} />
      </nav>

      {editor && (
        <RecipeEditor
          vocabulary={vocabulary}
          categories={recipeCategories}
          recipes={activeRecipes}
          recipe={editor.recipe}
          destination={editor.destination}
          loading={loading}
          onClose={() => setEditor(null)}
          onSave={(draft) => void saveRecipe(draft, editor.recipe, editor.destination)}
          categoryIndex={categoryIndex}
          onCreateIngredient={createIngredient}
        />
      )}
      {importOpen && <ImportDialog vocabulary={vocabulary} recipes={activeRecipes} loading={loading} onClose={() => setImportOpen(false)} onSave={(drafts) => void saveImported(drafts)} />}
      {pickerOpen && (
        <MealPicker
          recipes={activeRecipes}
          queuedIds={new Set(queue.map((entry) => entry.recipe_id))}
          onClose={() => setPickerOpen(false)}
          onPick={(recipe) => {
            if (tab === 'current') changeTab('shop')
            void planRecipe(recipe, 'queue')
          }}
          onNew={() => { setPickerOpen(false); setEditor({ destination: 'queue' }) }}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          household={household}
          email={session.user.email || ''}
          vocabulary={vocabulary}
          recipes={recipes}
          categories={tags.filter((tag) => tag.name.startsWith(DISH_TAG_PREFIX))}
          categoryIndex={categoryIndex}
          onCreateIngredient={createIngredient}
          onUpdateIngredient={updateIngredient}
          onDeleteIngredient={deleteIngredient}
          onCreateCategory={createRecipeCategory}
          onUpdateCategory={updateRecipeCategory}
          onDeleteCategory={deleteRecipeCategory}
          onClose={() => setSettingsOpen(false)}
        />
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
      <button className="button primary add-meals" onClick={onAdd}>＋ Pridėti</button>
      {entries.length === 0 ? (
        <EmptyState title="Nėra laukiančių receptų" text="Pridėkite kelis patiekalus, apsipirkite, ir jie atsiras čia." action="Pridėti" onAction={onAdd} />
      ) : (
        <section className="card-grid">
          {entries.map((entry) => {
            const recipe = recipeById.get(entry.recipe_id)
            if (!recipe || recipe.deleted_at) return null
            return (
              <article className="meal-card" key={entry.id}>
                <div className="meal-copy">
                  <div className="meal-head">
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
                  <button className="recent-again" onClick={() => onQueue(recipe)} aria-label={`Vėl pridėti „${recipe.title}“ į krepšelį`} title="Vėl pridėti į krepšelį">＋</button>
                </div>
              ) : null
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function LibraryView({ recipes, categories, lastCooked, expanded, onExpandedChange, onAdd, onImport, onEdit, onQueue, onCurrent, onDelete }: {
  recipes: Recipe[]
  categories: string[]
  lastCooked: (id: string) => string | null
  expanded: string | null
  onExpandedChange: (recipeId: string | null) => void
  onAdd: () => void
  onImport: () => void
  onEdit: (recipe: Recipe) => void
  onQueue: (recipe: Recipe) => void
  onCurrent: (recipe: Recipe) => void
  onDelete: (recipe: Recipe) => void
}) {
  const [search, setSearch] = useState('')
  const needle = normalizeTitle(search)
  const filtered = recipes.filter((recipe) => {
    if (!needle) return true
    const tags = recipeTagNames(recipe).map((name) => name.replace(DISH_TAG_PREFIX, '').replace(CUISINE_TAG_PREFIX, ''))
    const haystack = normalizeTitle(`${recipe.title} ${recipe.recipe_ingredients.map((item) => item.item).join(' ')} ${tags.join(' ')}`)
    return haystack.includes(needle)
  })
  const usedCategories = [...new Set(filtered.map(dishTypeFor))]
  const groupOrder = [...categories, ...usedCategories.filter((name) => !categories.includes(name))]
  const groups = groupOrder
    .map((dishType) => ({ dishType, recipes: filtered.filter((recipe) => dishTypeFor(recipe) === dishType) }))
    .filter((group) => group.recipes.length > 0)
  return (
    <div className="page-stack">
      <div className="toolbar">
        <input className="search" type="search" placeholder="Ieškoti receptų, produktų ar virtuvių" value={search} onChange={(event) => setSearch(event.target.value)} />
        <button className="button primary" onClick={onAdd}>＋ Naujas</button>
      </div>
      <button className="text-button import-button" onClick={onImport}>Importuoti receptus</button>
      {filtered.length === 0 ? <EmptyState title={recipes.length ? 'Nieko nerasta' : 'Receptų nėra'} text={recipes.length ? 'Pabandykite kitą paiešką.' : 'Pridėkite receptą arba įklijuokite turimą savaitės sąrašą.'} action={recipes.length ? undefined : 'Pridėti receptą'} onAction={recipes.length ? undefined : onAdd} /> : (
        <div className="library-groups">
          {groups.map((group) => (
            <section className="library-group" key={group.dishType}>
              <div className="library-group-heading"><h2>{group.dishType}</h2><span>{group.recipes.length}</span></div>
              <div className="recipe-tile-grid">
                {group.recipes.map((recipe) => {
                  const isExpanded = expanded === recipe.id
                  const cookedAt = lastCooked(recipe.id)
                  return (
                    <article className={`recipe-tile ${isExpanded ? 'expanded' : ''}`} key={recipe.id}>
                      <button className="recipe-tile-summary" aria-expanded={isExpanded} onClick={() => onExpandedChange(isExpanded ? null : recipe.id)}>
                        <span className="recipe-tile-copy"><strong>{recipe.title}</strong><small>{cookedAt ? `Gaminta ${formatRelative(cookedAt).toLocaleLowerCase('lt')}` : 'Dar negaminta'}</small></span>
                        <span className="recipe-tile-meta"><span>{cuisineFor(recipe)}</span><i>{recipe.recipe_ingredients.length}</i></span>
                        <span className="recipe-tile-chevron" aria-hidden="true">⌄</span>
                      </button>
                      {isExpanded && (
                        <div className="recipe-tile-detail">
                          <IngredientLine recipe={recipe} />
                          {recipe.notes && <p className="notes">{recipe.notes}</p>}
                          {recipe.source_url && <a className="source-link" href={recipe.source_url} target="_blank" rel="noreferrer">Atverti originalų receptą ↗</a>}
                          <div className="library-actions">
                            <button onClick={() => onQueue(recipe)}>Į krepšelį</button>
                            <button onClick={() => onCurrent(recipe)}>Gaminti dabar</button>
                            <button onClick={() => onEdit(recipe)}>Redaguoti</button>
                            <button className="danger-text" onClick={() => onDelete(recipe)}>Ištrinti</button>
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
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
  sections: { section: IngredientSection; items: { item: string; href: string | null; recipes: Set<string> }[] }[]
  count: number
  loading: boolean
  onAdd: () => void
  onRemove: (entry: QueueEntry) => void
  onComplete: () => void
}) {
  return (
    <div className="page-stack shop-page">
      <div className="section-heading"><h2>Suplanuoti patiekalai</h2><button className="button primary" onClick={onAdd}>＋ Pridėti</button></div>
      {queue.length === 0 ? <EmptyState title="Krepšelis tuščias" text="Pasirinkite visus norimus patiekalus ir gausite vieną bendrą sąrašą." action="Pridėti" onAction={onAdd} /> : (
        <>
          <div className="queue-chips">
            {queue.map((entry) => {
              const recipe = recipeById.get(entry.recipe_id)
              return recipe ? <div className="queue-chip" key={entry.id}><span>{recipe.title}</span><button aria-label={`Pašalinti „${recipe.title}“`} onClick={() => onRemove(entry)}>×</button></div> : null
            })}
          </div>
          <section className="shopping-card">
            <div className="section-heading"><h2>Pirkinių sąrašas</h2><span className="count-pill">{count}</span></div>
            {count ? sections.map((group) => (
              <div className="shop-section" key={group.section}>
                <h3 className="shop-section-title">
                  <BarboraLink href={SECTION_BARBORA_URLS[group.section] ?? null}>
                    {SECTION_LABELS[group.section]} {SECTION_BARBORA_URLS[group.section] && <small aria-hidden="true">↗</small>}
                  </BarboraLink>
                  <span>{group.items.length}</span>
                </h3>
                <ul className="ingredient-shopping-list">
                  {group.items.map((item) => <li key={item.item}><BarboraLink href={item.href}><strong>{item.item}</strong></BarboraLink><div className="ingredient-recipe-tags">{[...item.recipes].map((title) => <span key={title}>{title}</span>)}</div></li>)}
                </ul>
              </div>
            )) : <p className="muted">Šiuose receptuose produktų dar nėra.</p>}
          </section>
          <button className="button success wide complete-button" disabled={loading} onClick={onComplete}>✓ Apsipirkta</button>
          <p className="center-note">Visi suplanuoti patiekalai bus perkelti į „Meniu“, o krepšelis išvalytas.</p>
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

function RecipeEditor({ recipe, destination, vocabulary, categories, recipes: allRecipes, loading, onClose, onSave, categoryIndex, onCreateIngredient }: {
  recipe?: Recipe
  destination: RecipeDestination
  vocabulary: VocabularyIngredient[]
  categories: string[]
  recipes: Recipe[]
  loading: boolean
  onClose: () => void
  onSave: (draft: RecipeDraft) => void
  categoryIndex?: CategoryIndex
  onCreateIngredient?: (name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) => Promise<boolean>
}) {
  const fallbackCategory = categories.includes('Kita') ? 'Kita' : categories[0] || 'Kita'
  const selectableCategories = categories.length ? categories : [fallbackCategory]
  const [draft, setDraft] = useState<RecipeDraft>(() => recipe ? {
    title: recipe.title,
    ingredients: [...recipe.recipe_ingredients].sort((a, b) => a.position - b.position).map((item) => item.item),
    notes: recipe.notes || '',
    sourceUrl: recipe.source_url || '',
    dishType: categories.includes(dishTypeFor(recipe)) ? dishTypeFor(recipe) : fallbackCategory,
    cuisine: cuisineFor(recipe),
  } : { ...blankDraft(), dishType: fallbackCategory })
  const [categoriesTouched, setCategoriesTouched] = useState(Boolean(recipe))

  const similarRecipe = useMemo(() => {
    const title = draft.title.trim()
    if (!title || title.length < 3) return null
    const candidates = allRecipes.filter((r) => r.id !== recipe?.id)
    const exact = candidates.find((r) => normalizeTitle(r.title) === normalizeTitle(title))
    if (exact) return exact.title
    const best = candidates
      .map((r) => ({ title: r.title, score: titleSimilarity(title, r.title) }))
      .filter((r) => r.score >= 0.7)
      .sort((a, b) => b.score - a.score)[0]
    return best ? best.title : null
  }, [draft.title, allRecipes, recipe?.id])

  function updateContent(next: Pick<RecipeDraft, 'title' | 'ingredients'>) {
    const detected = categoriesTouched ? null : classifyRecipe(next.title, next.ingredients)
    const classification = detected ? {
      ...detected,
      dishType: categories.includes(detected.dishType) ? detected.dishType : fallbackCategory,
    } : {}
    setDraft((current) => ({ ...current, ...next, ...classification }))
  }

  return (
    <Modal title={recipe ? 'Redaguoti receptą' : destination === 'queue' ? 'Naujas patiekalas' : 'Naujas receptas'} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault()
        onSave(draft)
      }}>
        <label>Patiekalo pavadinimas<input autoFocus required value={draft.title} onChange={(event) => updateContent({ title: event.target.value, ingredients: draft.ingredients })} placeholder="Pasta e ceci" /></label>
        {similarRecipe && <p className="form-notice">Panašus receptas jau yra: <strong>{similarRecipe}</strong></p>}
        <div className="field"><span className="field-label">Produktai <span className="optional">po vieną</span></span>
          <IngredientChips value={draft.ingredients} vocabulary={vocabulary} onChange={(ingredients) => updateContent({ title: draft.title, ingredients })} categoryIndex={categoryIndex} onCreateIngredient={onCreateIngredient} />
        </div>
        <div className="category-grid">
          <label>Patiekalo tipas<select value={draft.dishType} onChange={(event) => { setCategoriesTouched(true); setDraft({ ...draft, dishType: event.target.value }) }}>{selectableCategories.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Virtuvė<select value={draft.cuisine} onChange={(event) => { setCategoriesTouched(true); setDraft({ ...draft, cuisine: event.target.value }) }}>{CUISINES.map((value) => <option key={value}>{value}</option>)}</select></label>
        </div>
        {!categoriesTouched && <p className="category-hint">Kategorijos parenkamos automatiškai pagal pavadinimą ir produktus.</p>}
        <label>Trumpi gaminimo žingsniai <span className="optional">nebūtina</span><textarea rows={4} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Kas svarbu gaminant…" /></label>
        <label>Šaltinio nuoroda <span className="optional">nebūtina</span><input type="url" value={draft.sourceUrl} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} placeholder="https://…" /></label>
        <button className="button primary wide" disabled={loading}>{loading ? 'Saugoma…' : recipe ? 'Išsaugoti pakeitimus' : destination === 'queue' ? 'Išsaugoti ir pridėti į krepšelį' : 'Išsaugoti receptą'}</button>
      </form>
    </Modal>
  )
}

function ImportDialog({ vocabulary, recipes: allRecipes, loading, onClose, onSave }: { vocabulary: VocabularyIngredient[]; recipes: Recipe[]; loading: boolean; onClose: () => void; onSave: (drafts: RecipeDraft[]) => void }) {
  const [raw, setRaw] = useState('')
  const [drafts, setDrafts] = useState<RecipeDraft[] | null>(null)
  if (!drafts) return (
    <Modal title="Importuoti receptų sąrašą" onClose={onClose}>
      <p className="muted">Įklijuokite po vieną patiekalą eilutėje. Brūkšnys atskiria pavadinimą nuo kableliais išvardytų produktų. Žymimieji langeliai ir numeracija bus pašalinti.</p>
      <textarea className="import-area" rows={10} value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="[ ] 1. Pasta e ceci — makaronai, avinžirniai, pomidorai" />
      <p className="fine-print">Kalba nekeičiama. Prieš išsaugodami galėsite pataisyti kiekvieną receptą.</p>
      <button className="button primary wide" disabled={!raw.trim()} onClick={() => {
        const vocabularyByKey = new Map(vocabulary.map((item) => [ingredientLookupKey(item.name), item.name]))
        function resolveIngredient(raw: string) {
          const key = ingredientLookupKey(raw)
          const exact = vocabularyByKey.get(key)
          if (exact) return exact
          const cleaned = ingredientNameWithoutQuantity(raw)
          const best = vocabulary
            .map((item) => ({ name: item.name, score: titleSimilarity(cleaned, item.name) }))
            .filter((row) => row.score >= 0.65)
            .sort((a, b) => b.score - a.score)[0]
          return best ? best.name : cleaned
        }
        setDrafts(parseRecipeList(raw).map((draft) => ({
          ...draft,
          ingredients: [...new Map(draft.ingredients.map((item) => {
            const resolved = resolveIngredient(item)
            return [ingredientLookupKey(resolved), resolved]
          })).values()],
        })))
      }}>Peržiūrėti receptus</button>
    </Modal>
  )
  return (
    <Modal title={`Peržiūrėti receptus (${drafts.length})`} onClose={onClose} wide>
      <div className="import-preview">
        {drafts.map((draft, index) => {
          const similar = draft.title.trim().length >= 3
            ? allRecipes.find((r) => normalizeTitle(r.title) === normalizeTitle(draft.title))?.title
              ?? allRecipes.filter((r) => titleSimilarity(draft.title, r.title) >= 0.7).sort((a, b) => titleSimilarity(draft.title, b.title) - titleSimilarity(draft.title, a.title))[0]?.title
              ?? null
            : null
          return <div className="preview-card" key={index}>
          <div className="preview-number">{index + 1}</div>
          <label>Patiekalas<input value={draft.title} onChange={(event) => setDrafts(drafts.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /></label>
          {similar && <p className="form-notice">Panašus receptas jau yra: <strong>{similar}</strong></p>}
          <div className="field"><span className="field-label">Produktai</span>
            <IngredientChips value={draft.ingredients} vocabulary={vocabulary} onChange={(ingredients) => setDrafts(drafts.map((item, itemIndex) => itemIndex === index ? { ...item, ingredients } : item))} />
          </div>
          <button className="text-button danger-text" onClick={() => setDrafts(drafts.filter((_, itemIndex) => itemIndex !== index))}>Pašalinti</button>
        </div>})}
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
  const mealNeedle = normalizeTitle(search)
  const filtered = recipes.filter((recipe) => !mealNeedle || normalizeTitle(`${recipe.title} ${cuisineFor(recipe)} ${dishTypeFor(recipe)}`).includes(mealNeedle))
  return (
    <Modal title="Pridėti patiekalų" onClose={onClose}>
      <div className="picker-actions"><input autoFocus className="search" type="search" placeholder="Rasti receptą" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="button secondary" onClick={onNew}>＋ Naujas</button></div>
      <div className="picker-list">{filtered.map((recipe) => <button className="picker-row" key={recipe.id} disabled={queuedIds.has(recipe.id)} onClick={() => onPick(recipe)}><span><strong>{recipe.title}</strong><small>Produktų: {recipe.recipe_ingredients.length}</small></span><span>{queuedIds.has(recipe.id) ? 'Pridėta' : '＋'}</span></button>)}</div>
    </Modal>
  )
}

function SettingsDialog({ household, email, vocabulary, recipes, categories, categoryIndex, onCreateIngredient, onUpdateIngredient, onDeleteIngredient, onCreateCategory, onUpdateCategory, onDeleteCategory, onClose }: {
  household: Household
  email: string
  vocabulary: VocabularyIngredient[]
  recipes: Recipe[]
  categories: HouseholdTag[]
  categoryIndex: CategoryIndex
  onCreateIngredient: (name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) => Promise<boolean>
  onUpdateIngredient: (ingredient: VocabularyIngredient, name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) => Promise<boolean>
  onDeleteIngredient: (ingredient: VocabularyIngredient) => Promise<void>
  onCreateCategory: (name: string) => Promise<boolean>
  onUpdateCategory: (category: HouseholdTag, name: string) => Promise<boolean>
  onDeleteCategory: (category: HouseholdTag) => Promise<void>
  onClose: () => void
}) {
  const [view, setView] = useState<'menu' | 'invite' | 'ingredients' | 'categories'>('menu')
  const [copied, setCopied] = useState(false)
  async function copyCode() {
    await navigator.clipboard.writeText(household.invite_code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  const title = view === 'invite' ? 'Pakviesti prisijungti' : view === 'ingredients' ? 'Ingredientai' : view === 'categories' ? 'Receptų kategorijos' : 'Nustatymai'
  return (
    <Modal title={title} onClose={onClose} wide={view === 'ingredients'}>
      {view === 'menu' && <>
        <div className="settings-options">
          <button onClick={() => setView('invite')}><span><strong>Pakviesti prisijungti</strong><small>Virtuvės kodas kitam žmogui</small></span><b>›</b></button>
          <button onClick={() => setView('ingredients')}><span><strong>Ingredientai</strong><small>Pavadinimai ir skyriai parduotuvėje</small></span><b>›</b></button>
          <button onClick={() => setView('categories')}><span><strong>Receptų kategorijos</strong><small>Grupės receptų bibliotekoje</small></span><b>›</b></button>
        </div>
        <div className="settings-meta"><span>Prisijungta kaip</span><strong>{email}</strong></div>
        <button className="button secondary wide" onClick={() => void supabase.auth.signOut()}>Atsijungti</button>
      </>}
      {view === 'invite' && <>
        <SettingsBack onClick={() => setView('menu')} />
        <p className="muted">Kai kitas žmogus susikurs paskyrą, pasidalinkite su juo šiuo kodu.</p>
        <button className="invite-code" onClick={() => void copyCode()}><span>{household.invite_code}</span><small>{copied ? 'Nukopijuota!' : 'Paliesti ir kopijuoti'}</small></button>
      </>}
      {view === 'ingredients' && <>
        <SettingsBack onClick={() => setView('menu')} />
        <IngredientsManager vocabulary={vocabulary} recipes={recipes} categoryIndex={categoryIndex} onCreate={onCreateIngredient} onUpdate={onUpdateIngredient} onDelete={onDeleteIngredient} />
      </>}
      {view === 'categories' && <>
        <SettingsBack onClick={() => setView('menu')} />
        <RecipeCategoriesManager categories={categories} recipes={recipes} onCreate={onCreateCategory} onUpdate={onUpdateCategory} onDelete={onDeleteCategory} />
      </>}
    </Modal>
  )
}

function SettingsBack({ onClick }: { onClick: () => void }) {
  return <button className="settings-back" onClick={onClick}>← Visi nustatymai</button>
}

/**
 * Browsing the shop's hierarchy to pick one category by hand.
 *
 * Every node is choosable, not only the leaves: a household knows when a
 * branch is good enough, and forcing them deeper would be inventing precision.
 * Nothing is written until Gerai.
 */
function CategoryPicker({ index, ingredientName, initialPath, onCancel, onConfirm }: {
  index: CategoryIndex
  ingredientName: string
  initialPath: string | null
  onCancel: () => void
  onConfirm: (path: string) => void
}) {
  const [node, setNode] = useState<string | null>(initialPath)
  const [selected, setSelected] = useState<string | null>(initialPath)
  const top = useRef<HTMLParagraphElement | null>(null)

  // Moving a level down should start at the top of the new list, not wherever
  // the previous one happened to be scrolled to.
  useEffect(() => { top.current?.scrollIntoView({ block: 'start' }) }, [node])

  const children = index.children.get(node) ?? []
  const trail = node === null ? [] : trailTo(index, node)
  const selectedName = selected === null ? null : index.byPath.get(selected)?.name ?? selected

  function open(path: string) {
    setSelected(path)
    if ((index.children.get(path) ?? []).length > 0) setNode(path)
  }

  return <Modal title="Barbora kategorija" onClose={onCancel}>
    <p className="muted" ref={top}>Kur ieškoti „{ingredientName || 'ingrediento'}“ parduotuvėje.</p>
    <nav className="category-crumbs" aria-label="Kategorijų kelias">
      <button type="button" onClick={() => setNode(null)}>Visos</button>
      {trail.map((category) => (
        <button type="button" key={category.path} onClick={() => setNode(category.path)}>
          <span aria-hidden="true">›</span> {category.name}
        </button>
      ))}
    </nav>
    {node !== null && (
      <button type="button" className="button secondary wide" onClick={() => setSelected(node)}>
        Pasirinkti šią kategoriją
      </button>
    )}
    <div className="category-rows">
      {children.length === 0
        ? <p className="muted">Giliau nebeskirstoma.</p>
        : children.map((category) => {
          const deeper = (index.children.get(category.path) ?? []).length
          return <button
            type="button"
            key={category.path}
            className={`category-row ${selected === category.path ? 'is-selected' : ''}`}
            onClick={() => open(category.path)}
          >
            <span>{category.name}</span>
            {deeper > 0 ? <b aria-hidden="true">›</b> : null}
          </button>
        })}
    </div>
    <div className="category-picker-footer">
      <p className="muted">{selectedName ? <>Pasirinkta: <strong>{selectedName}</strong></> : 'Nieko nepasirinkta'}</p>
      <div>
        <button type="button" className="button secondary" onClick={onCancel}>Atšaukti</button>
        <button type="button" className="button primary" disabled={selected === null} onClick={() => selected && onConfirm(selected)}>Gerai</button>
      </div>
    </div>
  </Modal>
}

function IngredientFormModal({ ingredient, categoryIndex, recipes, initialName, onSave, onDelete, onClose }: {
  ingredient?: VocabularyIngredient
  categoryIndex: CategoryIndex
  recipes?: Recipe[]
  initialName?: string
  onSave: (name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) => Promise<boolean>
  onDelete?: (ingredient: VocabularyIngredient) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(ingredient?.name ?? initialName ?? '')
  const [section, setSection] = useState<IngredientSection>(ingredient?.section ?? 'Other')
  const [path, setPath] = useState<string | null>(ingredient?.barbora_mapping_source === 'manual' ? ingredient.barbora_category_path : null)
  const [directUrl, setDirectUrl] = useState(ingredient?.barbora_direct_url ?? '')
  const [picking, setPicking] = useState(false)
  const hasCatalogue = categoryIndex.byPath.size > 0
  const label = (p: string | null) => (p === null ? null : categoryIndex.byPath.get(p)?.name ?? p)

  const usage = useMemo(() => {
    if (!ingredient || !recipes) return 0
    return recipes.reduce((n, r) => n + (r.recipe_ingredients.some((i) => i.ingredient_id === ingredient.id) ? 1 : 0), 0)
  }, [ingredient, recipes])

  return <>
    <Modal title={ingredient ? 'Redaguoti ingredientą' : 'Naujas ingredientas'} onClose={onClose}>
      <form className="form-stack" onSubmit={(e) => {
        e.preventDefault()
        void onSave(name, section, path, directUrl || null).then((ok) => { if (ok) onClose() })
      }}>
        <label>Pavadinimas<input autoFocus required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Skyrius parduotuvėje<select value={section} onChange={(e) => setSection(e.target.value as IngredientSection)}>{SECTION_ORDER.map((s) => <option value={s} key={s}>{SECTION_LABELS[s]}</option>)}</select></label>
        {hasCatalogue && <div className="category-field">
          <button type="button" className="category-field-button" onClick={() => setPicking(true)}>
            <span><strong>Barbora kategorija</strong><small>{label(path) ?? (ingredient ? label(ingredient.barbora_category_path) : null) ?? 'Parenkama automatiškai'}</small></span><b>›</b>
          </button>
          {(path !== null || ingredient?.barbora_mapping_source === 'manual') && <button type="button" className="text-button" onClick={() => setPath(null)}>Atkurti automatinį parinkimą</button>}
        </div>}
        <label>Tiesioginis produkto URL <span className="optional">nebūtina</span><input type="url" value={directUrl} onChange={(e) => setDirectUrl(e.target.value)} placeholder="https://barbora.lt/produktai/..." /></label>
        {ingredient && <p className="muted ingredient-form-meta">Naudojamas receptuose: {usage}</p>}
        <div className="ingredient-form-actions">
          <button className="button primary" disabled={!name.trim()}>{ingredient ? 'Išsaugoti' : 'Pridėti'}</button>
          <button type="button" className="button secondary" onClick={onClose}>Atšaukti</button>
        </div>
        {ingredient && onDelete && <button type="button" className="text-button danger-text ingredient-form-delete" onClick={() => void onDelete(ingredient)}>Ištrinti ingredientą</button>}
      </form>
    </Modal>
    {picking && <CategoryPicker index={categoryIndex} ingredientName={name} initialPath={path} onCancel={() => setPicking(false)} onConfirm={(p) => { setPath(p); setPicking(false) }} />}
  </>
}

function IngredientsManager({ vocabulary, recipes, categoryIndex, onCreate, onUpdate, onDelete }: {
  vocabulary: VocabularyIngredient[]
  recipes: Recipe[]
  categoryIndex: CategoryIndex
  onCreate: (name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) => Promise<boolean>
  onUpdate: (ingredient: VocabularyIngredient, name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) => Promise<boolean>
  onDelete: (ingredient: VocabularyIngredient) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<VocabularyIngredient | null>(null)
  const usage = useMemo(() => {
    const counts = new Map<string, number>()
    recipes.forEach((r) => r.recipe_ingredients.forEach((i) => counts.set(i.ingredient_id, (counts.get(i.ingredient_id) || 0) + 1)))
    return counts
  }, [recipes])
  const needle = ingredientLookupKey(search)
  const filtered = vocabulary.filter((i) => ingredientLookupKey(i.name).includes(needle))
  const label = (p: string | null) => (p === null ? null : categoryIndex.byPath.get(p)?.name ?? p)

  return <div className="manager-stack">
    <div className="manager-sticky-header">
      <input className="search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Ieškoti (${vocabulary.length})`} />
      <button type="button" className="ingredient-add-chip" onClick={() => setCreating(true)}>＋ Pridėti naują ingredientą</button>
    </div>
    <div className="manager-list">
      {filtered.map((ingredient) => (
        <div className="manager-row" key={ingredient.id}>
          <div>
            <strong>{ingredient.name}</strong>
            <small>{SECTION_LABELS[ingredient.section]} · receptų: {usage.get(ingredient.id) || 0}</small>
            {ingredient.barbora_category_path && <small className="category-hint">{label(ingredient.barbora_category_path)}{ingredient.barbora_mapping_source === 'manual' ? ' · pasirinkta' : ''}</small>}
            {ingredient.barbora_direct_url && <small className="category-hint">Tiesioginis URL</small>}
          </div>
          <button className="text-button" onClick={() => setEditing(ingredient)}>Keisti</button>
          <button className="text-button danger-text" onClick={() => void onDelete(ingredient)}>Ištrinti</button>
        </div>
      ))}
    </div>
    {creating && <IngredientFormModal categoryIndex={categoryIndex} onSave={onCreate} onClose={() => setCreating(false)} />}
    {editing && <IngredientFormModal
      ingredient={editing}
      categoryIndex={categoryIndex}
      recipes={recipes}
      onSave={(name, section, path, url) => onUpdate(editing, name, section, path, url)}
      onDelete={onDelete}
      onClose={() => setEditing(null)}
    />}
  </div>
}

function RecipeCategoriesManager({ categories, recipes, onCreate, onUpdate, onDelete }: {
  categories: HouseholdTag[]
  recipes: Recipe[]
  onCreate: (name: string) => Promise<boolean>
  onUpdate: (category: HouseholdTag, name: string) => Promise<boolean>
  onDelete: (category: HouseholdTag) => Promise<void>
}) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const ordered = [...categories].sort((a, b) => {
    const left = a.name.slice(DISH_TAG_PREFIX.length)
    const right = b.name.slice(DISH_TAG_PREFIX.length)
    const leftIndex = DISH_TYPES.indexOf(left)
    const rightIndex = DISH_TYPES.indexOf(right)
    if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex)
    return left.localeCompare(right, 'lt')
  })
  const countFor = (category: HouseholdTag) => recipes.filter((recipe) => recipe.recipe_tags.some((link) => link.tag.id === category.id)).length

  return <div className="manager-stack">
    <p className="muted">Šios kategorijos sudaro receptų grupes. Virtuvės, pavyzdžiui, italų ar japonų, lieka atskiromis žymomis.</p>
    <form className="manager-create category-create" onSubmit={(event) => {
      event.preventDefault()
      void onCreate(newName).then((saved) => { if (saved) setNewName('') })
    }}><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Nauja kategorija" /><button className="button primary" disabled={!newName.trim()}>Pridėti</button></form>
    <div className="manager-list">
      {ordered.map((category) => {
        const label = category.name.slice(DISH_TAG_PREFIX.length)
        return editing === category.id ? (
          <form className="manager-edit category-edit" key={category.id} onSubmit={(event) => {
            event.preventDefault()
            void onUpdate(category, editName).then((saved) => { if (saved) setEditing(null) })
          }}><input value={editName} onChange={(event) => setEditName(event.target.value)} /><div><button className="button primary" disabled={!editName.trim()}>Išsaugoti</button><button type="button" className="button secondary" onClick={() => setEditing(null)}>Atšaukti</button></div></form>
        ) : (
          <div className="manager-row" key={category.id}><div><strong>{label}</strong><small>Receptų: {countFor(category)}</small></div><button className="text-button" onClick={() => { setEditing(category.id); setEditName(label) }}>Keisti</button><button className="text-button danger-text" onClick={() => void onDelete(category)}>Ištrinti</button></div>
        )
      })}
    </div>
  </div>
}

function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  const backdrop = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const backdrops = document.querySelectorAll('.modal-backdrop')
      if (backdrops[backdrops.length - 1] === backdrop.current) onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  useEffect(() => {
    const body = document.body
    const scrollY = window.scrollY
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      right: body.style.right,
      left: body.style.left,
      overflow: body.style.overflow,
    }
    const viewport = window.visualViewport
    // The backdrop must always cover the whole screen — it is the dimmer and
    // the tap-catcher. Only the card has to fit above the keyboard, so the
    // keyboard's height is published separately as padding rather than by
    // shrinking the backdrop, which used to leave the page behind visible and
    // tappable in the gap.
    const syncViewport = () => {
      const element = backdrop.current
      if (!element) return
      const visible = viewport?.height ?? window.innerHeight
      const offsetTop = viewport?.offsetTop ?? 0
      const keyboard = Math.max(0, window.innerHeight - (visible + offsetTop))
      element.style.setProperty('--modal-viewport-height', `${visible}px`)
      element.style.setProperty('--modal-viewport-top', `${offsetTop}px`)
      element.style.setProperty('--modal-keyboard-inset', `${keyboard}px`)
    }

    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.right = '0'
    body.style.left = '0'
    body.style.overflow = 'hidden'
    syncViewport()
    window.addEventListener('resize', syncViewport)
    viewport?.addEventListener('resize', syncViewport)
    viewport?.addEventListener('scroll', syncViewport)

    return () => {
      window.removeEventListener('resize', syncViewport)
      viewport?.removeEventListener('resize', syncViewport)
      viewport?.removeEventListener('scroll', syncViewport)
      Object.assign(body.style, previousBodyStyles)
      window.scrollTo(0, scrollY)
    }
  }, [])
  // Rendered into the body rather than in place. A modal opened from inside
  // another one would otherwise be a descendant of that modal's scroll
  // container, so focusing a field in the inner one scrolls the list behind
  // it; and the parent's backdrop-filter makes it the containing block for
  // anything fixed inside, which is not where a modal belongs.
  return createPortal(
    <div ref={backdrop} className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal ${wide ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="icon-button" aria-label="Uždaryti" onClick={onClose}>×</button></header><div className="modal-body">{children}</div></section></div>,
    document.body,
  )
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
function IngredientChips({ value, vocabulary, onChange, categoryIndex, onCreateIngredient }: {
  value: string[]
  vocabulary: VocabularyIngredient[]
  onChange: (next: string[]) => void
  categoryIndex?: CategoryIndex
  onCreateIngredient?: (name: string, section: IngredientSection, manualPath?: string | null, directUrl?: string | null) => Promise<boolean>
}) {
  const [entry, setEntry] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [adding, setAdding] = useState(false)
  const [pendingNew, setPendingNew] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const taken = useMemo(() => new Set(value.map(ingredientLookupKey)), [value])

  const suggestions = useMemo(() => {
    const query = entry.trim()
    if (!query) return []
    const needle = ingredientLookupKey(query)
    return vocabulary
      .filter((item) => !taken.has(ingredientLookupKey(item.name)))
      .map((item) => {
        const name = ingredientLookupKey(item.name)
        const score = name.startsWith(needle) ? 1 : name.includes(needle) ? 0.9 : titleSimilarity(query, item.name)
        return { item, score }
      })
      .filter((row) => row.score >= 0.45)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, 'lt'))
      .slice(0, 6)
      .map((row) => row.item)
  }, [entry, vocabulary, taken])

  const exactMatch = suggestions.some((item) => ingredientLookupKey(item.name) === ingredientLookupKey(entry))

  function add(name: string) {
    const cleaned = ingredientNameWithoutQuantity(name)
    setEntry('')
    setHighlight(0)
    if (!cleaned || taken.has(ingredientLookupKey(cleaned))) return
    const key = ingredientLookupKey(cleaned)
    const exactVocab = vocabulary.find((item) => ingredientLookupKey(item.name) === key)
    if (exactVocab) {
      onChange([...value, exactVocab.name])
      return
    }
    const fuzzyMatch = vocabulary
      .filter((item) => !taken.has(ingredientLookupKey(item.name)))
      .map((item) => ({ item, score: titleSimilarity(cleaned, item.name) }))
      .filter((row) => row.score >= 0.65)
      .sort((a, b) => b.score - a.score)[0]
    if (fuzzyMatch) {
      onChange([...value, fuzzyMatch.item.name])
      return
    }
    if (categoryIndex && onCreateIngredient) {
      setPendingNew(cleaned)
      return
    }
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
    <>
    <div className="chip-field">
      <div className="chip-row">
        {value.map((item, index) => (
          <span className="chip" key={`${item}-${index}`}>
            {item}
            <button type="button" aria-label={`Pašalinti „${item}"`} onClick={() => onChange(value.filter((_, i) => i !== index))}>×</button>
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
              <p className="chip-hint">„Enter" pridės <strong>{entry.trim()}</strong> kaip naują produktą</p>
            )}
          </div>
        ) : (
          <button type="button" className="chip-add" onClick={() => setAdding(true)}>＋ Pridėti</button>
        )}
      </div>
      {value.length === 0 && !adding && <p className="chip-empty">Produktų dar nėra.</p>}
    </div>
    {pendingNew && categoryIndex && onCreateIngredient && (
      <IngredientFormModal
        categoryIndex={categoryIndex}
        initialName={pendingNew}
        onSave={async (name, section, manualPath, directUrl) => {
          const saved = await onCreateIngredient(name, section, manualPath, directUrl)
          if (saved) {
            const chipName = ingredientNameWithoutQuantity(name) || name
            onChange([...value, chipName])
            setPendingNew(null)
            setAdding(false)
          }
          return saved
        }}
        onClose={() => setPendingNew(null)}
      />
    )}
    </>
  )
}
