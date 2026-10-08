import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight, Flower2, Search, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DesignData } from '../core'
import { CROCHET_TEMPLATES, createTemplateDesign, TEMPLATE_CATEGORIES, type TemplateCategory } from '../lib/templates'
import { PatternPreview } from './PatternPreview'
import './gallery.css'

interface TemplateGalleryProps {
  onClose: () => void
  onApply: (design: DesignData) => void
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')

export function TemplateGallery({ onClose, onApply }: TemplateGalleryProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [category, setCategory] = useState<TemplateCategory | 'Todos'>('Todos')
  const [query, setQuery] = useState('')
  const reducedMotion = useReducedMotion()
  const filtered = useMemo(() => {
    const terms = normalize(query).trim().split(/\s+/).filter(Boolean)
    return CROCHET_TEMPLATES.filter((template) => {
      const searchable = normalize(`${template.name} ${template.category} ${template.description} ${template.suggestedUse}`)
      return (category === 'Todos' || template.category === category) && terms.every((term) => searchable.includes(term))
    })
  }, [category, query])

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => {
      element?.close()
      previousFocus?.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className="template-dialog"
      aria-labelledby="template-gallery-title"
      aria-describedby="template-gallery-description"
      onCancel={(event) => { event.preventDefault(); onClose() }}
    >
      <div className="template-dialog-body">
        <header className="template-heading">
          <div className="template-heading-copy">
            <div className="template-eyebrow"><Flower2 size={15} strokeWidth={1.5} /> A COLEÇÃO VICTORIOSO <span>01 — 20</span></div>
            <h2 id="template-gallery-title">Um começo <em>cheio de inspiração.</em></h2>
            <p id="template-gallery-description">20 modelos autorais para começar a tecer. Escolha um motivo e faça dele a sua próxima criação.</p>
          </div>
          <button type="button" onClick={onClose} className="template-close" aria-label="Fechar galeria de modelos"><X size={20} strokeWidth={1.5} /></button>
        </header>

        <div className="template-discovery">
          <div className="template-categories" role="group" aria-label="Categorias de modelos">
            {(['Todos', ...TEMPLATE_CATEGORIES] as const).map((item) => (
              <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={`template-category${category === item ? ' is-active' : ''}`}>
                {item}{item === 'Todos' && <span>20</span>}
              </button>
            ))}
          </div>
          <label className="template-search">
            <Search size={15} strokeWidth={1.6} aria-hidden="true" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar modelos" placeholder="Encontre seu próximo motivo…" />
          </label>
        </div>

        <div className="template-collection-meta">
          <p role="status" aria-live="polite">{filtered.length} {filtered.length === 1 ? 'modelo para explorar' : 'modelos para explorar'}</p>
          <span><Sparkles size={12} aria-hidden="true" /> Duas cores. Infinitas possibilidades.</span>
        </div>

        <div className="template-grid">
          <AnimatePresence initial={false}>
            {filtered.map((template) => (
              <motion.article
                key={template.id}
                layout={!reducedMotion}
                initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.97 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="template-card"
              >
                <button type="button" className="template-choose" aria-label={`Usar modelo ${template.name}`} onClick={() => onApply(createTemplateDesign(template.id))}>
                  <span className="template-specimen">
                    <span className="template-specimen-number">ESTUDO {String(CROCHET_TEMPLATES.indexOf(template) + 1).padStart(2, '0')}</span>
                    <PatternPreview design={template.design} className="template-fabric" />
                    <span className="template-specimen-action" aria-hidden="true"><ArrowUpRight size={16} strokeWidth={1.7} /></span>
                  </span>
                  <span className="template-card-category">{template.category} <span>{template.level}</span></span>
                  <span className="template-card-name">{template.name}</span>
                </button>
                <p className="template-card-description">{template.description}</p>
                <div className="template-card-details">
                  <span>{template.design.delta[0].length} pontos × {template.design.delta.length} carreiras</span>
                  <span className="template-yarns" aria-label="Duas cores de fio"><i style={{ backgroundColor: template.design.colors.main }} /><i style={{ backgroundColor: template.design.colors.pattern }} /></span>
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>

        {filtered.length === 0 && (
          <div className="template-no-results">
            <Flower2 size={32} strokeWidth={1} />
            <h3>A inspiração está por perto.</h3>
            <p>Nenhum modelo corresponde à sua busca. Experimente outro nome ou explore a coleção completa.</p>
            <button type="button" onClick={() => { setCategory('Todos'); setQuery('') }}>Ver todos os modelos <ArrowUpRight size={14} /></button>
          </div>
        )}
        <footer className="template-footer"><span>Crochet Victorioso</span><p>Todos os motivos são editáveis e já respeitam as regras do mosaico em crochê.</p></footer>
      </div>
    </dialog>
  )
}
