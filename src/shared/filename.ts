// Shared by the SPA downloads and the server's Content-Disposition, so both name files alike.
/** A file name stem from a pattern name: ASCII lowercase words joined by '-', never empty. */
export function fileSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug || 'pattern'
}
