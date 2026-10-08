import { motion, useReducedMotion } from 'framer-motion'
import { KeyRound, LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, authApi, inputErrors } from '../api/client'
import { PASSWORD_MIN, PASSWORD_MAX, passwordError, type User } from '../shared/api'

import './auxiliary.css'

interface AccountDialogProps {
  user: User
  /** Number of saved patterns, when the library has loaded, for the delete warning. */
  patternCount: number | null
  onClose: () => void
  onAccountDeleted: () => void
}

function errorMessage(e: unknown, wrongPassword: string): string {
  if (!(e instanceof ApiError)) return 'Não foi possível continuar. Tente novamente.'
  if (e.code === 'rate_limited' || e.status === 429) return 'Muitas tentativas. Aguarde um minuto e tente novamente.'
  if (e.code === 'invalid_credentials') return wrongPassword
  if (e.code === 'invalid_input') return inputErrors(e.details).join(' ') || e.message
  return e.message
}

const input = 'aux-input'
const fieldError = 'aux-field-error'

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
    setError(currentPassword === '' ? 'Informe sua senha atual.' : null)
    const invalid = passwordError(newPassword)
      ? `A senha deve ter entre ${PASSWORD_MIN} e ${PASSWORD_MAX} caracteres.`
      : null
    setNewError(invalid)
    if (invalid || currentPassword === '') return

    setBusy(true)
    try {
      await authApi.changePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setDone(true)
    } catch (err) {
      setError(errorMessage(err, 'A senha atual está incorreta.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="aux-form account-password-form">
      <h3 className="account-section-title">
        <KeyRound size={15} /> Alterar senha
      </h3>
      {/* Lets password managers file the new password under the right account. */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <label className="aux-field">
        Senha atual
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={input}
        />
      </label>
      <label className="aux-field">
        Nova senha
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          aria-invalid={newError ? true : undefined}
          className={input}
        />
        <span className={newError ? fieldError : 'aux-field-hint'}>
          {newError ?? `Pelo menos ${PASSWORD_MIN} caracteres.`}
        </span>
      </label>
      {error && (
        <p role="alert" className="aux-error-message">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="aux-success-message">
          Senha alterada. Suas outras sessões foram encerradas.
        </p>
      )}
      <button type="submit" disabled={busy} className="aux-primary">
        {busy && <LoaderCircle size={15} className="animate-spin" />}
        Alterar senha
      </button>
    </form>
  )
}

function DeleteAccount({
  patternCount,
  onAccountDeleted,
}: {
  patternCount: number | null
  onAccountDeleted: () => void
}) {
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
      setError(errorMessage(err, 'Senha incorreta.'))
      setBusy(false)
    }
  }

  const what =
    patternCount === null
      ? 'todos os meus desenhos salvos'
      : patternCount === 1
        ? 'meu desenho salvo'
        : `meus ${patternCount} desenhos salvos`

  return (
    <form onSubmit={handleSubmit} noValidate className="aux-form account-delete-form">
      <h3 className="account-section-title account-danger-title">
        <Trash2 size={15} /> Excluir conta
      </h3>
      <label className="aux-field">
        Senha
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />
      </label>
      <label className="account-confirmation">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="account-checkbox"
        />
        <span>Entendo que minha conta e {what} serão excluídos permanentemente. Esta ação não pode ser desfeita.</span>
      </label>
      {error && (
        <p role="alert" className="aux-error-message">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !confirmed || password === ''}
        className="aux-primary aux-danger"
      >
        {busy && <LoaderCircle size={15} className="animate-spin" />}
        Excluir minha conta
      </button>
    </form>
  )
}

export function AccountDialog({ user, patternCount, onClose, onAccountDeleted }: AccountDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const reducedMotion = useReducedMotion()

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
      className="account-dialog"
    >
      <motion.div
        initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <div className="account-dialog-heading">
          <div className="account-dialog-identity">
            <span className="account-avatar" aria-hidden="true">
              {(user.displayName ?? user.email).charAt(0).toUpperCase()}
            </span>
            <div>
              <p className="account-eyebrow">SEU ESPAÇO DE CRIAÇÃO</p>
              <h2 id="account-title">Conta do ateliê</h2>
              <p className="account-email" title={user.displayName ?? user.email}>
                {user.displayName ?? user.email}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="aux-icon-button" aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <p className="account-security-note">
          <ShieldCheck size={15} /> Um lugar seguro para suas ideias e desenhos.
        </p>
        <div className="account-dialog-body">
          <ChangePassword email={user.email} />
          <DeleteAccount patternCount={patternCount} onAccountDeleted={onAccountDeleted} />
        </div>
      </motion.div>
    </dialog>
  )
}
