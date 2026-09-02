import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { ingredientLookupKey, normalizeTitle } from './lib/parser'
import { cuisineFor, DISH_TAG_PREFIX, DISH_TYPES, dishTypeFor, CUISINE_TAG_PREFIX, recipeTagNames } from './lib/categories'
import { BARBORA_ORIGIN, SECTION_ROOTS, buildCategoryIndex, shoppingUrl } from './lib/barboraMapping'
import { environment, navigationKind, trace, visualTop } from './lib/scrollTrace'
import { showsSetupSplash } from './lib/readiness'
import { backNav } from './lib/backNav'
import { useHouseholdData } from './hooks/useHouseholdData'
import { useVocabulary } from './hooks/useVocabulary'
import { useRecipeCategories } from './hooks/useRecipeCategories'
import { useRecipeWriting } from './hooks/useRecipeWriting'
import { usePlanning } from './hooks/usePlanning'
import type { BarboraCategory, Household, IngredientSection, QueueEntry, Recipe, RecipeDestination, RosterEntry, Tab, VocabularyIngredient } from './lib/types'
import { HOLD_MS, MOMENTUM_MS, RESTORE_PATIENCE_MS, STILL_MS, createGesture, hasDrifted, keepable, reaches } from './lib/scrollMemory'
import { EMPTY_SCROLL, SCROLL_MEMORY_MS, positionsFrom, readViewState, viewStateKey, writeViewState } from './lib/viewState'
import type { PersistedViewState } from './lib/viewState'
import { SECTION_LABELS, SECTION_ORDER } from './lib/sections'
import { RecipeEditor } from './components/RecipeEditor'
import { ImportDialog } from './components/ImportDialog'
import { MealPicker } from './components/MealPicker'
import { SettingsDialog } from './components/SettingsDialog'






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
    onClick={() => trace('leave-by-link', { to: href.replace(BARBORA_ORIGIN, '') })}
  >{children}</a>
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [barboraCategories, setBarboraCategories] = useState<BarboraCategory[]>([])
  const [authReady, setAuthReady] = useState(false)
  const [household, setHousehold] = useState<Household | null>(null)
  const [setupChecked, setSetupChecked] = useState(false)
  const [tab, setTab] = useState<Tab>('current')
  const [libraryExpanded, setLibraryExpanded] = useState<string | null>(null)
  const [viewStateReady, setViewStateReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ recipe?: Recipe; destination: RecipeDestination } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const tabRef = useRef<Tab>('current')
  const expandedRecipeRef = useRef<string | null>(null)
  const scrollByTab = useRef<Record<Tab, number>>({ ...EMPTY_SCROLL })
  // When the household last touched the screen, so a correction can tell its
  // own scrolling apart from the system's.
  const interactionAt = useRef(0)
  // The position being held just after a restore, while the phone settles.
  const hold = useRef<{ tab: Tab; target: number; reason: string; startedAt: number; until: number } | null>(null)

  // Supabase replaces the session object every time it revalidates the token,
  // which the phone provokes on every app switch. Anything that would re-fetch
  // has to key off who the user is, not off that object's identity.
  const userId = session?.user.id ?? null
  const persistedViewKey = userId && household ? viewStateKey(userId, household.id) : null

  const {
    recipes, roster, queue, vocabulary, tags,
    ready: dataReady, reload: loadData, setRoster, setQueue,
  } = useHouseholdData(household, setError)

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
  function restoreScroll(nextTab: Tab, reason: string) {
    const target = scrollByTab.current[nextTab] ?? 0
    if (target <= 0) {
      trace('restore-skipped', { reason, tab: nextTab })
      return
    }
    const startedAt = Date.now()
    let frames = 0
    const attempt = () => {
      // Somewhere else now, or the household has taken over. Either way this
      // restore is answering a question nobody is asking any more.
      if (tabRef.current !== nextTab) return
      if (interactionAt.current > startedAt) {
        trace('restore-abandoned', { reason, tab: nextTab, target, y: window.scrollY })
        return
      }
      const scrollHeight = document.documentElement.scrollHeight
      if (reaches({ scrollHeight, innerHeight: window.innerHeight, target })) {
        window.scrollTo(0, target)
        trace('restore', { reason, tab: nextTab, target, frames, y: window.scrollY, vp: visualTop() })
        holdPosition(nextTab, target, reason)
        return
      }
      if (Date.now() - startedAt < RESTORE_PATIENCE_MS) {
        frames += 1
        window.requestAnimationFrame(attempt)
        return
      }
      trace('restore-gave-up', { reason, tab: nextTab, target, frames, reachable: Math.max(0, Math.round(scrollHeight - window.innerHeight)) })
    }
    window.requestAnimationFrame(attempt)
  }

  /**
   * Scrolling back once is not enough, because the phone is not finished.
   *
   * iOS hands the app back and then moves the web view again a moment later —
   * after the restore has already reported success, which is how a trace can
   * show the position landing and the household still see the top of the page.
   * So the position is held for a moment afterwards rather than set once.
   *
   * The correction rides the scroll event itself, not a timer: the phone tells
   * us it moved the page in the same frame it moves it, and putting the page
   * back a fixed 300ms later is a jump you can watch happen. The timers stay
   * behind it only to catch a move that arrives without a scroll event.
   */
  function holdPosition(nextTab: Tab, target: number, reason: string) {
    hold.current = { tab: nextTab, target, reason, startedAt: Date.now(), until: Date.now() + HOLD_MS }
    for (const after of [300, 900, 1800]) window.setTimeout(() => correctDrift(`t${after}`), after)
  }

  /**
   * Put the page back if it has drifted off the position we just restored.
   * Answers true when it did, so the caller knows the movement is accounted
   * for. A touch since the restore ends the hold: wherever the household has
   * scrolled to is where they meant to be, and the app must not argue.
   */
  function correctDrift(from: string) {
    const held = hold.current
    if (!held) return false
    if (Date.now() > held.until || tabRef.current !== held.tab || interactionAt.current > held.startedAt) {
      hold.current = null
      return false
    }
    const y = window.scrollY
    const vp = visualTop()
    if (!hasDrifted({ target: held.target, y, vp })) return false
    // A page too short to hold the position clamps every correction, and the
    // clamp reports as another drift — which on the phone became forty
    // corrections in one second, the app arguing with a page that had nothing
    // on it. Hand over to the restore, which waits for the height instead.
    if (!reaches({ scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight, target: held.target })) {
      hold.current = null
      trace('restore-waiting', { reason: held.reason, tab: held.tab, target: held.target, from, y, vp })
      restoreScroll(held.tab, held.reason)
      return true
    }
    window.scrollTo(0, held.target)
    const landed = window.scrollY
    trace('restore-again', { reason: held.reason, tab: held.tab, target: held.target, from, y, vp, now: landed })
    // A page that has come back shorter than it was clamps the correction to
    // whatever it can reach. Hand it to the restore, which waits for the
    // height instead of assuming it.
    if (Math.abs(landed - held.target) > 8) restoreScroll(held.tab, held.reason)
    return true
  }

  /**
   * Note where the page is, if the page is somewhere worth noting.
   *
   * Every writer of `scrollByTab` comes through here, so one place decides
   * what counts as the household's own scrolling and one place records the
   * decision. A hidden page is the system moving the web view as it
   * backgrounds the app, and a modal parks the body at the top through
   * `position: fixed` and reports zero; saving either overwrites the position
   * we mean to come back to.
   */
  function captureScroll(from: string) {
    const y = window.scrollY
    if (document.visibilityState === 'hidden') {
      trace('capture-skipped', { from, y, vp: visualTop(), why: 'hidden' })
      return
    }
    if (document.body.style.position === 'fixed') {
      trace('capture-skipped', { from, y, vp: visualTop(), why: 'modal' })
      return
    }
    scrollByTab.current[tabRef.current] = keepable(y)
    trace('capture', { from, tab: tabRef.current, y, vp: visualTop() })
  }

  function persistViewState(reason: string) {
    if (!persistedViewKey || !viewStateReady) return
    const state: PersistedViewState = {
      version: 1,
      tab: tabRef.current,
      scrollByTab: { ...scrollByTab.current },
      expandedRecipeId: expandedRecipeRef.current,
      savedAt: Date.now(),
    }
    if (writeViewState(persistedViewKey, state)) {
      trace('write', { reason, tab: state.tab, y: state.scrollByTab[state.tab] })
    }
  }

  function changeTab(nextTab: Tab) {
    captureScroll('tab')
    tabRef.current = nextTab
    setTab(nextTab)
    persistViewState('tab')
    restoreScroll(nextTab, 'tab')
  }

  function changeExpandedRecipe(recipeId: string | null) {
    expandedRecipeRef.current = recipeId
    setLibraryExpanded(recipeId)
    persistViewState('expand')
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
        setViewStateReady(false)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const findHousehold = useCallback(async () => {
    if (!userId) return
    setSetupChecked(false)
    setError(null)
    const { data: memberships, error: membershipError } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', userId)
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
        .eq('owner_id', userId)
        .limit(1)
      householdId = owned?.[0]?.id
      if (householdId) {
        const { error: repairError } = await supabase.from('household_members').insert({
          household_id: householdId,
          user_id: userId,
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
  }, [userId])

  useEffect(() => {
    if (userId) void findHousehold()
  }, [userId, findHousehold])

  useEffect(() => {
    setViewStateReady(false)
  }, [household?.id])

  useEffect(() => {
    if (!persistedViewKey || !dataReady) return
    const saved = readViewState(persistedViewKey)
    const nextTab = saved?.tab ?? 'current'
    const positions = positionsFrom(saved)
    trace('load', {
      nav: navigationKind(),
      tab: nextTab,
      y: positions[nextTab],
      age: saved ? Math.round((Date.now() - saved.savedAt) / 1000) : -1,
      kept: saved ? Date.now() - saved.savedAt < SCROLL_MEMORY_MS : false,
    })
    const expandedStillExists = saved?.expandedRecipeId
      ? recipes.some((recipe) => recipe.id === saved.expandedRecipeId && !recipe.deleted_at)
      : false
    scrollByTab.current = positions
    tabRef.current = nextTab
    expandedRecipeRef.current = expandedStillExists ? saved?.expandedRecipeId ?? null : null
    setTab(nextTab)
    setLibraryExpanded(expandedRecipeRef.current)
    setViewStateReady(true)
    restoreScroll(nextTab, 'load')
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
    // What each movement of the page means is decided in one place, by the
    // rules in `scrollMemory`. What is left here is the wiring: the page's
    // events in, a position remembered or a drift corrected out.
    const gesture = createGesture({ momentumMs: MOMENTUM_MS })
    let stillTimer = 0

    /** Take the position once the page has stopped moving. */
    const waitForStillness = () => {
      window.clearTimeout(stillTimer)
      stillTimer = window.setTimeout(() => {
        if (gesture.rest()) captureScroll('settle')
      }, STILL_MS)
    }
    const startGesture = () => {
      gesture.start(window.scrollY)
      interactionAt.current = Date.now()
    }
    const endGesture = () => {
      interactionAt.current = Date.now()
      window.clearTimeout(stillTimer)
      if (gesture.end(Date.now())) waitForStillness()
    }
    const notePointer = () => {
      const now = Date.now()
      gesture.pointer(now)
      interactionAt.current = now
    }
    const rememberScroll = () => {
      switch (gesture.scroll(window.scrollY, Date.now())) {
        case 'gesture':
          captureScroll('scroll')
          return
        case 'coast':
          captureScroll('coast')
          waitForStillness()
          return
        default:
          window.clearTimeout(stillTimer)
          if (!correctDrift('scroll')) trace('scroll-ignored', { y: window.scrollY, vp: visualTop() })
      }
    }

    const save = (reason: string) => {
      captureScroll(reason)
      persistViewState(reason)
    }
    const onVisibilityChange = () => {
      // Whatever gesture was still settling belongs to the moment before the
      // app went away. Android holds the timer while the app is backgrounded
      // and runs it on the way back, by which time the page has been moved to
      // the top by the system — and the settled position it records is a zero
      // that overwrites the very place we are about to restore.
      gesture.cancel()
      window.clearTimeout(stillTimer)
      const state = document.visibilityState
      trace('visibility', { state, y: window.scrollY, vp: visualTop() })
      if (state === 'hidden') save('hide')
      else restoreScroll(tabRef.current, 'visible')
    }
    const onPageHide = (event: PageTransitionEvent) => {
      trace('pagehide', { persisted: event.persisted, y: window.scrollY, vp: visualTop() })
      save('pagehide')
    }
    const restoreOnReturn = (event: PageTransitionEvent) => {
      trace('pageshow', { persisted: event.persisted, y: window.scrollY, vp: visualTop() })
      if (event.persisted) restoreScroll(tabRef.current, 'pageshow')
    }
    // Chrome and Android freeze a backgrounded tab instead of unloading it;
    // Safari does not fire these at all, and its absence is itself a finding.
    const onFreeze = () => { trace('freeze', { y: window.scrollY, vp: visualTop() }); save('freeze') }
    const onResume = () => { trace('resume', { y: window.scrollY, vp: visualTop() }); restoreScroll(tabRef.current, 'resume') }
    window.addEventListener('touchstart', startGesture, { passive: true })
    window.addEventListener('touchend', endGesture, { passive: true })
    window.addEventListener('touchcancel', endGesture, { passive: true })
    window.addEventListener('wheel', notePointer, { passive: true })
    window.addEventListener('keydown', notePointer)
    window.addEventListener('scroll', rememberScroll, { passive: true })
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', restoreOnReturn)
    document.addEventListener('visibilitychange', onVisibilityChange)
    document.addEventListener('freeze', onFreeze)
    document.addEventListener('resume', onResume)
    return () => {
      save('teardown')
      window.clearTimeout(stillTimer)
      window.removeEventListener('touchstart', startGesture)
      window.removeEventListener('touchend', endGesture)
      window.removeEventListener('touchcancel', endGesture)
      window.removeEventListener('wheel', notePointer)
      window.removeEventListener('keydown', notePointer)
      window.removeEventListener('scroll', rememberScroll)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', restoreOnReturn)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      document.removeEventListener('freeze', onFreeze)
      document.removeEventListener('resume', onResume)
    }
  }, [persistedViewKey, viewStateReady])

  /**
   * The phone's back button, which on Android is how everything is closed.
   *
   * Anything open takes it first — dialogs register themselves. With nothing
   * open, back from any other tab returns to the menu, and from the menu it
   * leaves the app, which is what the household expects of every other app on
   * the phone.
   */
  useEffect(() => {
    const onPop = () => { backNav.onPop() }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // One entry for being away from the menu, not one per tab. Registering
  // again on every switch means a drop and an add in the same breath, and
  // going back is asynchronous — the queued back lands after the new push and
  // undoes it, so the app walks off its own page a few taps later.
  const awayFromMenu = tab !== 'current'
  useEffect(() => {
    if (!awayFromMenu) return
    const remove = backNav.add('tab', () => changeTab('current'))
    return () => { remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awayFromMenu])

  useEffect(() => {
    trace('boot', { nav: navigationKind(), ...environment(), y: window.scrollY, vp: visualTop() })
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
    const { data, error: joinError } = await supabase.rpc('join_household', {
      p_invite_code: code,
      p_display_name: displayName.trim() || null,
    })
    // A wrong code answers null rather than raising: the attempt has to be
    // recorded for the rate limit, and an exception would roll that away with
    // it. Only being throttled comes back as an error.
    if (joinError) setError(joinError.message)
    else if (!data) setError('Neteisingas virtuvės kodas.')
    else await findHousehold()
    setLoading(false)
  }


  const categoryIndex = useMemo(() => buildCategoryIndex(barboraCategories), [barboraCategories])

  const { createIngredient, updateIngredient, deleteIngredient } = useVocabulary({
    household, recipes, categoryIndex, reload: loadData, onError: setError, onMessage: setMessage,
  })
  const { createRecipeCategory, updateRecipeCategory, deleteRecipeCategory } = useRecipeCategories({
    household, recipes, tags, reload: loadData, onError: setError, onMessage: setMessage,
  })
  const { saveRecipe, saveImported, softDelete, restoreRecipe } = useRecipeWriting({
    household, userId, vocabulary, recipes, tags, recipeCategories,
    reload: loadData, onError: setError, onMessage: setMessage, setBusy: setLoading,
    dismissEditor: () => setEditor(null), dismissImporter: () => setImportOpen(false),
  })
  const { undo, planRecipe, resolveEntry, undoResolution, removeFromQueue, completeShopping } = usePlanning({
    household, userId, queue, reload: loadData, onError: setError, onMessage: setMessage,
    setBusy: setLoading, setRoster, setQueue, showMenu: () => changeTab('current'),
  })

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
      // A recipe in the bin buys nothing: `complete_shopping` refuses to turn
      // it into a meal, so listing its ingredients promises a dinner that will
      // not happen. The menu has always taken this view; the basket did not.
      if (!recipe || recipe.deleted_at) return
      recipe.recipe_ingredients.forEach((ingredient) => {
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
  if (showsSetupSplash({ setupChecked, hasHousehold: household !== null })) return <Splash />
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

/**
 * The loading screen — and a witness to itself.
 *
 * The household reports seeing this whenever they come back to the app, on a
 * page the trace shows was never reloaded. Either it renders or it does not,
 * and only the app can say which: what iOS and Android paint over a resuming
 * web app is a stored image of an earlier launch, not this component.
 */
function Splash() {
  useEffect(() => {
    const shownAt = Date.now()
    trace('splash', { shown: 'yes' })
    return () => trace('splash', { shown: 'gone', ms: Date.now() - shownAt })
  }, [])
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
            : <label>Pakvietimo kodas<input className="code-input" required maxLength={20} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /></label>}
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
              if (!recipe || recipe.deleted_at) return null
              return <div className="queue-chip" key={entry.id}><span>{recipe.title}</span><button aria-label={`Pašalinti „${recipe.title}“`} onClick={() => onRemove(entry)}>×</button></div>
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
