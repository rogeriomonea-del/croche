/** The Victorioso monogram: a crochet hook drawing a single, continuous V. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`victorioso-brand ${compact ? 'victorioso-brand-compact' : ''}`}>
      <span className="victorioso-monogram" aria-hidden="true">
        <svg viewBox="0 0 48 56" fill="none">
          <path
            d="M9 16c0-8 7-12 15-12s15 4 15 12v28c-5 1-10 4-15 8-5-4-10-7-15-8V16Z"
            stroke="currentColor"
            strokeWidth=".8"
          />
          <path
            d="m16 19 8 23 11-27c2-5-5-6-6-2"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M17 13c-8 1-8 22 2 22m-5 8h20M19 8h10"
            stroke="currentColor"
            strokeWidth=".8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="victorioso-wordmark">
        <span>Crochet</span>
        <strong>
          Victorioso<span className="brand-period">.</span>
        </strong>
        <small>ATELIÊ DE POSSIBILIDADES</small>
      </span>
    </span>
  )
}
