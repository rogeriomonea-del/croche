// Retrying code that failed to download. A browser keeps a failed import() for its URL (Chromium
// answers the same error again without fetching), so a retry asks for the same file under a fresh
// URL; and a stylesheet that failed stays failed, so it is linked again.

/** The script URL a failed dynamic import names (Chromium and Firefox put it in the message). */
export function failedImportUrl(error: unknown): string | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return message.match(/https?:\/\/[^\s'"]+?\.js(?:\?[^\s'"]*)?/)?.[0] ?? null
}

/** The same address with a query that makes the browser fetch it anew. */
export function freshUrl(url: string, attempt: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`
}

/** A same-origin stylesheet that did not load: Chromium leaves an empty sheet whose rules cannot be read. */
function failedSheet(link: HTMLLinkElement, origin: string): boolean {
  if (!link.href || new URL(link.href).origin !== origin) return false
  try {
    return !link.sheet || !link.sheet.cssRules
  } catch {
    return true
  }
}

/** Links again, under a fresh URL, every same-origin stylesheet of this page that failed to load. */
export function relinkFailedStylesheets(doc: Document, attempt: number): void {
  for (const link of Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) {
    if (!failedSheet(link, doc.location.origin)) continue
    const again = link.cloneNode() as HTMLLinkElement
    again.href = freshUrl(link.href, attempt)
    link.replaceWith(again)
  }
}
