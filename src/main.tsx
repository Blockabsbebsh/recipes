import { ConfirmationProvider } from './components/Confirmation'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { readDebugFlagFromUrl } from './lib/debugFlags'
import './styles.css'

readDebugFlagFromUrl()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmationProvider><App /></ConfirmationProvider>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(console.error)
  })
}
