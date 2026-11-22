import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

describe('loadConfig', () => {
  it('has development defaults (SPEC §9.5)', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 3000,
      databasePath: './data/mosaic.db',
      publicOrigin: 'http://localhost:5173',
      allowSignup: false,
      cookieSecure: false,
      trustProxy: false,
      sessionTtlDays: 30,
      maxPatternsPerUser: 500,
      staticDir: './dist',
      logLevel: 'info',
    })
  })

  it('requires PUBLIC_ORIGIN in production and defaults COOKIE_SECURE to true there', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/PUBLIC_ORIGIN/)
    const config = loadConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://Mosaic.Example.com/' })
    expect(config.publicOrigin).toBe('https://mosaic.example.com')
    expect(config.cookieSecure).toBe(true)
    expect(loadConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://127.0.0.1:3999', COOKIE_SECURE: 'false' }).cookieSecure).toBe(false)
  })

  it('reads every variable', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '8080',
      DATABASE_PATH: '/var/lib/mosaic/db.sqlite',
      PUBLIC_ORIGIN: 'https://mosaic.example.com:8443',
      ALLOW_SIGNUP: '1',
      COOKIE_SECURE: 'true',
      TRUST_PROXY: '127.0.0.1, 10.0.0.0/8, ::1',
      SESSION_TTL_DAYS: '7',
      MAX_PATTERNS_PER_USER: '50',
      STATIC_DIR: '/srv/mosaic/dist',
      LOG_LEVEL: 'warn',
    })
    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 8080,
      databasePath: '/var/lib/mosaic/db.sqlite',
      publicOrigin: 'https://mosaic.example.com:8443',
      allowSignup: true,
      cookieSecure: true,
      trustProxy: ['127.0.0.1', '10.0.0.0/8', '::1'],
      sessionTtlDays: 7,
      maxPatternsPerUser: 50,
      staticDir: '/srv/mosaic/dist',
      logLevel: 'warn',
    })
  })

  it('accepts TRUST_PROXY as a boolean or a hop count', () => {
    expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true)
    expect(loadConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false)
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(1)
  })

  it('treats an empty value as unset', () => {
    expect(loadConfig({ PORT: '', ALLOW_SIGNUP: ' ' })).toMatchObject({ port: 3000, allowSignup: false })
  })

  it('rejects a bad PORT', () => {
    for (const port of ['abc', '0', '65536', '3000.5', '-1']) {
      expect(() => loadConfig({ PORT: port }), port).toThrow(/PORT/)
    }
  })

  it('lists every invalid variable in one error', () => {
    let message = ''
    try {
      loadConfig({
        NODE_ENV: 'staging',
        PORT: 'x',
        ALLOW_SIGNUP: 'yes',
        COOKIE_SECURE: 'maybe',
        TRUST_PROXY: '10.0.0.0/33,nope',
        SESSION_TTL_DAYS: '0',
        MAX_PATTERNS_PER_USER: '-5',
        LOG_LEVEL: 'loud',
        PUBLIC_ORIGIN: 'https://mosaic.example.com/app',
      })
    } catch (err) {
      message = (err as Error).message
    }
    for (const name of ['NODE_ENV', 'PORT', 'ALLOW_SIGNUP', 'COOKIE_SECURE', 'TRUST_PROXY', 'SESSION_TTL_DAYS', 'MAX_PATTERNS_PER_USER', 'LOG_LEVEL', 'PUBLIC_ORIGIN']) {
      expect(message).toContain(`${name}:`)
    }
  })

  it('rejects origins that browsers would never send', () => {
    for (const origin of ['mosaic.example.com', 'ftp://mosaic.example.com', 'https://mosaic.example.com/app', 'https://u:p@mosaic.example.com', 'https://mosaic.example.com/?q=1']) {
      expect(() => loadConfig({ PUBLIC_ORIGIN: origin }), origin).toThrow(/PUBLIC_ORIGIN/)
    }
  })
})
