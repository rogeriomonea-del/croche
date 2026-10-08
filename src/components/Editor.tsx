import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUpRight,
  BookOpen,
  CircleCheck,
  Camera,
  LayoutGrid,
  Plus,
  Eye,
  Grid3x3,
  Leaf,
  LoaderCircle,
  Lock,
  LogOut,
  PencilLine,
  Redo2,
  Save,
  TriangleAlert,
  Undo2,
  UserRound,
  X as Close,
} from 'lucide-react'
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
import { formatUpdated } from '../lib/format'
import { fileSlug } from '../shared/filename'
import type { Pattern, PatternSummary, RevisionConflictDetails, User } from '../shared/api'
import { DEFAULT_NAME, initialDesign } from '../state/design'
import { historyReducer, initialHistory } from '../state/history'
import { Brand } from './Brand'
import { TemplateGallery } from './TemplateGallery'
import { PhotoPatternDialog } from './PhotoPatternDialog'
import { AccountDialog } from './AccountDialog'
import { InstructionsPanel } from './InstructionsPanel'
import { LibraryPanel } from './LibraryPanel'
import { MosaicGrid } from './MosaicGrid'
import { Toolbar } from './Toolbar'

const HINT: Record<View, string> = {
  simulation: 'Clique para trocar a cor. O ponto alto correspondente é calculado na carreira acima.',
  schematic:
    'Clique para colocar ou retirar um X (ponto alto). Ele se ancora duas carreiras abaixo e cobre a célula de baixo.',
}

