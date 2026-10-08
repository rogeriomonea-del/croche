import { CircleCheck, LoaderCircle, Lock, LogOut, Save, TriangleAlert, UserRound, X as Close } from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from 'react'
import { ApiError, authApi, patternsApi } from '../api/client'
import {
  cellsOf,
  conflicts,
  deriveX,
  exportDocument,
  fromDocument,
  instructions,
  parseDocument,
  resolveClick,
  toCsv,
  toDocument,
  type BlockedReason,
  type DesignData,
  type View,
} from '../core'
import { fileSlug, formatUpdated } from '../lib/format'
import type { Pattern, PatternSummary, RevisionConflictDetails, User } from '../shared/api'
import { DEFAULT_NAME, designReducer, initialDesign } from '../state/design'
import { AccountDialog } from './AccountDialog'
import { InstructionsPanel } from './InstructionsPanel'
import { LibraryPanel } from './LibraryPanel'
import { MosaicGrid } from './MosaicGrid'
import { Toolbar } from './Toolbar'

const HINT: Record<View, string> = {
  simulation: 'Click a cell to swap its color. The dc that makes it is placed for you on the row above.',
  schematic: 'Click a cell to place or remove an X (dc). It drops two rows down and covers the cell below it.',
}

function blockedMessage(reason: BlockedReason, r: number): string {
  switch (reason) {
    case 'base-row':
      return 'Row 1 is the base row: there is no row below it for a dc to drop into, so it keeps its color.'
    case 'top-row':
      return `Row ${r} is the top row: no row above it can work the dc that would cover this cell.`
    case 'no-anchor':
      return `Row ${r} cannot hold a dc: a dc drops two rows down, so the first one goes on row 3.`
  }
}

/**
 * The pattern in the editor, as the server knows it. `savedDocJson` is the document the editor
 * would lose nothing against: the last one saved or opened, or the blank one for a new pattern.
 * It is null when nothing on the server matches (an import, or a pattern deleted elsewhere).
 */
interface Current {
  id: string | null
  revision: number | null
  savedDocJson: string | null
}

type Banner = { kind: 'conflict'; latest: Pattern } | { kind: 'errors'; title: string; errors: string[] }

const MAX_SHOWN_ERRORS = 5
const MAX_IMPORT_BYTES = 1024 * 1024

const docJson = (design: DesignData) => JSON.stringify(toDocument(design))
const BLANK: Current = { id: null, revision: null, savedDocJson: docJson(initialDesign) }
const DETACHED: Current = { id: null, revision: null, savedDocJson: null }

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.'
}

