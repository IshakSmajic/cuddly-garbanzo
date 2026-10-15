import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase.ts'

type Status = 'checking' | 'connected' | 'unreachable'

// Placeholder until milestone 2 builds the sign-in screen from design/sign-in.png.
function App() {
  const [status, setStatus] = useState<Status>('checking')

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ error }) => setStatus(error ? 'unreachable' : 'connected'))
      .catch(() => setStatus('unreachable'))
  }, [])

  return (
    <main className="placeholder">
      <h1>Thread</h1>
      <p>Foundation ready. Sign-in arrives in milestone 2.</p>
      <p className="status">
        Supabase: <strong>{status}</strong> ({import.meta.env.VITE_SUPABASE_URL})
      </p>
    </main>
  )
}

export default App
