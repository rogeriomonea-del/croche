import { Component, useEffect, useRef, type ReactNode } from 'react'

interface BoundaryProps {
  children: ReactNode
  onRetry: () => void
  onClose: () => void
}

interface BoundaryState {
  failed: boolean
}

/**
 * Keeps a failure of the filet studio (its code failing to download — offline, or a tab opened
 * before a new version went out — or failing to start) inside the studio: the editor behind it,
 * with any unsaved mosaic, stays mounted.
 */
export class FileStudioBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <FileStudioLoadError onRetry={this.props.onRetry} onClose={this.props.onClose} />
  }
}

function FileStudioLoadError({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (element && !element.open) element.showModal()
    return () => {
      element?.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className="file-load-error"
      role="alertdialog"
      aria-labelledby="file-load-error-title"
      aria-describedby="file-load-error-text"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id="file-load-error-title">O Estúdio de filé não abriu</h2>
      <p id="file-load-error-text">
        Não foi possível carregar o estúdio. Verifique a conexão com a internet e tente novamente. Seu mosaico continua no
        editor; se o aplicativo acabou de ser atualizado, salve o mosaico e recarregue a página.
      </p>
      <div className="file-load-error-actions">
        <button type="button" onClick={onClose}>Fechar</button>
        <button type="button" className="is-primary" onClick={onRetry} autoFocus>Tentar novamente</button>
      </div>
    </dialog>
  )
}
