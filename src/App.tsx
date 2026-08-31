import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { parseRecipeList, titleSimilarity } from './lib/parser'
import type { Household, QueueEntry, Recipe, RecipeDraft, RosterEntry } from './lib/types'

type Tab = 'current' | 'library' | 'shop' | 'deleted'
type RecipeDestination = 'library' | 'queue'

const blankDraft = (): RecipeDraft => ({ title: '', ingredients: [], notes: '', sourceUrl: '' })

function formatRelative(dateValue: string | null) {
  if (!dateValue) return 'Never'
  const days = Math.floor((Date.now() - new Date(dateValue).getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

function barboraUrl(item: string) {
  return `https://barbora.lt/paieska?q=${encodeURIComponent(item)}`
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [household, setHousehold] = useState<Household | null>(null)
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
    const [recipeResult, rosterResult, queueResult] = await Promise.all([
      supabase
        .from('recipes')
        .select('*, recipe_ingredients(*)')
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
    ])
    const firstError = recipeResult.error || rosterResult.error || queueResult.error
    if (firstError) {
      setError(firstError.message)
      return
    }
    setRecipes((recipeResult.data || []) as Recipe[])
    setRoster((rosterResult.data || []) as RosterEntry[])
    setQueue((queueResult.data || []) as QueueEntry[])
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
    ;['recipes', 'recipe_ingredients', 'roster_entries', 'shopping_queue'].forEach((table) => {
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
      const { error: ingredientError } = await supabase.from('recipe_ingredients').insert(
        cleanedIngredients.map((item, position) => ({
          household_id: household.id,
          recipe_id: recipeId,
          item,
          position,
        })),
      )
      if (ingredientError) setError(ingredientError.message)
    }
    if (!existing && destination === 'queue' && recipeId) {
      await supabase.from('shopping_queue').insert({
        household_id: household.id,
        recipe_id: recipeId,
        added_by: session.user.id,
      })
    }
    setEditor(null)
    setMessage(existing ? 'Recipe updated' : destination === 'queue' ? 'Added to the shopping plan' : 'Recipe saved')
    await loadData()
    setLoading(false)
  }

  async function saveImported(drafts: RecipeDraft[]) {
    for (const draft of drafts) await saveRecipe(draft)
    setImportOpen(false)
    setMessage(`${drafts.length} recipe${drafts.length === 1 ? '' : 's'} imported`)
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
    if (result.error?.code === '23505') setMessage('That recipe is already on the shopping list')
    else if (result.error) setError(result.error.message)
    else setMessage(destination === 'queue' ? 'Added to shopping' : 'Added to current recipes')
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
    setUndo({ entryId: entry.id, label: status === 'cooked' ? 'Marked cooked' : 'Skipped' })
    undoTimer.current = window.setTimeout(() => setUndo(null), 30_000)
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
    if (!window.confirm(`Move ${queue.length} planned recipe${queue.length === 1 ? '' : 's'} to Current and clear the shopping list?`)) return
    setLoading(true)
    const { data, error: completeError } = await supabase.rpc('complete_shopping', { p_household_id: household.id })
    if (completeError) setError(completeError.message)
    else {
      setMessage(`Shopping complete — ${data} recipe${data === 1 ? '' : 's'} ready to cook`)
      setTab('current')
      await loadData()
    }
    setLoading(false)
  }

  async function softDelete(recipe: Recipe) {
    if (!session || !window.confirm(`Move “${recipe.title}” to Deleted?`)) return
    const { error: deleteError } = await supabase
      .from('recipes')
      .update({ deleted_at: new Date().toISOString(), deleted_by: session.user.id })
      .eq('id', recipe.id)
    if (deleteError) setError(deleteError.message)
    else {
      setMessage('Recipe moved to Deleted')
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
      setMessage('Recipe restored')
      await loadData()
    }
  }

  const shoppingIngredients = useMemo(() => {
    const grouped = new Map<string, { item: string; recipes: Set<string> }>()
    queue.forEach((entry) => {
      const recipe = recipeById.get(entry.recipe_id)
      recipe?.recipe_ingredients.forEach((ingredient) => {
        const key = ingredient.item.trim().toLocaleLowerCase()
        const group = grouped.get(key) || { item: ingredient.item.trim(), recipes: new Set<string>() }
        group.recipes.add(recipe.title)
        grouped.set(key, group)
      })
    })
    return [...grouped.values()].sort((a, b) => a.item.localeCompare(b.item, 'lt'))
  }, [queue, recipeById])

  if (!authReady) return <Splash />
  if (!session) return <AuthScreen />
  if (!setupChecked) return <Splash />
  if (!household) return <HouseholdSetup loading={loading} error={error} onCreate={createHousehold} onJoin={joinHousehold} />

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{household.name}</p>
          <h1>{tab === 'current' ? 'Ready to cook' : tab === 'library' ? 'Recipe library' : tab === 'shop' ? 'Shopping' : 'Deleted'}</h1>
        </div>
        <button className="icon-button" aria-label="Household settings" onClick={() => setSettingsOpen(true)}>•••</button>
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
            ingredients={shoppingIngredients}
            loading={loading}
            onAdd={() => setPickerOpen(true)}
            onRemove={(entry) => void removeFromQueue(entry)}
            onComplete={() => void completeShopping()}
          />
        )}
        {tab === 'deleted' && <DeletedView recipes={deletedRecipes} onRestore={(recipe) => void restoreRecipe(recipe)} />}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        <NavButton active={tab === 'current'} label="Current" icon="⌂" onClick={() => setTab('current')} />
        <NavButton active={tab === 'library'} label="Library" icon="□" onClick={() => setTab('library')} />
        <NavButton active={tab === 'shop'} label="Shop" icon="⌑" badge={queue.length} onClick={() => setTab('shop')} />
        <NavButton active={tab === 'deleted'} label="Deleted" icon="↶" onClick={() => setTab('deleted')} />
      </nav>

      {editor && (
        <RecipeEditor
          recipe={editor.recipe}
          destination={editor.destination}
          loading={loading}
          onClose={() => setEditor(null)}
          onSave={(draft) => void saveRecipe(draft, editor.recipe, editor.destination)}
        />
      )}
      {importOpen && <ImportDialog loading={loading} onClose={() => setImportOpen(false)} onSave={(drafts) => void saveImported(drafts)} />}
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
        <Modal title="Similar recipes already here" onClose={() => setSimilarPrompt(null)}>
          <p className="muted">You already planned:</p>
          <ul className="plain-list">{similarPrompt.matches.map((match) => <li key={match.id}>{match.title}</li>)}</ul>
          <p>You can still add <strong>{similarPrompt.recipe.title}</strong>.</p>
          <div className="button-row">
            <button className="button secondary" onClick={() => setSimilarPrompt(null)}>Cancel</button>
            <button className="button primary" onClick={() => void planRecipe(similarPrompt.recipe, similarPrompt.destination, true)}>Add anyway</button>
          </div>
        </Modal>
      )}
      {undo && (
        <div className="undo-toast" role="status">
          <span>{undo.label}</span>
          <button onClick={() => void undoResolution()}>Undo</button>
        </div>
      )}
    </div>
  )
}

