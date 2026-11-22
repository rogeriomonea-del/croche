import { describe, expect, it } from 'vitest'
import { failedImportUrl, freshUrl } from './retry-import'

describe('failedImportUrl', () => {
  it('reads the URL Chromium and Firefox name', () => {
    expect(failedImportUrl(new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/FileStudio-D_OTfNBf.js')))
      .toBe('https://example.test/assets/FileStudio-D_OTfNBf.js')
    expect(failedImportUrl(new TypeError('error loading dynamically imported module: http://127.0.0.1:3173/assets/FileStudio-x.js?retry=2')))
      .toBe('http://127.0.0.1:3173/assets/FileStudio-x.js?retry=2')
  })

  it('is null when no script is named', () => {
    expect(failedImportUrl(new TypeError('Importing a module script failed.'))).toBeNull()
    expect(failedImportUrl(new Error('Unable to preload CSS for /assets/FileStudio-B61hClck.css'))).toBeNull()
    expect(failedImportUrl(undefined)).toBeNull()
  })
})

describe('freshUrl', () => {
  it('adds a retry query', () => {
    expect(freshUrl('https://example.test/a.js', 3)).toBe('https://example.test/a.js?retry=3')
    expect(freshUrl('https://example.test/a.js?retry=2', 3)).toBe('https://example.test/a.js?retry=2&retry=3')
  })
})
