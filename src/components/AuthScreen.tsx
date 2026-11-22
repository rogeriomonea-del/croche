import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, LoaderCircle, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, authApi, inputErrors } from '../api/client'
import { emailError, normalizeEmail, PASSWORD_MIN, PASSWORD_MAX, passwordError, type User } from '../shared/api'
import { loginIdentifierError, normalizeLoginIdentifier } from '../shared/login'
import { Brand } from './Brand'

import './auxiliary.css'

type Mode = 'login' | 'signup'

interface AuthScreenProps {
  onAuthenticated: (user: User) => void
  /** Shown above the form, e.g. when the session ended while a pattern was open. */
  notice?: string
  /** Drawn over the editor instead of replacing it, so unsaved work stays in place. */
  overlay?: boolean
}

function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Não foi possível continuar. Tente novamente.'
  if (e.code === 'rate_limited' || e.status === 429) return 'Muitas tentativas. Aguarde um minuto e tente novamente.'
  switch (e.code) {
    case 'invalid_credentials':
      return 'Usuário ou senha incorretos.'
    case 'email_taken':
      return 'Já existe uma conta com esse e-mail. Entre para continuar.'
    case 'signup_disabled':
      return 'O cadastro está fechado. Solicite uma conta à pessoa responsável pelo ateliê.'
    case 'invalid_input':
      return inputErrors(e.details).join(' ') || e.message
    default:
      return e.message
  }
}

const input = 'aux-input'