function Splash() {
  return <div className="splash"><div className="brand-mark">R</div><p>Preparing the kitchen…</p></div>
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
    else if (mode === 'signup' && !result.data.session) setNotice('Check your email to confirm the account, then come back and sign in.')
    setLoading(false)
  }

  return (
    <div className="auth-page">
      <section className="auth-card">
        <div className="brand-mark">R</div>
        <p className="eyebrow">Shared kitchen</p>
        <h1>What should we cook?</h1>
        <p className="lead">Keep the recipes you loved, plan the next batch, and take one tidy list shopping.</p>
        <div className="segmented">
          <button className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Create account</button>
        </div>
        <form onSubmit={submit} className="form-stack">
          <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input type="password" minLength={8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {notice && <p className="form-notice">{notice}</p>}
          <button className="button primary wide" disabled={loading}>{loading ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
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
  const [name, setName] = useState('Our kitchen')
  const [displayName, setDisplayName] = useState('')
  const [code, setCode] = useState('')
  return (
    <div className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">First things first</p>
        <h1>Set up your kitchen</h1>
        <p className="lead">One person creates it. The other joins with the short code.</p>
        <div className="segmented">
          <button className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>Create</button>
          <button className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>Join</button>
        </div>
        <form className="form-stack" onSubmit={(event) => {
          event.preventDefault()
          if (mode === 'create') onCreate(name, displayName)
          else onJoin(code, displayName)
        }}>
          <label>Your name <span className="optional">optional</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          {mode === 'create'
            ? <label>Kitchen name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
            : <label>Invite code<input className="code-input" required maxLength={8} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /></label>}
          {error && <p className="form-notice">{error}</p>}
          <button className="button primary wide" disabled={loading}>{loading ? 'Setting up…' : mode === 'create' ? 'Create kitchen' : 'Join kitchen'}</button>
        </form>
      </section>
    </div>
  )
}

function CurrentView({ entries, recent, recipeById, onCooked, onSkipped, onAdd }: {
  entries: RosterEntry[]
  recent: RosterEntry[]
  recipeById: Map<string, Recipe>
  onCooked: (entry: RosterEntry) => void
  onSkipped: (entry: RosterEntry) => void
  onAdd: () => void
}) {
  return (
    <div className="page-stack">
      <button className="button primary add-meals" onClick={onAdd}>＋ Add meals</button>
      {entries.length === 0 ? (
        <EmptyState title="Nothing waiting to be cooked" text="Add a few meals, shop once, and they will land here." action="Plan meals" onAction={onAdd} />
      ) : (
        <section className="card-grid">
          {entries.map((entry) => {
            const recipe = recipeById.get(entry.recipe_id)
            if (!recipe || recipe.deleted_at) return null
            return (
              <article className="meal-card" key={entry.id}>
                <div className="meal-copy">
                  <p className="eyebrow">Ready</p>
                  <h2>{recipe.title}</h2>
                  <IngredientLine recipe={recipe} />
                  {recipe.notes && <p className="notes">{recipe.notes}</p>}
                </div>
                <div className="resolve-actions">
                  <button className="resolve cooked" onClick={() => onCooked(entry)} aria-label={`Mark ${recipe.title} cooked`}>✓ <span>Cooked</span></button>
                  <button className="resolve skipped" onClick={() => onSkipped(entry)} aria-label={`Skip ${recipe.title}`}>× <span>Skip</span></button>
                </div>
              </article>
            )
          })}
        </section>
      )}
      {recent.length > 0 && (
        <section className="recent-section">
          <div className="section-heading"><div><p className="eyebrow">Last 5 days</p><h2>Recently cooked</h2></div></div>
          <div className="recent-strip">
            {recent.map((entry) => {
              const recipe = recipeById.get(entry.recipe_id)
              return recipe ? <div className="recent-chip" key={entry.id}><span>✓</span><div><strong>{recipe.title}</strong><small>{formatRelative(entry.resolved_at)}</small></div></div> : null
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
  const filtered = recipes.filter((recipe) => `${recipe.title} ${recipe.recipe_ingredients.map((item) => item.item).join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return (
    <div className="page-stack">
      <div className="toolbar">
        <input className="search" type="search" placeholder="Search recipes or ingredients" value={search} onChange={(event) => setSearch(event.target.value)} />
        <button className="button primary" onClick={onAdd}>＋ New</button>
      </div>
      <button className="text-button import-button" onClick={onImport}>Import a pasted recipe list</button>
      {filtered.length === 0 ? <EmptyState title={recipes.length ? 'No matches' : 'Your library is empty'} text={recipes.length ? 'Try another search.' : 'Add one recipe or paste your existing weekly list.'} action={recipes.length ? undefined : 'Add a recipe'} onAction={recipes.length ? undefined : onAdd} /> : (
        <section className="library-list">
          {filtered.map((recipe) => (
            <article className="library-card" key={recipe.id}>
              <div className="library-main">
                <div><p className="eyebrow">Last cooked · {formatRelative(lastCooked(recipe.id))}</p><h2>{recipe.title}</h2></div>
                <IngredientLine recipe={recipe} />
                {recipe.notes && <p className="notes">{recipe.notes}</p>}
                {recipe.source_url && <a className="source-link" href={recipe.source_url} target="_blank" rel="noreferrer">Open original recipe ↗</a>}
              </div>
              <div className="library-actions">
                <button onClick={() => onQueue(recipe)}>Add to shop</button>
                <button onClick={() => onCurrent(recipe)}>Cook now</button>
                <button onClick={() => onEdit(recipe)}>Edit</button>
                <button className="danger-text" onClick={() => onDelete(recipe)}>Delete</button>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  )
}

function ShoppingView({ queue, recipeById, ingredients, loading, onAdd, onRemove, onComplete }: {
  queue: QueueEntry[]
  recipeById: Map<string, Recipe>
  ingredients: { item: string; recipes: Set<string> }[]
  loading: boolean
  onAdd: () => void
  onRemove: (entry: QueueEntry) => void
  onComplete: () => void
}) {
  return (
    <div className="page-stack shop-page">
      <div className="section-heading"><div><p className="eyebrow">Temporary batch</p><h2>{queue.length} meal{queue.length === 1 ? '' : 's'} planned</h2></div><button className="button primary" onClick={onAdd}>＋ Add</button></div>
      {queue.length === 0 ? <EmptyState title="No shopping batch yet" text="Choose all the meals you want before making one combined list." action="Add meals" onAction={onAdd} /> : (
        <>
          <div className="queue-chips">
            {queue.map((entry) => {
              const recipe = recipeById.get(entry.recipe_id)
              return recipe ? <div className="queue-chip" key={entry.id}><span>{recipe.title}</span><button aria-label={`Remove ${recipe.title}`} onClick={() => onRemove(entry)}>×</button></div> : null
            })}
          </div>
          <section className="shopping-card">
            <div className="section-heading"><div><p className="eyebrow">Combined list</p><h2>Ingredients</h2></div><span className="count-pill">{ingredients.length}</span></div>
            {ingredients.length ? <ul className="ingredient-shopping-list">
              {ingredients.map((group) => {
                const titles = [...group.recipes]
                const usage = titles.length === 1 ? `used by ${titles[0]}` : titles.length === 2 ? `used by ${titles[0]} and ${titles[1]}` : `used by ${titles.length} recipes`
                return <li key={group.item}><a href={barboraUrl(group.item)} target="_blank" rel="noreferrer"><strong>{group.item}</strong><span>{usage} · search Barbora ↗</span></a></li>
              })}
            </ul> : <p className="muted">These recipes do not have ingredients yet.</p>}
          </section>
          <button className="button success wide complete-button" disabled={loading} onClick={onComplete}>✓ Shopping complete</button>
          <p className="center-note">This moves every planned meal to Current and resets this list.</p>
        </>
      )}
    </div>
  )
}

function DeletedView({ recipes, onRestore }: { recipes: Recipe[]; onRestore: (recipe: Recipe) => void }) {
  return recipes.length === 0
    ? <EmptyState title="Deleted is empty" text="Removed recipes stay recoverable here." />
    : <section className="library-list">{recipes.map((recipe) => <article className="library-card" key={recipe.id}><div className="library-main"><p className="eyebrow">Deleted · {formatRelative(recipe.deleted_at)}</p><h2>{recipe.title}</h2><IngredientLine recipe={recipe} /></div><button className="button secondary" onClick={() => onRestore(recipe)}>Restore</button></article>)}</section>
}

function IngredientLine({ recipe }: { recipe: Recipe }) {
  const sorted = [...recipe.recipe_ingredients].sort((a, b) => a.position - b.position)
  return sorted.length ? <p className="ingredients">{sorted.map((ingredient) => ingredient.item).join(' · ')}</p> : <p className="ingredients empty">No ingredients added</p>
}

function RecipeEditor({ recipe, destination, loading, onClose, onSave }: {
  recipe?: Recipe
  destination: RecipeDestination
  loading: boolean
  onClose: () => void
  onSave: (draft: RecipeDraft) => void
}) {
  const [draft, setDraft] = useState<RecipeDraft>(() => recipe ? {
    title: recipe.title,
    ingredients: [...recipe.recipe_ingredients].sort((a, b) => a.position - b.position).map((item) => item.item),
    notes: recipe.notes || '',
    sourceUrl: recipe.source_url || '',
  } : blankDraft())
  const [ingredientText, setIngredientText] = useState(draft.ingredients.join(', '))
  return (
    <Modal title={recipe ? 'Edit recipe' : destination === 'queue' ? 'New meal' : 'New recipe'} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault()
        onSave({ ...draft, ingredients: ingredientText.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean) })
      }}>
        <label>Dish name<input autoFocus required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Pasta e ceci" /></label>
        <label>Ingredients <span className="optional">comma or new line separated</span><textarea required rows={4} value={ingredientText} onChange={(event) => setIngredientText(event.target.value)} placeholder="pasta, chickpeas, tomatoes, garlic" /></label>
        <label>At-a-glance steps <span className="optional">optional</span><textarea rows={4} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Any details worth remembering…" /></label>
        <label>Source link <span className="optional">optional</span><input type="url" value={draft.sourceUrl} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} placeholder="https://…" /></label>
        <button className="button primary wide" disabled={loading}>{loading ? 'Saving…' : recipe ? 'Save changes' : destination === 'queue' ? 'Save and add to shopping' : 'Save recipe'}</button>
      </form>
    </Modal>
  )
}

function ImportDialog({ loading, onClose, onSave }: { loading: boolean; onClose: () => void; onSave: (drafts: RecipeDraft[]) => void }) {
  const [raw, setRaw] = useState('')
  const [drafts, setDrafts] = useState<RecipeDraft[] | null>(null)
  if (!drafts) return (
    <Modal title="Import a recipe list" onClose={onClose}>
      <p className="muted">Paste one dish per line. A dash separates its name from comma-separated ingredients. Checkboxes and numbering are removed.</p>
      <textarea className="import-area" rows={10} value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="[ ] 1. Pasta e ceci — makaronai, avinžirniai, pomidorai" />
      <p className="fine-print">The importer preserves the original language. You can edit every preview before saving.</p>
      <button className="button primary wide" disabled={!raw.trim()} onClick={() => setDrafts(parseRecipeList(raw))}>Preview recipes</button>
    </Modal>
  )
  return (
    <Modal title={`Review ${drafts.length} recipe${drafts.length === 1 ? '' : 's'}`} onClose={onClose} wide>
      <div className="import-preview">
        {drafts.map((draft, index) => <div className="preview-card" key={index}>
          <div className="preview-number">{index + 1}</div>
          <label>Dish<input value={draft.title} onChange={(event) => setDrafts(drafts.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /></label>
          <label>Ingredients<textarea rows={3} value={draft.ingredients.join(', ')} onChange={(event) => setDrafts(drafts.map((item, itemIndex) => itemIndex === index ? { ...item, ingredients: event.target.value.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean) } : item))} /></label>
          <button className="text-button danger-text" onClick={() => setDrafts(drafts.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
        </div>)}
      </div>
      <div className="button-row sticky-actions"><button className="button secondary" onClick={() => setDrafts(null)}>Back</button><button className="button primary" disabled={loading || drafts.length === 0 || drafts.some((draft) => !draft.title.trim())} onClick={() => onSave(drafts)}>{loading ? 'Importing…' : `Import ${drafts.length}`}</button></div>
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
  const filtered = recipes.filter((recipe) => recipe.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return (
    <Modal title="Add meals" onClose={onClose}>
      <div className="picker-actions"><input autoFocus className="search" type="search" placeholder="Find a recipe" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="button secondary" onClick={onNew}>＋ New</button></div>
      <div className="picker-list">{filtered.map((recipe) => <button className="picker-row" key={recipe.id} disabled={queuedIds.has(recipe.id)} onClick={() => onPick(recipe)}><span><strong>{recipe.title}</strong><small>{recipe.recipe_ingredients.length} ingredients</small></span><span>{queuedIds.has(recipe.id) ? 'Added' : '＋'}</span></button>)}</div>
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
    <Modal title="Your kitchen" onClose={onClose}>
      <p className="muted">Share this code with the other person after they create their own account.</p>
      <button className="invite-code" onClick={() => void copyCode()}><span>{household.invite_code}</span><small>{copied ? 'Copied!' : 'Tap to copy'}</small></button>
      <div className="settings-meta"><span>Signed in as</span><strong>{email}</strong></div>
      <button className="button secondary wide" onClick={() => void supabase.auth.signOut()}>Sign out</button>
    </Modal>
  )
}

function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal ${wide ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}>×</button></header><div className="modal-body">{children}</div></section></div>
}

function Banner({ tone = 'info', onClose, children }: { tone?: 'info' | 'error'; onClose: () => void; children: React.ReactNode }) {
  return <div className={`banner ${tone}`} role={tone === 'error' ? 'alert' : 'status'}><span>{children}</span><button onClick={onClose}>×</button></div>
}

function EmptyState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <section className="empty-state"><div className="empty-icon">◇</div><h2>{title}</h2><p>{text}</p>{action && onAction && <button className="button secondary" onClick={onAction}>{action}</button>}</section>
}

function NavButton({ active, label, icon, badge, onClick }: { active: boolean; label: string; icon: string; badge?: number; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick}><span className="nav-icon">{icon}{badge ? <i>{badge}</i> : null}</span><span>{label}</span></button>
}

export default App
