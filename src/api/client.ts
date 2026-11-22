// Typed client for the backend (SPEC §9.4): same origin, cookie session, JSON in and out.
import type {
  ApiErrorBody,
  ApiErrorCode,
  AuthConfig,
  ChangePasswordRequest,
  CreatePatternRequest,
  Credentials,
  DeleteAccountRequest,
  Pattern,
  PatternSummary,
  UpdatePatternRequest,
  User,
} from '../shared/api'

/** Any failed request. Network failures and unreadable answers carry code 'internal' (status 0 = no answer). */
export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details: unknown

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

// On these a 401 is an answer about the credentials typed in (or "not logged in yet"), not a
// session that ended while the app was open, so it must not throw the user out of the editor.
// Password change and account deletion answer a wrong password with invalid_credentials too, but
// a dead session there is still unauthenticated, so those are told apart by code, not by path.
const OWN_401 = new Set(['/api/auth/login', '/api/auth/me'])

let onUnauthenticated: (() => void) | null = null

/** Called on a 401 other than invalid_credentials from any endpoint outside OWN_401, so the app can ask the user to log in again. */
export function setOnUnauthenticated(callback: (() => void) | null): void {
  onUnauthenticated = callback
}

function isErrorBody(body: unknown): body is ApiErrorBody {
  if (typeof body !== 'object' || body === null) return false
  const error = (body as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return typeof code === 'string' && typeof message === 'string'
}

/**
 * The server words its errors in English. These codes reach the pt-BR interface without a
 * screen-specific text, so the client words them; the codes the screens handle keep the server text.
 */
const LOCAL_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  rate_limited: 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.',
  bad_origin: 'O servidor recusou esta página. Abra o ateliê pelo endereço oficial e tente novamente.',
  internal: 'O servidor encontrou um erro inesperado. Tente novamente em instantes.',
}

async function errorFrom(res: Response): Promise<ApiError> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = undefined
  }
  if (isErrorBody(body)) {
    const { code, message, details } = body.error
    return new ApiError(res.status, code, LOCAL_MESSAGES[code] ?? message, details)
  }
  const reason = res.statusText ? `${res.status} ${res.statusText}` : `${res.status}`
  return new ApiError(res.status, 'internal', `O servidor respondeu com um erro inesperado (${reason}). Tente novamente em instantes.`)
}

async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const init: RequestInit = { method, credentials: 'same-origin', headers }
  // Every mutating request is JSON, even with nothing to say: the server answers 415 otherwise
  // (SPEC §9.3), and an empty body under that content type is a parse error.
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body ?? {})
  }

  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError(0, 'internal', 'Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.')
  }

  if (!res.ok) {
    const error = await errorFrom(res)
    if (res.status === 401 && !OWN_401.has(path) && error.code !== 'invalid_credentials') onUnauthenticated?.()
    throw error
  }
  if (res.status === 204) return undefined as T
  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError(res.status, 'internal', 'O servidor enviou uma resposta que não pôde ser lida. Tente novamente.')
  }
}

export const authApi = {
  config: () => request<AuthConfig>('GET', '/api/auth/config'),
  signup: (credentials: Credentials) =>
    request<{ user: User }>('POST', '/api/auth/signup', credentials).then((r) => r.user),
  login: (credentials: Credentials) => request<{ user: User }>('POST', '/api/auth/login', credentials).then((r) => r.user),
  logout: () => request<void>('POST', '/api/auth/logout'),
  me: () => request<{ user: User }>('GET', '/api/auth/me').then((r) => r.user),
  changePassword: (body: ChangePasswordRequest) => request<void>('POST', '/api/auth/password', body),
  deleteAccount: (body: DeleteAccountRequest) => request<void>('POST', '/api/auth/delete-account', body),
}

/** The per-field messages of a 400 invalid_input (SPEC §9.4), or [] when there are none. */
export function inputErrors(details: unknown): string[] {
  const fields = (details as { fields?: unknown } | undefined)?.fields
  if (typeof fields !== 'object' || fields === null) return []
  return Object.values(fields).filter((v): v is string => typeof v === 'string')
}

const patternPath = (id: string) => `/api/patterns/${encodeURIComponent(id)}`

export const patternsApi = {
  /** Newest first. */
  list: () => request<{ patterns: PatternSummary[] }>('GET', '/api/patterns').then((r) => r.patterns),
  get: (id: string) => request<{ pattern: Pattern }>('GET', patternPath(id)).then((r) => r.pattern),
  create: (body: CreatePatternRequest) => request<{ pattern: Pattern }>('POST', '/api/patterns', body).then((r) => r.pattern),
  update: (id: string, body: UpdatePatternRequest) =>
    request<{ pattern: Pattern }>('PUT', patternPath(id), body).then((r) => r.pattern),
  remove: (id: string) => request<void>('DELETE', patternPath(id)),
}