function documentErrors(e: ApiError): string[] {
  const errors = (e.details as { errors?: unknown } | undefined)?.errors
  const list = Array.isArray(errors) ? errors.filter((x): x is string => typeof x === 'string') : []
  return list.length > 0 ? list : [e.message]
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const headerButton = 'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100'
const bannerButton = 'rounded-md border border-current px-2.5 py-1 text-sm font-medium hover:bg-white/60 disabled:opacity-50'

interface EditorProps {
  user: User
  onLoggedOut: () => void
}

export function Editor({ user, onLoggedOut }: EditorProps) {
  const [design, dispatch] = useReducer(designReducer, initialDesign)
  const [view, setView] = useState<View>('simulation')
  const [notice, setNotice] = useState<string | null>(null)
  const [current, setCurrent] = useState<Current>(BLANK)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [patterns, setPatterns] = useState<PatternSummary[] | null>(null)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)

  // Bumped whenever another pattern takes over the editor, so a save still in flight for the old
  // one cannot stamp its id and revision onto the new one.
  const generation = useRef(0)
  const savingNow = useRef(false)

  const rows = design.delta.length
  const cols = design.delta[0].length
  const X = useMemo(() => deriveX(design.delta), [design.delta])
  const conflictX = useMemo(() => conflicts(X), [X])
  const lines = useMemo(() => instructions(X), [X])
  const conflictCells = useMemo(() => cellsOf(conflictX), [conflictX])
  const conflictRows = useMemo(() => new Set(conflictCells.map(([r]) => r)), [conflictCells])

  const dirty = useMemo(() => docJson(design), [design]) !== current.savedDocJson

  const refreshLibrary = useCallback(async () => {
    try {
      setPatterns(await patternsApi.list())
      setLibraryError(null)
    } catch (e) {
      // A 401 already asks the user to log in again; the list reloads when they do.
      if (!(e instanceof ApiError && e.status === 401)) setLibraryError(messageOf(e))
    }
  }, [])

  // `user` is a new object after logging in again, which is when a list that failed on 401 can load.
  useEffect(() => {
    refreshLibrary()
  }, [user, refreshLibrary])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Legacy browsers (Chrome/Edge before 119) only prompt when returnValue is set.
      e.returnValue = true
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const confirmDiscard = () =>
    !dirty || window.confirm(`Discard the unsaved changes to "${design.name.trim() || DEFAULT_NAME}"?`)

  /** Puts another pattern in the editor. */
  const take = (data: DesignData, next: Current) => {
    generation.current++
    dispatch({ type: 'load', design: data })
    setCurrent(next)
    setBanner(null)
    setSaveError(null)
    setNotice(null)
  }

  const takePattern = (pattern: Pattern) => {
    // The server validated it on the way in; checked again because a bad one would break the grid.
    const parsed = parseDocument(pattern.document)
    if (!parsed.ok) {
      setBanner({ kind: 'errors', title: `"${pattern.name}" could not be opened`, errors: parsed.errors })
      return
    }
    const data = fromDocument(parsed.document)
    take(data, { id: pattern.id, revision: pattern.revision, savedDocJson: docJson(data) })
  }

  const save = async (overwriteRevision?: number) => {
    if (savingNow.current) return
    const doc = toDocument(design)
    const parsed = parseDocument(doc)
    if (!parsed.ok) {
      setBanner({ kind: 'errors', title: 'This pattern cannot be saved yet', errors: parsed.errors })
      return
    }
    const gen = generation.current
    const { id, revision } = current
    savingNow.current = true
    setSaving(true)
    setSaveError(null)
    setBanner(null)
    try {
      const pattern =
        id === null
          ? await patternsApi.create({ document: parsed.document })
          : await patternsApi.update(id, { revision: overwriteRevision ?? revision!, document: parsed.document })
      // What was sent, not the canonical copy: the name stays as typed (untrimmed) in the editor.
      if (gen === generation.current) setCurrent({ id: pattern.id, revision: pattern.revision, savedDocJson: JSON.stringify(doc) })
      refreshLibrary()
    } catch (e) {
      if (gen === generation.current) handleSaveError(e)
    } finally {
      savingNow.current = false
      setSaving(false)
    }
  }

  const handleSaveError = (e: unknown) => {
    if (!(e instanceof ApiError)) return setSaveError(messageOf(e))
    switch (e.code) {
      case 'revision_conflict': {
        const latest = (e.details as RevisionConflictDetails | undefined)?.current
        return latest ? setBanner({ kind: 'conflict', latest }) : setSaveError(e.message)
      }
      case 'invalid_document':
        return setBanner({ kind: 'errors', title: 'The server refused this pattern', errors: documentErrors(e) })
      case 'not_found':
        setCurrent(DETACHED)
        refreshLibrary()
        return setSaveError('This pattern was deleted elsewhere. Save again to keep it as a new pattern.')
      case 'pattern_quota_exceeded':
        return setSaveError('You have reached the limit of saved patterns. Delete one to save this.')
      case 'unauthenticated':
        return setSaveError('Not saved: log in again, then save.')
      default:
        return setSaveError(e.message)
    }
  }

  const onSaveShortcut = useEffectEvent((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (!accountOpen) save()
    }
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onSaveShortcut(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const openPattern = async (summary: PatternSummary) => {
    if (busyId !== null || !confirmDiscard()) return
    setBusyId(summary.id)
    try {
      takePattern(await patternsApi.get(summary.id))
    } catch (e) {
      const gone = e instanceof ApiError && e.code === 'not_found'
      setBanner({ kind: 'errors', title: `Could not open "${summary.name}"`, errors: [gone ? 'It no longer exists.' : messageOf(e)] })
      if (gone) refreshLibrary()
    } finally {
      setBusyId(null)
    }
  }

  const deletePattern = async (summary: PatternSummary) => {
    if (busyId !== null || !window.confirm(`Delete "${summary.name}"? This cannot be undone.`)) return
    setBusyId(summary.id)
    try {
      await patternsApi.remove(summary.id)
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'not_found')) {
        setBanner({ kind: 'errors', title: `Could not delete "${summary.name}"`, errors: [messageOf(e)] })
        setBusyId(null)
        return
      }
    }
    // An open pattern that was deleted stays in the editor as unsaved work, so a slip loses nothing.
    setCurrent((c) => (c.id === summary.id ? DETACHED : c))
    setBusyId(null)
    refreshLibrary()
  }

  const handleNew = () => {
    if (confirmDiscard()) take(initialDesign, BLANK)
  }

  const handleImportFile = async (file: File) => {
    const fail = (errors: string[]) => setBanner({ kind: 'errors', title: `"${file.name}" could not be imported`, errors })
    if (file.size > MAX_IMPORT_BYTES) return fail(['The file is larger than 1 MB, far more than any pattern needs.'])
    let input: unknown
    try {
      input = JSON.parse(await file.text())
    } catch {
      return fail(['The file is not valid JSON.'])
    }
    const parsed = parseDocument(input)
    if (!parsed.ok) return fail(parsed.errors)
    if (confirmDiscard()) take(fromDocument(parsed.document), DETACHED)
  }

  const handleExportJson = () => {
    const parsed = parseDocument(toDocument(design))
    if (!parsed.ok) {
      setBanner({ kind: 'errors', title: 'This pattern cannot be exported yet', errors: parsed.errors })
      return
    }
    const content = JSON.stringify(exportDocument(parsed.document), null, 2) + '\n'
    download(`${fileSlug(parsed.document.name)}.mosaic.json`, content, 'application/json')
  }

  const handleLogout = async () => {
    if (!confirmDiscard()) return
    try {
      await authApi.logout()
    } catch (e) {
      // 401: already logged out, which is what was asked for.
      if (!(e instanceof ApiError && e.status === 401)) {
        setBanner({ kind: 'errors', title: 'Could not log out', errors: [messageOf(e)] })
        return
      }
    }
    onLoggedOut()
  }

  /**
   * The only way the drawing changes from the grid. The state holds one fact per cell: does it
   * deviate from its row's stripe? Colour and X are both derived from it, so they can never
   * disagree. resolveClick turns the click into that cell (the cell itself in simulation, the
   * cell under the X in schematic) or refuses it when no dc could exist there.
   */
  const handleCellClick = useCallback(
    (r: number, c: number) => {
      const target = resolveClick(view, r, c, rows)
      if (!target.ok) {
        setNotice(blockedMessage(target.reason, r))
        return
      }
      setNotice(null)
      dispatch({ type: 'toggle', r: target.r, c: target.c })
    },
    [view, rows],
  )

  const handleClear = () => {
    if (cellsOf(design.delta).length > 0 && !window.confirm('Clear the whole grid? This cannot be undone.')) return
    dispatch({ type: 'clear' })
    setNotice(null)
  }

  const status = saving ? (
    <span className="inline-flex items-center gap-1 text-slate-500">
      <LoaderCircle size={15} className="animate-spin" /> Saving…
    </span>
  ) : saveError ? (
    <span className="inline-flex items-center gap-1 text-red-600">
      <TriangleAlert size={15} className="shrink-0" /> {saveError}
    </span>
  ) : dirty ? (
    <span className="text-amber-700">Unsaved changes</span>
  ) : current.id !== null ? (
    <span className="inline-flex items-center gap-1 text-emerald-700">
      <CircleCheck size={15} /> Saved
    </span>
  ) : (
    <span className="text-slate-500">Not saved yet</span>
  )

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">Mosaic Crochet Architect</h1>
            <p className="text-xs text-slate-500">Overlay mosaic crochet · rows alternate color A and B · row 1 at the bottom</p>
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 max-w-[10rem] truncate text-sm text-slate-600 sm:max-w-[16rem]" title={user.email}>
              {user.email}
            </span>
            <button type="button" className={headerButton} onClick={() => setAccountOpen(true)} aria-label="Account">
              <UserRound size={16} /> <span className="hidden sm:inline">Account</span>
            </button>
            <button type="button" className={headerButton} onClick={handleLogout} aria-label="Log out">
              <LogOut size={16} /> <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <input
            value={design.name}
            onChange={(e) => dispatch({ type: 'rename', name: e.target.value })}
            aria-label="Pattern name"
            placeholder="Pattern name"
            className="min-w-0 flex-1 basis-48 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium focus:border-slate-500 focus:outline-none sm:max-w-sm"
          />
          <button
            type="button"
            onClick={() => save()}
            disabled={saving}
            title="Save (Ctrl+S / ⌘S)"
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
          >
            <Save size={16} /> Save
          </button>
          <span className="text-sm" role="status">
            {status}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-3 p-4">
        {banner?.kind === 'conflict' && (
          <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="min-w-0 flex-1 basis-64">
              <TriangleAlert size={15} className="mr-1 inline align-[-2px]" />
              "{banner.latest.name}" was saved somewhere else ({formatUpdated(banner.latest.updatedAt)}). Load latest discards
              your changes here; Overwrite replaces that version with yours.
            </p>
            <div className="flex gap-2">
              <button type="button" className={bannerButton} onClick={() => takePattern(banner.latest)} disabled={saving}>
                Load latest
              </button>
              <button type="button" className={bannerButton} onClick={() => save(banner.latest.revision)} disabled={saving}>
                Overwrite
              </button>
            </div>
          </div>
        )}
        {banner?.kind === 'errors' && (
          <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{banner.title}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 break-words">
                {banner.errors.slice(0, MAX_SHOWN_ERRORS).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              {banner.errors.length > MAX_SHOWN_ERRORS && (
                <p className="mt-1 text-red-700">and {banner.errors.length - MAX_SHOWN_ERRORS} more</p>
              )}
            </div>
            <button type="button" onClick={() => setBanner(null)} className="rounded p-0.5 hover:bg-red-100" aria-label="Dismiss">
              <Close size={16} />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
          <LibraryPanel
            className="lg:col-start-2 lg:row-start-1"
            patterns={patterns}
            error={libraryError}
            currentId={current.id}
            busyId={busyId}
            onOpen={openPattern}
            onDelete={deletePattern}
            onNew={handleNew}
            onRetry={refreshLibrary}
          />

          <div className="min-w-0 space-y-3 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <Toolbar
              view={view}
              onViewChange={(v) => {
                setView(v)
                setNotice(null)
              }}
              rows={rows}
              cols={cols}
              onResize={(r, c) => {
                dispatch({ type: 'resize', rows: r, cols: c })
                setNotice(null)
              }}
              colors={design.colors}
              onColorChange={(yarn, color) => dispatch({ type: 'setColor', yarn, color })}
              onSwapColors={() => dispatch({ type: 'swapColors' })}
              onClear={handleClear}
              onDownloadCsv={() => download(`${fileSlug(design.name)}.csv`, toCsv(X), 'text/csv;charset=utf-8')}
              onExportJson={handleExportJson}
              onImportFile={handleImportFile}
            />

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-live="polite">
              <span className="text-slate-500">{HINT[view]}</span>
              {conflictCells.length > 0 ? (
                <span className="inline-flex items-center gap-1 font-medium text-red-600">
                  <TriangleAlert size={15} /> {conflictCells.length} dc in conflict: dc on consecutive rows of the same column
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CircleCheck size={15} /> No conflicts
                </span>
              )}
              {notice && (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <Lock size={15} /> {notice}
                </span>
              )}
            </div>

            {/* The chart scrolls inside its own box, so a 119 × 120 grid never widens the page. */}
            <section className="max-h-[75vh] overflow-auto rounded-xl bg-white p-3 shadow-sm">
              <MosaicGrid
                view={view}
                delta={design.delta}
                X={X}
                conflictX={conflictX}
                colors={design.colors}
                onCellClick={handleCellClick}
              />
            </section>
          </div>

          <InstructionsPanel className="lg:col-start-2 lg:row-start-2" lines={lines} conflictRows={conflictRows} />
        </div>
      </main>

      {accountOpen && (
        <AccountDialog
          user={user}
          patternCount={patterns?.length ?? null}
          onClose={() => setAccountOpen(false)}
          onAccountDeleted={onLoggedOut}
        />
      )}
    </div>
  )
}
