import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal } from './Modal'

type Ask = (message: string) => Promise<boolean>
const Confirmation = createContext<Ask | null>(null)
/** Use the shared accessible sheet for confirmations, including nested settings. */
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const pending = useRef<((accepted: boolean) => void) | null>(null)
  const ask = useCallback<Ask>(message => new Promise(resolve => {
    pending.current?.(false)
    pending.current = resolve
    setMessage(message)
  }), [])
  const finish = (accepted: boolean) => {
    const resolve = pending.current
    pending.current = null
    setMessage(null)
    resolve?.(accepted)
  }
  useEffect(() => () => { pending.current?.(false) }, [])
  return <Confirmation.Provider value={ask}>{children}{message &&
    <Modal title="Patvirtinti veiksmą" onClose={() => finish(false)}>
      <p className="confirmation-message">{message}</p>
      <div className="button-row"><button className="button secondary" autoFocus onClick={() => finish(false)}>Atšaukti</button><button className="button primary" onClick={() => finish(true)}>Patvirtinti</button></div>
    </Modal>}
  </Confirmation.Provider>
}
export function useConfirmation() {
  const ask = useContext(Confirmation)
  if (!ask) throw new Error('ConfirmationProvider is required')
  return ask
}
