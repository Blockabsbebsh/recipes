import { useEffect, useMemo, useState } from 'react'
import { cuisineFor, dishTypeFor, recipeTagNames } from '../lib/categories'
import { normalizeTitle } from '../lib/parser'
import { daysSinceCooked, facetCounts, liveChoice, orderLibrary, suggestRecipes } from '../lib/library'
import type { LibrarySort } from '../lib/library'
import type { Recipe } from '../lib/types'
import { ChevronIcon, CloseIcon, SearchIcon, FilterIcon } from './icons'
import { Modal } from './Modal'

function useCalendarDay() {
  const [day, setDay] = useState(() => new Date().toDateString())
  useEffect(() => {
    let timer: number
    const refresh = () => {
      const now = new Date()
      setDay(now.toDateString())
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 50)
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  return day
}

export function LibraryView({ recipes, categories, cuisines, lastCooked, expanded, onExpandedChange, onAdd, readyIds, queuedIds }: {
  recipes: Recipe[]; categories: string[]; cuisines: string[]; lastCooked: (id: string) => string | null
  expanded: string | null; onExpandedChange: (id: string | null) => void; onAdd: () => void
  readyIds: Set<string>; queuedIds: Set<string>
}) {
  const [search, setSearch] = useState('')
  const [onlyType, setOnlyType] = useState<string | null>(null)
  const [onlyCuisine, setOnlyCuisine] = useState<string | null>(null)
  const [sort, setSort] = useState<LibrarySort>('title')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const day = useCalendarDay()
  const needle = normalizeTitle(search)
  const entries = useMemo(() => recipes.map(recipe => ({ recipe, id: recipe.id, title: recipe.title,
    dishType: dishTypeFor(recipe), cuisine: cuisineFor(recipe), lastCooked: lastCooked(recipe.id) })), [recipes, lastCooked])
  const matches = entries.filter(entry => !needle || normalizeTitle(`${entry.title} ${entry.recipe.recipe_ingredients.map(item => item.item).join(' ')} ${recipeTagNames(entry.recipe).join(' ')}`).includes(needle))
  const typeOptions = facetCounts(matches.filter(entry => !onlyCuisine || entry.cuisine === onlyCuisine), 'dishType', categories)
  const cuisineOptions = facetCounts(matches.filter(entry => !onlyType || entry.dishType === onlyType), 'cuisine', cuisines)
  const activeType = liveChoice(onlyType, typeOptions)
  const activeCuisine = liveChoice(onlyCuisine, cuisineOptions)
  const filtered = matches.filter(entry => (!activeType || entry.dishType === activeType) && (!activeCuisine || entry.cuisine === activeCuisine))
  const shown = orderLibrary(filtered, sort, categories)
  // Queue IDs only prevent duplicate planning; ingredients never influence suggestions.
  const suggestions = useMemo(() => suggestRecipes(entries, new Set([...readyIds, ...queuedIds]), new Date(day)), [entries, readyIds, queuedIds, day])
    .filter(({ entry }) => (!activeType || entry.dishType === activeType) && (!activeCuisine || entry.cuisine === activeCuisine))
  const activeCount = Number(!!activeType) + Number(!!activeCuisine)
  return <div className="page-stack library-page">
    <div className="library-head">
      <div className="search-field"><SearchIcon size={20} /><input className="search" type="search" aria-label="Ieškoti receptų ar produktų" placeholder="Ieškoti receptų ar produktų" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <div className="library-tools">
        <button className="button secondary filters-button" onClick={() => setFiltersOpen(true)}><FilterIcon size={18} /> Filtrai{activeCount > 0 && <span className="count-pill">{activeCount}</span>}</button>
        <label className="pill-select"><span className="visually-hidden">Rūšiavimas</span><select value={sort} onChange={event => setSort(event.target.value as LibrarySort)}><option value="title">Pagal pavadinimą</option><option value="type">Pagal tipą</option><option value="stale">Seniausiai gaminti</option></select></label>
      </div>
      {activeCount > 0 && <div className="active-filters" aria-label="Pasirinkti filtrai">
        {activeType && <button onClick={() => setOnlyType(null)} aria-label={`Pašalinti filtrą „${activeType}“`}>{activeType}<CloseIcon size={16} /></button>}
        {activeCuisine && <button onClick={() => setOnlyCuisine(null)} aria-label={`Pašalinti filtrą „${activeCuisine}“`}>{activeCuisine}<CloseIcon size={16} /></button>}
      </div>}
    </div>
    {!needle && suggestions.length > 0 && <section className="library-suggestions" aria-label="Ką gaminti toliau?">
      <div className="section-heading"><h2>Ką gaminti toliau?</h2><span className="result-count">{suggestions.length === 1 ? '1 idėja' : '2 idėjos'}</span></div>
      {suggestions.map(({ entry, kind, days }) => <button key={entry.id} className={`suggestion ${kind}`} onClick={() => onExpandedChange(entry.id)}>
        <span><strong>{entry.title}</strong><small>{kind === 'familiar' ? `Verta prisiminti · gaminta prieš ${days} d.` : 'Išbandykite · gaminimas dar nepažymėtas'}</small></span><ChevronIcon size={18} />
      </button>)}
    </section>}
    <div className="section-heading library-results"><h2>{needle || activeCount ? 'Rasti receptai' : 'Visi receptai'}</h2><span className="result-count" role="status" aria-live="polite">{shown.length}</span></div>
    {shown.length === 0 ? <div className="empty-state"><h2>{recipes.length ? 'Nieko nerasta' : 'Receptų nėra'}</h2><p>{recipes.length ? 'Pabandykite kitą paiešką arba pakeiskite filtrus.' : 'Pridėkite pirmą receptą arba importuokite turimą sąrašą.'}</p>{!recipes.length && <button className="button primary" onClick={onAdd}>Pridėti receptą</button>}</div> :
      <div className="recipe-tile-grid">{shown.map(entry => {
        const days = entry.lastCooked ? daysSinceCooked(entry.lastCooked) : null
        return <article className={`recipe-tile ${expanded === entry.id ? 'expanded' : ''}`} key={entry.id}>
          <button className="recipe-tile-summary" aria-haspopup="dialog" aria-expanded={expanded === entry.id} onClick={() => onExpandedChange(entry.id)}>
            <span className="recipe-tile-copy"><strong>{entry.title}</strong><span className="recipe-tile-meta"><span>{entry.dishType}</span><span>Produktai: {entry.recipe.recipe_ingredients.length}</span></span>
              {(readyIds.has(entry.id) || queuedIds.has(entry.id) || days !== null) && <small className="recipe-state">{readyIds.has(entry.id) ? 'Meniu' : queuedIds.has(entry.id) ? 'Krepšelyje' : days === 0 ? 'Gaminta šiandien' : days === 1 ? 'Gaminta vakar' : `Gaminta prieš ${days} d.`}</small>}
            </span><ChevronIcon size={18} />
          </button>
        </article>
      })}</div>}
    {filtersOpen && <Modal title="Filtrai" onClose={() => setFiltersOpen(false)}><div className="form-stack">
      <label>Patiekalo tipas<select value={activeType ?? ''} onChange={event => setOnlyType(event.target.value || null)}><option value="">Visi tipai</option>{typeOptions.map(option => <option key={option.name} value={option.name}>{option.name} ({option.count})</option>)}</select></label>
      <label>Virtuvė<select value={activeCuisine ?? ''} onChange={event => setOnlyCuisine(event.target.value || null)}><option value="">Visos virtuvės</option>{cuisineOptions.map(option => <option value={option.name} key={option.name}>{option.name} ({option.count})</option>)}</select></label>
      <div className="button-row"><button className="button secondary" onClick={() => { setOnlyType(null); setOnlyCuisine(null) }}>Išvalyti filtrus</button><button className="button primary" onClick={() => setFiltersOpen(false)}>Rodyti receptus</button></div>
    </div></Modal>}
  </div>
}
