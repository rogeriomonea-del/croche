import { LoaderCircle } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, authApi, inputErrors } from '../api/client'
import { emailError, normalizeEmail, PASSWORD_MIN, passwordError, type User } from '../shared/api'

type Mode = 'login' | 'signup'

interface AuthScreenProps {
  onAuthenticated: (user: User) => void
  /** Shown above the form, e.g. when the session ended while a pattern was open. */
  notice?: string
  /** Drawn over the editor instead of replacing it, so unsaved work stays in place. */
  overlay?: boolean
}

function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Something went wrong. Try again.'
  if (e.code === 'rate_limited' || e.status === 429) return 'Too many attempts, wait a minute'
  switch (e.code) {
    case 'invalid_credentials':
      return 'Wrong email or password'
    case 'email_taken':
      return 'An account with this email already exists. Log in instead.'
    case 'signup_disabled':
      return 'Sign-up is closed on this server. Ask the owner for an account.'
    case 'invalid_input':
      return inputErrors(e.details).join(' ') || e.message
    default:
      return e.message
  }
}

const input = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none'

export function AuthScreen({ onAuthenticated, notice, overlay = false }: AuthScreenProps) {
  const [signupEnabled, setSignupEnabled] = useState(false)
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    // Without the config the form still logs in; only the sign-up tab stays hidden.
    authApi
      .config()
      .then((config) => live && setSignupEnabled(config.signupEnabled))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setFieldErrors({})
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const errors = { email: emailError(email) ?? undefined, password: passwordError(password) ?? undefined }
    setFieldErrors(errors)
    setError(null)
    if (errors.email || errors.password) return

    setBusy(true)
    try {
      const credentials = { email: normalizeEmail(email), password }
      const user = mode === 'signup' ? await authApi.signup(credentials) : await authApi.login(credentials)
      onAuthenticated(user)
    } catch (err) {
      setError(errorMessage(err))
      if (err instanceof ApiError && err.code === 'signup_disabled') {
        setSignupEnabled(false)
        setMode('login')
      }
    } finally {
      setBusy(false)
    }
  }

  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => switchMode(value)}
      className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${
        mode === value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-600 hover:text-slate-800'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div
      className={
        overlay
          ? 'fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/50 p-4'
          : 'grid min-h-screen place-items-center bg-slate-100 p-4'
      }
      role={overlay ? 'dialog' : undefined}
      aria-modal={overlay ? true : undefined}
      aria-labelledby="auth-title"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 text-slate-800 shadow-sm">
        <h1 id="auth-title" className="text-lg font-semibold">
          Mosaic Crochet Architect
        </h1>
        <p className="text-xs text-slate-500">Log in to open and save your patterns.</p>

        {notice && <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>}

        {signupEnabled && (
          <div className="mt-4 flex rounded-md bg-slate-100 p-0.5" role="tablist" aria-label="Account">
            {tab('login', 'Log in')}
            {tab('signup', 'Sign up')}
          </div>
        )}

        <form className="mt-4 space-y-3" onSubmit={handleSubmit} noValidate>
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              type="email"
              autoComplete={mode === 'signup' ? 'email' : 'username'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={fieldErrors.email ? true : undefined}
              className={input}
              autoFocus
            />
            {fieldErrors.email && <span className="mt-1 block text-xs font-normal text-red-600">{fieldErrors.email}</span>}
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={fieldErrors.password ? true : undefined}
              className={input}
            />
            {fieldErrors.password && <span className="mt-1 block text-xs font-normal text-red-600">{fieldErrors.password}</span>}
            {mode === 'signup' && !fieldErrors.password && (
              <span className="mt-1 block text-xs font-normal text-slate-500">At least {PASSWORD_MIN} characters.</span>
            )}
          </label>

          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {busy && <LoaderCircle size={16} className="animate-spin" />}
            {mode === 'signup' ? 'Create account' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  )
}
