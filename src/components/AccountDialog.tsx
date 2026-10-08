import { KeyRound, LoaderCircle, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, authApi, inputErrors } from '../api/client'
import { PASSWORD_MIN, passwordError, type User } from '../shared/api'

interface AccountDialogProps {
  user: User
  /** Number of saved patterns, when the library has loaded, for the delete warning. */
  patternCount: number | null
  onClose: () => void
  onAccountDeleted: () => void
}

function errorMessage(e: unknown, wrongPassword: string): string {
  if (!(e instanceof ApiError)) return 'Something went wrong. Try again.'
  if (e.code === 'rate_limited' || e.status === 429) return 'Too many attempts, wait a minute'
  if (e.code === 'invalid_credentials') return wrongPassword
  if (e.code === 'invalid_input') return inputErrors(e.details).join(' ') || e.message
  return e.message
}

const input = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal focus:border-slate-500 focus:outline-none'
const fieldError = 'mt-1 block text-xs font-normal text-red-600'

function ChangePassword({ email }: { email: string }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newError, setNewError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setDone(false)
    setError(currentPassword === '' ? 'Enter your current password' : null)
    const invalid = passwordError(newPassword)
    setNewError(invalid)
    if (invalid || currentPassword === '') return

    setBusy(true)
    try {
      await authApi.changePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setDone(true)
    } catch (err) {
      setError(errorMessage(err, 'Current password is wrong'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <KeyRound size={15} /> Change password
      </h3>
      {/* Lets password managers file the new password under the right account. */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <label className="block text-sm font-medium text-slate-700">
        Current password
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={input}
        />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        New password
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          aria-invalid={newError ? true : undefined}
          className={input}
        />
        <span className={newError ? fieldError : 'mt-1 block text-xs font-normal text-slate-500'}>
          {newError ?? `At least ${PASSWORD_MIN} characters.`}
        </span>
      </label>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Password changed. Your other sessions were logged out.
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
      >
        {busy && <LoaderCircle size={15} className="animate-spin" />}
        Change password
      </button>
    </form>
  )
}

function DeleteAccount({ patternCount, onAccountDeleted }: { patternCount: number | null; onAccountDeleted: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !confirmed || password === '') return
    setError(null)
    setBusy(true)
    try {
      await authApi.deleteAccount({ password })
      onAccountDeleted()
    } catch (err) {
      setError(errorMessage(err, 'Wrong password'))
      setBusy(false)
    }
  }

  const what =
    patternCount === null ? 'all my saved patterns' : patternCount === 1 ? 'my 1 saved pattern' : `my ${patternCount} saved patterns`

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3 rounded-lg border border-red-200 p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
        <Trash2 size={15} /> Delete account
      </h3>
      <label className="block text-sm font-medium text-slate-700">
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
        <span>I understand that my account and {what} will be deleted for good. This cannot be undone.</span>
      </label>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !confirmed || password === ''}
        className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {busy && <LoaderCircle size={15} className="animate-spin" />}
        Delete my account
      </button>
    </form>
  )
}

export function AccountDialog({ user, patternCount, onClose, onAccountDeleted }: AccountDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      // Escape closes through React state, so the dialog and the state never disagree.
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      aria-labelledby="account-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl bg-white p-5 text-slate-800 shadow-xl backdrop:bg-slate-900/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="account-title" className="text-base font-semibold">
            Account
          </h2>
          <p className="truncate text-sm text-slate-500">{user.email}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="mt-4 space-y-5">
        <ChangePassword email={user.email} />
        <DeleteAccount patternCount={patternCount} onAccountDeleted={onAccountDeleted} />
      </div>
    </dialog>
  )
}
