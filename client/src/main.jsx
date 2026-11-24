import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// The code calls the API as "/api/...". When the app is built for a sub-path (production:
// /akanksha-ai/), those calls must carry the prefix so nginx routes them to this app.
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '')
if (BASE) {
  const plainFetch = window.fetch.bind(window)
  window.fetch = (input, init) => plainFetch(typeof input === 'string' && input.startsWith('/api/') ? BASE + input : input, init)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
