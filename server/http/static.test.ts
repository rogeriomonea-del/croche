import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { get, makeApp, type TestApp } from '../test/helpers'

let dir: string
let t: TestApp

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mosaic-static-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Mosaic</title><div id="root"></div>')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)')
  writeFileSync(join(dir, 'robots.txt'), 'User-agent: *')
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})
afterEach(async () => {
  await t?.close()
})

describe('static SPA', () => {
  it('serves index.html at / with no-cache and the CSP', async () => {
    t = await makeApp({ staticDir: dir })
    const res = await get(t.app, '/')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/html/)
    expect(res.body).toContain('<div id="root">')
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(res.headers['content-security-policy']).toContain("default-src 'self'")
  })

  it('serves fingerprinted assets as immutable and other files as no-cache', async () => {
    t = await makeApp({ staticDir: dir })
    const asset = await get(t.app, '/assets/index-abc123.js')
    expect(asset.statusCode).toBe(200)
    expect(asset.body).toBe('console.log(1)')
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    const robots = await get(t.app, '/robots.txt')
    expect(robots.statusCode).toBe(200)
    expect(robots.headers['cache-control']).toBe('no-cache')
  })

  it('does not count static files against the 300/min /api rate limit', async () => {
    t = await makeApp({ staticDir: dir })
    for (let i = 0; i < 301; i++) {
      const res = await t.app.inject({ method: 'GET', url: '/assets/index-abc123.js', remoteAddress: '198.51.100.9' })
      expect(res.statusCode).toBe(200)
    }
    expect((await t.app.inject({ method: 'GET', url: '/api/health', remoteAddress: '198.51.100.9' })).statusCode).toBe(200)
  })

  it('falls back to index.html for client-side routes', async () => {
    t = await makeApp({ staticDir: dir })
    for (const url of ['/some/route', '/patterns/123?x=1']) {
      const res = await get(t.app, url)
      expect(res.statusCode, url).toBe(200)
      expect(res.body).toContain('<div id="root">')
      expect(res.headers['cache-control']).toBe('no-cache')
    }
  })

  it('keeps /api misses as JSON 404s and missing assets as 404s', async () => {
    t = await makeApp({ staticDir: dir })
    for (const url of ['/api/nope', '/api/auth/nope', '/assets/missing.js']) {
      const res = await get(t.app, url)
      expect(res.statusCode, url).toBe(404)
      expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } })
    }
    const post = await t.app.inject({ method: 'POST', url: '/some/route' })
    expect(post.statusCode).toBe(404)
  })

  it('serves the API alone when STATIC_DIR is missing', async () => {
    t = await makeApp({ staticDir: join(dir, 'does-not-exist') })
    expect((await get(t.app, '/')).statusCode).toBe(404)
    expect((await get(t.app, '/some/route')).statusCode).toBe(404)
    expect((await get(t.app, '/api/health')).json()).toEqual({ ok: true })
  })
})