export function AuthScreen({ onAuthenticated, notice, overlay = false }: AuthScreenProps) {
  const [signupEnabled, setSignupEnabled] = useState(false)
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (!overlay) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const container = ref.current
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !container) return
      const focusable = [
        ...container.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ),
      ]
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (
        event.shiftKey &&
        (document.activeElement === first || !container.contains(document.activeElement))
      ) {
        event.preventDefault()
        last?.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !container.contains(document.activeElement))
      ) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => {
      document.removeEventListener('keydown', trapFocus)
      previousFocus?.focus()
    }
  }, [overlay])

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
    const identifierError = mode === 'signup' ? emailError(email) : loginIdentifierError(email)
    const errors = {
      email: identifierError
        ? mode === 'signup' ? 'Informe um e-mail válido.' : 'Informe um nome de usuário ou e-mail válido.'
        : undefined,
      password: passwordError(password)
        ? `A senha deve ter entre ${PASSWORD_MIN} e ${PASSWORD_MAX} caracteres.`
        : undefined,
    }
    setFieldErrors(errors)
    setError(null)
    if (errors.email || errors.password) return

    setBusy(true)
    try {
      const credentials = {
        email: mode === 'signup' ? normalizeEmail(email) : normalizeLoginIdentifier(email),
        password,
      }
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
      aria-pressed={mode === value}
      onClick={() => switchMode(value)}
      className={`auth-tab ${mode === value ? 'is-selected' : ''}`}
    >
      {label}
    </button>
  )

  return (
    <div
      ref={ref}
      className={`auth-screen ${overlay ? 'auth-overlay' : ''}`}
      role={overlay ? 'dialog' : undefined}
      aria-modal={overlay ? true : undefined}
      aria-labelledby="auth-title"
    >
      <motion.div
        className="auth-studio"
        initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {!overlay && (
          <div className="auth-artwork">
            <span className="auth-artwork-kicker">FEITO DE FIOS, TEMPO E IMAGINAÇÃO</span>
            <div className="auth-textile" aria-hidden="true">
              <svg viewBox="0 0 440 420" fill="none">
                <defs>
                  <pattern id="auth-woven" width="12" height="12" patternUnits="userSpaceOnUse">
                    <path d="M0 3H12M0 9H12" stroke="#ded8c5" strokeWidth="4" />
                    <path d="M3 0V12M9 0V12" stroke="#f1ecde" strokeWidth="3" />
                    <path d="M0 4H12M4 0V12" stroke="#ffffff" strokeOpacity=".22" />
                  </pattern>
                  <pattern id="auth-motif" width="144" height="144" patternUnits="userSpaceOnUse">
                    <path d="m72 0 72 72-72 72L0 72Z" stroke="#64435b" strokeWidth="24" />
                    <path d="m72 48 24 24-24 24-24-24Z" fill="#b7915d" />
                    <path
                      d="m0 0 24 24M144 0l-24 24M0 144l24-24m120 24-24-24"
                      stroke="#b7915d"
                      strokeWidth="11"
                    />
                  </pattern>
                  <pattern id="auth-fiber" width="6" height="6" patternUnits="userSpaceOnUse">
                    <path d="m0 1 3 4 3-4" stroke="#f5f0dc" strokeOpacity=".26" strokeWidth="1.2" />
                  </pattern>
                  <clipPath id="auth-cloth-clip">
                    <rect x="54" y="12" width="336" height="360" rx="3" />
                  </clipPath>
                </defs>
                <path d="M61 41 399 24 414 366 79 393Z" fill="#402b3f" fillOpacity=".12" />
                <g transform="rotate(-7 220 210)">
                  <rect x="54" y="12" width="336" height="360" rx="3" fill="url(#auth-woven)" />
                  <g clipPath="url(#auth-cloth-clip)">
                    <path d="M54 36H390V349H54Z" fill="url(#auth-motif)" />
                    <path d="M54 12H390V372H54Z" fill="url(#auth-fiber)" />
                  </g>
                  <path d="M54 28H390M54 357H390" stroke="#52384e" strokeWidth="5" />
                  {Array.from({ length: 42 }, (_, i) => (
                    <path
                      key={i}
                      d={`M${58 + i * 8} 372q-3 11 0 ${17 + (i % 3) * 3}`}
                      stroke="#e1dac6"
                      strokeWidth="4"
                      strokeLinecap="round"
                    />
                  ))}
                </g>
              </svg>
              <span className="auth-specimen-label">
                COLEÇÃO HERANÇA <i>№ 01</i>
              </span>
            </div>
            <div className="auth-artwork-caption">
              <span>
                Ponto por ponto.
                <br />
                <em>Uma história sua.</em>
              </span>
              <Sparkles size={28} strokeWidth={1} />
            </div>
          </div>
        )}
        <div className="auth-form-sheet">
          <div className="auth-brand">
            <Brand />
          </div>
          <p className="auth-form-kicker">SEU ATELIÊ DE CROCHÊ EM MOSAICO</p>
          <h1 id="auth-title">
            {overlay ? 'Seu ateliê espera.' : 'Dê forma à'}
            {!overlay && (
              <>
                <br />
                <em>sua imaginação.</em>
              </>
            )}
          </h1>
          <p className="auth-description">
            {overlay
              ? 'Entre para retomar sua criação. O desenho aberto continua exatamente onde você o deixou.'
              : 'Transforme fios, fotografias e pequenas inspirações em desenhos que as suas mãos podem criar.'}
          </p>

          {notice && (
            <p className="aux-notice" role="status">
              {notice}
            </p>
          )}

          {signupEnabled && (
            <div className="auth-tabs" role="group" aria-label="Acesso à conta">
              {tab('login', 'Entrar')}
              {tab('signup', 'Criar conta')}
            </div>
          )}

          <form className="aux-form auth-form" onSubmit={handleSubmit} noValidate>
            <label className="aux-field">
              {mode === 'signup' ? 'E-mail' : 'Nome de usuário ou e-mail'}
              <input
                type={mode === 'signup' ? 'email' : 'text'}
                autoComplete={mode === 'signup' ? 'email' : 'username'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={fieldErrors.email ? true : undefined}
                aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
                className={input}
                placeholder={mode === 'signup' ? 'voce@seuatelie.com' : 'Seu nome de usuário'}
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
              />
              {fieldErrors.email && (
                <span id="auth-email-error" className="aux-field-error">
                  {fieldErrors.email}
                </span>
              )}
            </label>
            <label className="aux-field">
              Senha
              <input
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={fieldErrors.password ? true : undefined}
                aria-describedby={
                  fieldErrors.password
                    ? 'auth-password-error'
                    : mode === 'signup'
                      ? 'auth-password-hint'
                      : undefined
                }
                className={input}
                placeholder="A chave do seu ateliê"
              />
              {fieldErrors.password && (
                <span id="auth-password-error" className="aux-field-error">
                  {fieldErrors.password}
                </span>
              )}
              {mode === 'signup' && !fieldErrors.password && (
                <span id="auth-password-hint" className="aux-field-hint">
                  Pelo menos {PASSWORD_MIN} caracteres.
                </span>
              )}
            </label>

            <AnimatePresence initial={false}>
              {error && (
                <motion.p
                  key="auth-error"
                  role="alert"
                  className="aux-error-message"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <button type="submit" disabled={busy} className="aux-primary auth-submit">
              {busy ? <LoaderCircle size={16} className="animate-spin" /> : null}
              {mode === 'signup' ? 'Criar meu ateliê' : 'Entrar no ateliê'}
              {!busy && <ArrowRight size={17} strokeWidth={1.5} />}
            </button>
          </form>
          <p className="auth-footer">O tempo de criar. O prazer de fazer à mão.</p>
        </div>
      </motion.div>
      {!overlay && (
        <p className="auth-bottom-note">
          CROCHET VICTORIOSO <span>Ideias que florescem entre os fios.</span>
        </p>
      )}
    </div>
  )
}
