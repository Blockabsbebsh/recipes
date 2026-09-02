import type { CategoryIndex } from '../lib/barboraMapping'
import { clearTrace, formatTrace, readTrace, trace } from '../lib/scrollTrace'
import { supabase } from '../lib/supabase'
import type { Household, HouseholdTag, IngredientSection, Recipe, VocabularyIngredient } from '../lib/types'
import { IngredientsManager } from './IngredientsManager'
import { Modal } from './Modal'
import { RecipeCategoriesManager } from './RecipeCategoriesManager'
import { useEffect, useState } from 'react'
import { backNav } from '../lib/backNav'

export function SettingsDialog({ household, email, vocabulary, recipes, categories, categoryIndex, onCreateIngredient, onUpdateIngredient, onDeleteIngredient, onCreateCategory, onUpdateCategory, onDeleteCategory, onClose }: {
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
  const [view, setView] = useState<'menu' | 'invite' | 'ingredients' | 'categories' | 'trace'>('menu')
  /**
   * Settings has pages inside one dialog rather than a dialog each, so the
   * back button saw a single layer and closed the lot. A page of its own is a
   * place you can come back from, whether or not it happens to be a dialog.
   *
   * One entry for being off the menu, not one per page: registering again on
   * every move would drop and add in the same breath, and going back is
   * asynchronous.
   */
  const insidePage = view !== 'menu'
  useEffect(() => {
    if (!insidePage) return
    const remove = backNav.add('settings-view', () => setView('menu'))
    return () => { remove() }
  }, [insidePage])
  const [copied, setCopied] = useState(false)
  async function copyCode() {
    await navigator.clipboard.writeText(household.invite_code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  const title = view === 'invite' ? 'Pakviesti prisijungti' : view === 'ingredients' ? 'Ingredientai' : view === 'categories' ? 'Receptų kategorijos' : view === 'trace' ? 'Slinkties žurnalas' : 'Nustatymai'
  return (
    <Modal title={title} onClose={onClose} wide={view === 'ingredients'}>
      {view === 'menu' && <>
        <div className="settings-options">
          <button onClick={() => setView('invite')}><span><strong>Pakviesti prisijungti</strong><small>Virtuvės kodas kitam žmogui</small></span><b>›</b></button>
          <button onClick={() => setView('ingredients')}><span><strong>Ingredientai</strong><small>Pavadinimai ir skyriai parduotuvėje</small></span><b>›</b></button>
          <button onClick={() => setView('categories')}><span><strong>Receptų kategorijos</strong><small>Grupės receptų bibliotekoje</small></span><b>›</b></button>
          <button onClick={() => setView('trace')}><span><strong>Slinkties žurnalas</strong><small>Ką programa įsiminė perjungiant programas</small></span><b>›</b></button>
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
      {view === 'trace' && <>
        <SettingsBack onClick={() => setView('menu')} />
        <ScrollTrace />
      </>}
    </Modal>
  )
}

/**
 * The scroll trace, printed.
 *
 * Nothing here helps with cooking. It is for the one question the console
 * cannot answer, because the phone reloads the app before you can attach one:
 * when you come back from another app and the page is at the top, was the
 * position already lost before we left, or lost on the way back in?
 */
export function ScrollTrace() {
  const [entries, setEntries] = useState(() => readTrace())
  const [copied, setCopied] = useState(false)
  const text = formatTrace(entries)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard access can be refused; the text is on screen either way.
    }
  }
  return <>
    <p className="muted">
      Naujausi įrašai apačioje. <code>capture</code> — įsiminta padėtis, <code>write</code> — įrašyta į atmintį,
      <code> restore</code> — grąžinta, <code>splash</code> — rodytas užkrovimo langas, <code>boot</code> — programa
      pasileido iš naujo. „Pažymėti“ įrašo žymą — paspauskite iškart po to, ką norite parodyti.
      Perjunkite programą, grįžkite ir pažiūrėkite paskutines eilutes.
    </p>
    <div className="trace-actions">
      <button className="button secondary" onClick={() => void copy()}>{copied ? 'Nukopijuota!' : 'Kopijuoti'}</button>
      <button className="button secondary" onClick={() => setEntries(readTrace())}>Atnaujinti</button>
      {/* So the log can carry what only the household saw. */}
      <button className="button secondary" onClick={() => { trace('mark', { note: 'pastebėta' }); setEntries(readTrace()) }}>Pažymėti</button>
      <button className="button secondary" onClick={() => { clearTrace(); setEntries([]) }}>Išvalyti</button>
    </div>
    <pre className="scroll-trace">{text}</pre>
  </>
}

export function SettingsBack({ onClick }: { onClick: () => void }) {
  return <button className="settings-back" onClick={onClick}>← Visi nustatymai</button>
}