function blockedMessage(reason: BlockedReason, r: number): string {
  switch (reason) {
    case 'base-row':
      return 'A carreira 1 é a base: não há carreira abaixo para ancorar o ponto alto. Sua cor é preservada.'
    case 'top-row':
      return `A carreira ${r} é o topo: não há carreira acima para fazer o ponto alto que cobriria esta célula.`
    case 'no-anchor':
      return `A carreira ${r} não aceita ponto alto: ele se ancora duas carreiras abaixo. O primeiro fica na carreira 3.`
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
  return e instanceof Error ? e.message : 'Não foi possível concluir esta ação.'
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

const headerButton = 'header-button'
const bannerButton =
  'rounded-md border border-current px-2.5 py-1 text-sm font-medium hover:bg-white/60 disabled:opacity-50'

interface EditorProps {
  user: User
  onLoggedOut: () => void
}

export function Editor({ user, onLoggedOut }: EditorProps) {
  const [history, dispatch] = useReducer(historyReducer, initialHistory)
  const design = history.present
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
  const [creationPanel, setCreationPanel] = useState<'templates' | 'photo' | null>(null)

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
    !dirty || window.confirm(`Descartar as alterações não salvas em "${design.name.trim() || DEFAULT_NAME}"?`)

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
      setBanner({ kind: 'errors', title: `Não foi possível abrir "${pattern.name}"`, errors: parsed.errors })
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
      setBanner({ kind: 'errors', title: 'Revise o padrão antes de salvar', errors: parsed.errors })
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
          : await patternsApi.update(id, {
              revision: overwriteRevision ?? revision!,
              document: parsed.document,
            })
      // What was sent, not the canonical copy: the name stays as typed (untrimmed) in the editor.
      if (gen === generation.current)
        setCurrent({ id: pattern.id, revision: pattern.revision, savedDocJson: JSON.stringify(doc) })
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
        return setBanner({
          kind: 'errors',
          title: 'O servidor não aceitou este padrão',
          errors: documentErrors(e),
        })
      case 'not_found':
        setCurrent(DETACHED)
        refreshLibrary()
        return setSaveError(
          'Este padrão foi excluído em outra sessão. Salve novamente para criar uma nova cópia.',
        )
      case 'pattern_quota_exceeded':
        return setSaveError('Você atingiu o limite de padrões salvos. Exclua um para salvar este.')
      case 'unauthenticated':
        return setSaveError('O padrão não foi salvo. Entre novamente e salve seu trabalho.')
      default:
        return setSaveError(e.message)
    }
  }

  const onSaveShortcut = useEffectEvent((e: KeyboardEvent) => {
    // An expired session presents a modal above this still-mounted editor. Its keys belong
    // to that modal, even though the hidden draft remains alive for reauthentication.
    if ((e.target as HTMLElement)?.closest('[role="dialog"], dialog')) return
    const editingText = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable=true]')
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !editingText && !accountOpen) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      }
      if (e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      }
    }
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
      setBanner({
        kind: 'errors',
        title: `Não foi possível abrir "${summary.name}"`,
        errors: [gone ? 'Este padrão não existe mais.' : messageOf(e)],
      })
      if (gone) refreshLibrary()
    } finally {
      setBusyId(null)
    }
  }

  const deletePattern = async (summary: PatternSummary) => {
    if (busyId !== null || !window.confirm(`Excluir "${summary.name}"? Esta ação não pode ser desfeita.`))
      return
    setBusyId(summary.id)
    try {
      await patternsApi.remove(summary.id)
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'not_found')) {
        setBanner({
          kind: 'errors',
          title: `Não foi possível excluir "${summary.name}"`,
          errors: [messageOf(e)],
        })
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
    const fail = (errors: string[]) =>
      setBanner({ kind: 'errors', title: `Não foi possível importar "${file.name}"`, errors })
    if (file.size > MAX_IMPORT_BYTES) return fail(['O arquivo ultrapassa o limite de 1 MB para um padrão.'])
    let input: unknown
    try {
      input = JSON.parse(await file.text())
    } catch {
      return fail(['O arquivo não contém um JSON válido.'])
    }
    const parsed = parseDocument(input)
    if (!parsed.ok) return fail(parsed.errors)
    if (confirmDiscard()) take(fromDocument(parsed.document), DETACHED)
  }

  const handleExportJson = () => {
    const parsed = parseDocument(toDocument(design))
    if (!parsed.ok) {
      setBanner({ kind: 'errors', title: 'Revise o padrão antes de exportar', errors: parsed.errors })
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
        setBanner({ kind: 'errors', title: 'Não foi possível encerrar a sessão', errors: [messageOf(e)] })
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

  const handlePaintCells = useCallback(
    (cells: { r: number; c: number }[], value: boolean) => {
      const resolved: { r: number; c: number }[] = []
      for (const cell of cells) {
        const target = resolveClick(view, cell.r, cell.c, rows)
        if (target.ok) resolved.push(target)
        else setNotice(blockedMessage(target.reason, cell.r))
      }
      if (resolved.length) {
        setNotice(null)
        dispatch({ type: 'paint', cells: resolved, value })
      }
    },
    [view, rows],
  )

  const applyCreation = (data: DesignData) => {
    const parsed = parseDocument(toDocument(data))
    if (!parsed.ok) {
      setBanner({ kind: 'errors', title: 'Não foi possível abrir este padrão', errors: parsed.errors })
      return
    }
    if (!confirmDiscard()) return
    take(fromDocument(parsed.document), DETACHED)
    setCreationPanel(null)
  }

  const handleClear = () => {
    if (
      cellsOf(design.delta).length > 0 &&
      !window.confirm('Limpar toda a grade? Você pode restaurá-la com Desfazer.')
    )
      return
    dispatch({ type: 'clear' })
    setNotice(null)
  }

  const status = saving ? (
    <span className="inline-flex items-center gap-1 text-slate-500">
      <LoaderCircle size={15} className="animate-spin" /> Salvando…
    </span>
  ) : saveError ? (
    <span className="inline-flex items-center gap-1 text-red-600">
      <TriangleAlert size={15} className="shrink-0" /> {saveError}
    </span>
  ) : dirty ? (
    <span className="text-amber-700">Alterações não salvas</span>
  ) : current.id !== null ? (
    <span className="inline-flex items-center gap-1 text-emerald-700">
      <CircleCheck size={15} /> Salvo
    </span>
  ) : (
    <span className="text-slate-500">Ainda não salvo</span>
  )

  return (
    <div className="atelier-app">
      <header className="atelier-header">
        <a className="brand-link" href="#worktable" aria-label="Crochet Victorioso — ateliê">
          <Brand />
        </a>
        <div className="header-center">
          <span className="studio-live-dot" /> Seu tempo. Seus fios. Sua criação.
        </div>
        <div className="account-actions">
          <span className="account-email" title={user.displayName ?? user.email}>
            {user.displayName ?? user.email}
          </span>
          <button
            type="button"
            className={headerButton}
            onClick={() => setAccountOpen(true)}
            aria-label="Minha conta"
          >
            <UserRound size={17} />
          </button>
          <button type="button" className={headerButton} onClick={handleLogout} aria-label="Sair">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="atelier-main" id="worktable">
        <div className="studio-intro">
          <div>
            <p className="eyebrow">
              <span /> CROCHET VICTORIOSO / ESTÚDIO CRIATIVO
            </p>
            <h1>
              Ideias que viram pontos<span>.</span>
            </h1>
            <p>Um encontro entre suas mãos, suas histórias e a beleza de criar.</p>
          </div>
          <div className="studio-note">
            <Leaf size={21} strokeWidth={1.2} />
            <span>
              Feito com intenção.
              <br />
              <em>Criado com as mãos.</em>
            </span>
          </div>
        </div>
        <section className="creation-launchpad" aria-label="Comece uma criação">
          <button
            className="creation-card collection-card"
            onClick={() => setCreationPanel('templates')}
            aria-label="Explorar 20 modelos"
          >
            <span className="creation-card-icon">
              <LayoutGrid size={22} strokeWidth={1.3} />
            </span>
            <span>
              <span className="creation-kicker">A COLEÇÃO VICTORIOSO</span>
              <strong>20 maneiras de começar.</strong>
              <small>Flores, geometrias e pequenos encantos.</small>
            </span>
            <ArrowUpRight size={19} />
          </button>
          <button
            className="creation-card photo-card"
            onClick={() => setCreationPanel('photo')}
            aria-label="Converter foto em pontos"
          >
            <span className="creation-card-icon">
              <Camera size={23} strokeWidth={1.3} />
            </span>
            <span>
              <span className="creation-kicker">DA INSPIRAÇÃO AO FIO</span>
              <strong>Sua foto, ponto a ponto.</strong>
              <small>Transforme uma imagem em um motivo de mosaico.</small>
            </span>
            <ArrowUpRight size={19} />
          </button>
          <button className="creation-blank" onClick={handleNew} aria-label="Criar padrão em branco">
            <Plus size={20} strokeWidth={1.4} />
            <span>
              Uma tela em branco<small>Para uma ideia só sua</small>
            </span>
          </button>
        </section>
        <div className="document-bar">
          <div className="document-name">
            <PencilLine size={16} />
            <input
              value={design.name}
              onChange={(e) => dispatch({ type: 'rename', name: e.target.value })}
              aria-label="Nome do padrão"
              placeholder="Dê um nome ao seu padrão"
              maxLength={100}
            />
            <span className="document-kind">
              PADRÃO / {rows} × {cols}
            </span>
          </div>
          <div className="document-actions">
            <span className="save-status" role="status">
              {status}
            </span>
            <span className="history-buttons">
              <button
                className="icon-button"
                aria-label="Desfazer"
                title="Desfazer (Ctrl/⌘ Z)"
                disabled={!history.past.length}
                onClick={() => dispatch({ type: 'undo' })}
              >
                <Undo2 size={17} />
              </button>
              <button
                className="icon-button"
                aria-label="Refazer"
                title="Refazer (Ctrl/⌘ Shift Z)"
                disabled={!history.future.length}
                onClick={() => dispatch({ type: 'redo' })}
              >
                <Redo2 size={17} />
              </button>
            </span>
            <button
              type="button"
              className="primary-button"
              onClick={() => save()}
              disabled={saving}
              title="Salvar (Ctrl+S / ⌘S)"
            >
              <Save size={15} /> Salvar padrão
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
        {banner?.kind === 'conflict' && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <p className="min-w-0 flex-1 basis-64">
              <TriangleAlert size={15} className="mr-1 inline align-[-2px]" />"{banner.latest.name}" foi salvo
              em outra sessão ({formatUpdated(banner.latest.updatedAt)}). Carregar versão atual descarta suas
              alterações; Sobrescrever substitui a versão salva pela sua.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className={bannerButton}
                onClick={() => takePattern(banner.latest)}
                disabled={saving}
              >
                Carregar versão atual
              </button>
              <button
                type="button"
                className={bannerButton}
                onClick={() => save(banner.latest.revision)}
                disabled={saving}
              >
                Sobrescrever
              </button>
            </div>
          </div>
        )}
        {banner?.kind === 'errors' && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{banner.title}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 break-words">
                {banner.errors.slice(0, MAX_SHOWN_ERRORS).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              {banner.errors.length > MAX_SHOWN_ERRORS && (
                <p className="mt-1 text-red-700">e mais {banner.errors.length - MAX_SHOWN_ERRORS}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="rounded p-0.5 hover:bg-red-100"
              aria-label="Fechar aviso"
            >
              <Close size={16} />
            </button>
          </div>
        )}

        <div className="studio-layout">
          <Toolbar
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
            onTemplates={() => setCreationPanel('templates')}
            onPhoto={() => setCreationPanel('photo')}
          />

          <section className="worktable-column" aria-label="Bancada de criação">
            <div className="worktable-heading">
              <div>
                <span className="eyebrow">SUA BANCADA DE CRIAÇÃO</span>
                <h2>O próximo ponto é seu.</h2>
              </div>
              <div className="view-switch" role="group" aria-label="Visualização">
                {[
                  { id: 'schematic' as const, label: 'Gráfico', icon: Grid3x3 },
                  { id: 'simulation' as const, label: 'Simulação', icon: Eye },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    aria-pressed={view === id}
                    onClick={() => {
                      setView(id)
                      setNotice(null)
                    }}
                  >
                    {view === id && (
                      <motion.span
                        layoutId="view-pill"
                        className="view-pill"
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      />
                    )}
                    <Icon size={14} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <MosaicGrid
              key={generation.current}
              view={view}
              delta={design.delta}
              X={X}
              conflictX={conflictX}
              colors={design.colors}
              onCellClick={handleCellClick}
              onPaintCells={handlePaintCells}
              onStrokeStart={() => dispatch({ type: 'strokeStart' })}
              onStrokeEnd={() => dispatch({ type: 'strokeEnd' })}
            />
            <div className="pattern-health" aria-live="polite">
              {conflictCells.length > 0 ? (
                <span className="conflict-status">
                  <TriangleAlert size={15} />
                  {conflictCells.length} pontos altos em conflito{' '}
                  <span>· carreiras consecutivas na mesma coluna</span>
                </span>
              ) : (
                <span className="healthy-status">
                  <CircleCheck size={15} /> Seu padrão está livre de conflitos
                </span>
              )}
              <span>{rows * cols} pontos · 2 fios</span>
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={notice ? 'notice' : view}
                className={`worktable-hint ${notice ? 'has-notice' : ''}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
              >
                {notice ? (
                  <>
                    <Lock size={14} />
                    <span>{notice}</span>
                  </>
                ) : (
                  <>
                    <BookOpen size={14} />
                    <span>{HINT[view]}</span>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
            <div className="worktable-caption">
              <span>01 — A BELEZA DE FAZER COM CALMA</span>
              <span>Em cada ponto, uma possibilidade.</span>
            </div>
          </section>

          <aside className="reference-sidebar" aria-label="Caderno de padrões">
            <InstructionsPanel lines={lines} conflictRows={conflictRows} />
            <LibraryPanel
              patterns={patterns}
              error={libraryError}
              currentId={current.id}
              busyId={busyId}
              onOpen={openPattern}
              onDelete={deletePattern}
              onNew={handleNew}
              onRetry={refreshLibrary}
            />
          </aside>
        </div>
        <footer className="studio-footer">
          <span>
            Crochet Victorioso <span>·</span> Onde a inspiração encontra o fio.
          </span>
          <span>UMA CARREIRA DE CADA VEZ.</span>
        </footer>
      </main>
      {creationPanel === 'templates' && (
        <TemplateGallery onClose={() => setCreationPanel(null)} onApply={applyCreation} />
      )}
      {creationPanel === 'photo' && (
        <PhotoPatternDialog
          colors={design.colors}
          onClose={() => setCreationPanel(null)}
          onApply={applyCreation}
        />
      )}
      <AnimatePresence>
        {accountOpen && (
          <AccountDialog
            user={user}
            patternCount={patterns?.length ?? null}
            onClose={() => setAccountOpen(false)}
            onAccountDeleted={onLoggedOut}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
