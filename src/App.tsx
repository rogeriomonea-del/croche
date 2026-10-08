import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, authApi, setOnUnauthenticated } from './api/client'
import { AuthScreen } from './components/AuthScreen'
import { Editor } from './components/Editor'
import type { User } from './shared/api'

type Session =
  { status: 'checking' } | { status: 'unreachable'; message: string } | { status: 'ready'; user: User | null }

export default function App() {
  const [session, setSession] = useState<Session>({ status: 'checking' })
  // The session ended while the editor was open: ask to log in again on top of it, so the unsaved
  // drawing is still there afterwards.
  const [expired, setExpired] = useState(false)

  const checkSession = () => {
    authApi.me().then(
      (user) => setSession({ status: 'ready', user }),
      (e: unknown) =>
        setSession(
          e instanceof ApiError && e.status === 401
            ? { status: 'ready', user: null }
            : { status: 'unreachable', message: e instanceof Error ? e.message : 'Algo deu errado. Tente novamente.' },
        ),
    )
  }

  useEffect(checkSession, [])

  useEffect(() => {
    setOnUnauthenticated(() => setExpired(true))
    return () => setOnUnauthenticated(null)
  }, [])

  // Logging in as someone else gets a fresh editor: Editor is keyed by the user's id.
  const handleAuthenticated = (user: User) => {
    setExpired(false)
    setSession({ status: 'ready', user })
  }

  const handleLoggedOut = () => {
    setExpired(false)
    setSession({ status: 'ready', user: null })
  }

  if (session.status === 'checking') {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100 text-sm text-slate-500">
        <span className="inline-flex items-center gap-2">
          <LoaderCircle size={18} className="animate-spin" /> Abrindo seu ateliê…
        </span>
      </div>
    )
  }

  if (session.status === 'unreachable') {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100 p-4 text-sm text-slate-700">
        <div className="max-w-sm rounded-xl bg-white p-6 text-center shadow-sm">
          <p>{session.message}</p>
          <button
            type="button"
            onClick={() => {
              setSession({ status: 'checking' })
              checkSession()
            }}
            className="mt-4 rounded-md bg-slate-800 px-3 py-1.5 font-medium text-white hover:bg-slate-700"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  if (!session.user) return <AuthScreen onAuthenticated={handleAuthenticated} />

  return (
    <>
      <div inert={expired}>
        <Editor key={session.user.id} user={session.user} onLoggedOut={handleLoggedOut} />
      </div>
      {expired && (
        <AuthScreen
          overlay
          notice="Sua sessão terminou. Entre novamente para continuar: seu desenho não salvo continua no editor."
          onAuthenticated={handleAuthenticated}
        />
      )}
    </>
  )
}
