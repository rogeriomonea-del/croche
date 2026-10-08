import { execFile } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

declare global {
  interface Window { cspViolations: string[] }
}

type PatternDocument = {
  format: string
  version: number
  name: string
  rows: number
  cols: number
  colors: { A: string; B: string }
  cells: string[]
  derived?: { chart: string[]; instructions: string[]; conflicts: number[][] }
}

const blankDocument = (name = 'Browser test fabric', rows = 15, cols = 20): PatternDocument => ({
  format: 'mosaic-crochet-pattern',
  version: 1,
  name,
  rows,
  cols,
  colors: { A: '#f3ead8', B: '#0f766e' },
  cells: Array.from({ length: rows }, () => '0'.repeat(cols)),
})

const artifactDirectory = process.env.PLAYWRIGHT_ARTIFACT_DIR ?? '.scratch/playwright/screenshots'
const runtimeErrors = new WeakMap<Page, string[]>()
const runFile = promisify(execFile)
const photoFixture = join(import.meta.dirname, 'fixtures', 'woven-study.png')

// Reuse a disposable session across non-auth tests rather than issuing a burst of signups.
// The production rate limiter stays enabled; logout/expiration naturally trigger a fresh account.
let studioSession: {
  credentials: { email: string; password: string }
  cookies: Awaited<ReturnType<BrowserContext['cookies']>>
} | null = null

async function enterStudio(page: Page) {
  if (studioSession) await page.context().addCookies(studioSession.cookies)
  const me = await page.request.get('/api/auth/me')
  if (me.status() === 401) {
    const credentials = { email: `studio-${crypto.randomUUID()}@example.com`, password: 'Browser-test-thread-2026' }
    const signup = await page.request.post('/api/auth/signup', { data: credentials })
    expect(signup.status()).toBe(201)
    studioSession = { credentials, cookies: await page.context().cookies() }
  } else {
    expect(me.status()).toBe(200)
  }
  await page.goto('/')
  await expect(page.getByLabel('Nome do padrão', { exact: true })).toBeVisible()
  return studioSession!.credentials
}

async function importDocument(page: Page, document: PatternDocument) {
  await page.locator('input[type=file][accept*=json]').setInputFiles({
    name: 'browser-pattern.mosaic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  })
  await expect(page.getByLabel('Nome do padrão', { exact: true })).toHaveValue(document.name)
}

async function exportDocument(page: Page): Promise<PatternDocument> {
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: /Exportar JSON/i }).click()
  const download = await downloadEvent
  const path = await download.path()
  expect(path).not.toBeNull()
  return JSON.parse(await readFile(path!, 'utf8')) as PatternDocument
}

const cell = (page: Page, row: number, col: number) => page.locator(`[data-r="${row}"][data-c="${col}"]`).first()

async function clickCell(page: Page, row: number, col: number) {
  await cell(page, row, col).click()
}

async function savePattern(page: Page) {
  const saved = page.waitForResponse((response) => /\/api\/patterns(?:\/[^/]+)?$/.test(response.url()) && ['POST', 'PUT'].includes(response.request().method()))
  await page.getByRole('button', { name: 'Salvar padrão' }).click()
  const response = await saved
  expect(response.ok()).toBeTruthy()
  return (await response.json()).pattern as { id: string; revision: number; document: PatternDocument }
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  runtimeErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))
  await mkdir(artifactDirectory, { recursive: true })
  await page.addInitScript(() => {
    ;window.cspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      ;window.cspViolations.push(`${event.violatedDirective}: ${event.blockedURI}`)
    })
  })
  page.on('dialog', (dialog) => dialog.accept())
})

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page)).toEqual([])
  if (page.url().startsWith('http://127.0.0.1:3173')) {
    expect(await page.evaluate(() => window.cspViolations)).toEqual([])
  }
})

test('public atelier loads with production CSP and no runtime errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const response = await page.goto('/')
  expect(response?.headers()['content-security-policy']).toContain("default-src 'self'")
  await expect(page.getByLabel('Nome de usuário ou e-mail', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Senha', { exact: true })).toBeVisible()
  await page.getByRole('group', { name: 'Acesso à conta', exact: true }).getByRole('button', { name: 'Criar conta', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Criar meu ateliê' })).toBeVisible()
  await page.getByRole('group', { name: 'Acesso à conta', exact: true }).getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.screenshot({ path: join(artifactDirectory, 'victorioso-login.png'), fullPage: true })
  expect(errors).toEqual([])
  expect(await page.evaluate(() => window.cspViolations)).toEqual([])
})

test('two clicks toggle one delta and chart stitches stay derived; locked rows explain why', async ({ page }) => {
  await enterStudio(page)
  await importDocument(page, blankDocument())
  await clickCell(page, 5, 5)
  let document = await exportDocument(page)
  expect(document.cells[4][4]).toBe('1')
  expect(document.derived?.chart[5][4]).toBe('1')
  expect(document.cells.flatMap((row) => [...row]).filter((value) => value === '1')).toHaveLength(1)
  await clickCell(page, 5, 5)
  document = await exportDocument(page)
  expect(document.cells.every((row) => /^0+$/.test(row))).toBeTruthy()
  await clickCell(page, 1, 5)
  await expect(page.getByText(/A carreira 1 é a base/i)).toBeVisible()
  await clickCell(page, 15, 5)
  await expect(page.getByText(/A carreira 15 é o topo/i)).toBeVisible()
  await page.getByRole('button', { name: 'Gráfico', exact: true }).click()
  await clickCell(page, 6, 5)
  document = await exportDocument(page)
  expect(document.cells[4][4]).toBe('1')
  expect(document.derived?.chart[5][4]).toBe('1')
  await clickCell(page, 2, 5)
  await expect(page.getByText(/primeiro fica na carreira 3/i)).toBeVisible()
})

test('one drag paints a continuous stroke and undo restores the whole gesture', async ({ page }) => {
  await enterStudio(page)
  await importDocument(page, blankDocument())
  await cell(page, 5, 4).hover()
  const start = await cell(page, 5, 4).boundingBox()
  const end = await cell(page, 5, 9).boundingBox()
  expect(start).not.toBeNull()
  expect(end).not.toBeNull()
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2)
  await page.mouse.down()
  await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 2 })
  await page.mouse.up()
  let document = await exportDocument(page)
  expect(document.cells[4].slice(3, 9)).toBe('111111')
  await page.getByRole('button', { name: /^Desfazer/i }).click()
  document = await exportDocument(page)
  expect(document.cells.every((row) => /^0+$/.test(row))).toBeTruthy()
  await page.getByRole('button', { name: /^Refazer/i }).click()
  expect((await exportDocument(page)).cells[4].slice(3, 9)).toBe('111111')
  await page.getByRole('button', { name: 'Apagar ponto (E)' }).click()
  await clickCell(page, 5, 5)
  expect((await exportDocument(page)).cells[4].slice(3, 9)).toBe('101111')

  const zoom = page.locator('.canvas-zoom-value')
  const beforeZoom = await zoom.textContent()
  await page.locator('.canvas-viewport').hover()
  await page.mouse.wheel(0, -120)
  await expect(zoom).not.toHaveText(beforeZoom!)
  const position = page.locator('.canvas-position')
  const beforePan = await position.getAttribute('style')
  await page.locator('.canvas-viewport').focus()
  await page.keyboard.down('Space')
  const viewport = await page.locator('.canvas-viewport').boundingBox()
  await page.mouse.move(viewport!.x + viewport!.width / 2, viewport!.y + viewport!.height / 2)
  await page.mouse.down()
  await page.mouse.move(viewport!.x + viewport!.width / 2 + 45, viewport!.y + viewport!.height / 2 + 35, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await expect(position).not.toHaveAttribute('style', beforePan!)
  expect((await exportDocument(page)).cells[4].slice(3, 9)).toBe('101111')
  await page.getByRole('button', { name: 'Enquadrar tecido', exact: true }).click()
})

test('save, reload, reopen and revision-conflict resolution use the real API', async ({ page }) => {
  await enterStudio(page)
  await importDocument(page, blankDocument('Saved woven study'))
  await clickCell(page, 5, 5)
  const saved = await savePattern(page)
  expect(saved.document.cells[4][4]).toBe('1')
  await page.reload()
  await page.getByRole('button', { name: 'Abrir Saved woven study', exact: true }).click()
  await expect(page.getByLabel('Nome do padrão', { exact: true })).toHaveValue('Saved woven study')
  expect((await exportDocument(page)).cells[4][4]).toBe('1')

  const elsewhere = { ...saved.document, name: 'Updated elsewhere' }
  const updated = await page.request.put(`/api/patterns/${saved.id}`, { data: { revision: saved.revision, document: elsewhere } })
  expect(updated.ok()).toBeTruthy()
  await clickCell(page, 7, 6)
  const conflict = page.waitForResponse((response) => response.status() === 409)
  await page.getByRole('button', { name: 'Salvar padrão' }).click()
  await conflict
  await expect(page.getByRole('alert')).toContainText('em outra sessão')
  await page.getByRole('button', { name: 'Carregar versão atual', exact: true }).click()
  await expect(page.getByLabel('Nome do padrão', { exact: true })).toHaveValue('Updated elsewhere')
  expect((await exportDocument(page)).cells[6][5]).toBe('0')
})

test('imports, palettes and resizing preserve the boolean drawing model', async ({ page }) => {
  await enterStudio(page)
  const imported = blankDocument('Imported linen study')
  imported.cells[4] = '00001000000000000000'
  await importDocument(page, imported)
  const exported = await exportDocument(page)
  expect(exported.cells).toEqual(imported.cells)
  expect(exported.colors).toEqual(imported.colors)
  await page.locator('input[type=file][accept*=json]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"wrong"}') })
  await expect(page.getByRole('alert')).toContainText('Não foi possível importar')
  expect((await exportDocument(page)).cells).toEqual(imported.cells)
  await page.getByLabel('Fio B nome', { exact: true }).fill('Ember red')
  expect((await exportDocument(page)).name).toBe(imported.name)
  await page.getByRole('button', { name: /Paletas especiais/i }).click()
  await page.getByRole('button', { name: 'Terracota', exact: true }).click()
  const recolored = await exportDocument(page)
  expect(recolored.cells).toEqual(imported.cells)
  expect(recolored.colors).toEqual({ A: '#f1ddca', B: '#a85943' })
  await page.getByRole('combobox', { name: 'Carreiras', exact: true }).selectOption('17')
  await page.getByRole('combobox', { name: 'Pontos', exact: true }).selectOption('25')
  const resized = await exportDocument(page)
  expect([resized.rows, resized.cols]).toEqual([17, 25])
  expect(resized.cells[4][4]).toBe('1')
  expect(resized.cells.flatMap((row) => [...row]).filter((value) => value === '1')).toHaveLength(1)
})

test('expired-session dialog keeps shortcuts from changing the unsaved pattern', async ({ page }) => {
  const credentials = await enterStudio(page)
  await importDocument(page, blankDocument('Uninterrupted work'))
  await clickCell(page, 5, 5)
  expect((await exportDocument(page)).cells[4][4]).toBe('1')
  const logout = await page.request.post('/api/auth/logout', { data: {} })
  expect(logout.status()).toBe(204)
  await page.getByRole('button', { name: 'Salvar padrão', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Sua sessão terminou')
  const login = dialog.locator('button[type=submit]')
  await login.focus()
  await page.keyboard.press('Control+z')
  await dialog.getByLabel('Nome de usuário ou e-mail', { exact: true }).fill(credentials.email)
  await dialog.getByLabel('Senha', { exact: true }).fill(credentials.password)
  await login.click()
  await expect(dialog).not.toBeVisible()
  const exported = await exportDocument(page)
  expect(exported.name).toBe('Uninterrupted work')
  expect(exported.cells[4][4]).toBe('1')
})

test('loading a same-size document ends the previous pointer stroke', async ({ page }) => {
  await enterStudio(page)
  await importDocument(page, blankDocument('First fabric'))
  await cell(page, 5, 4).hover()
  const start = await cell(page, 5, 4).boundingBox()
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2)
  await page.mouse.down()
  await importDocument(page, blankDocument('Second fabric'))
  const end = await cell(page, 5, 9).boundingBox()
  await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 2 })
  await page.mouse.up()
  const exported = await exportDocument(page)
  expect(exported.name).toBe('Second fabric')
  expect(exported.cells.every((row) => /^0+$/.test(row))).toBeTruthy()
})

test('largest supported chart stays contained and editable with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await enterStudio(page)
  await importDocument(page, blankDocument('Large fabric', 119, 120))
  await expect(page.locator('[data-r][data-c]')).toHaveCount(14_280)
  await clickCell(page, 118, 2)
  const exported = await exportDocument(page)
  expect(exported.cells[117][1]).toBe('1')
  await page.getByRole('button', { name: 'Gráfico', exact: true }).click()
  await expect(page.locator('[data-r][data-c]')).toHaveCount(14_280)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()
  expect(errors).toEqual([])
  expect(await page.evaluate(() => window.cspViolations)).toEqual([])
})

test('mobile atelier keeps its controls and canvas inside the viewport', async ({ page }) => {
  await enterStudio(page)
  await page.getByRole('button', { name: 'Explorar 20 modelos', exact: true }).click()
  await page.getByRole('button', { name: 'Usar modelo Losangos imperiais', exact: true }).click()
  await expect(page.locator('[data-r][data-c]')).toHaveCount(1056)
  await page.screenshot({ path: join(artifactDirectory, 'atelier-studio.png'), fullPage: true })
  await page.getByRole('button', { name: 'Gráfico', exact: true }).click()
  await page.screenshot({ path: join(artifactDirectory, 'atelier-chart.png'), fullPage: true })
  await page.getByRole('button', { name: 'Simulação', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByLabel('Nome do padrão', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()
  await page.screenshot({ path: join(artifactDirectory, 'atelier-mobile.png'), fullPage: true })
})


/** Cross-check actual exports, independently from the converter/gallery implementation. */
function expectValidStitches(document: PatternDocument) {
  expect(document.format).toBe('mosaic-crochet-pattern')
  expect(document.rows % 2).toBe(1)
  expect(document.cells).toHaveLength(document.rows)
  expect(document.cells.every((row) => row.length === document.cols && /^[01]+$/.test(row))).toBeTruthy()
  expect(document.cells[0]).toBe('0'.repeat(document.cols))
  expect(document.cells[document.rows - 1]).toBe('0'.repeat(document.cols))
  expect(document.derived?.conflicts).toEqual([])
  expect(document.derived?.chart).toEqual(['0'.repeat(document.cols), ...document.cells.slice(0, -1)])
  expect(document.derived?.instructions).toHaveLength(document.rows)
  expect(document.derived?.instructions.some((line) => line.includes(' dc'))).toBeTruthy()
  for (const [r, line] of document.derived!.instructions.entries()) {
    expect(line).toMatch(new RegExp(`^Row ${r + 1}: `))
    const counts = [...line.matchAll(/(\d+) (sc|dc)/g)].map((match) => Number(match[1]))
    expect(counts.reduce((total, count) => total + count, 0)).toBe(document.cols)
  }
}

async function expectViewportContained(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()
  const dialog = page.getByRole('dialog')
  if (await dialog.count()) {
    const bounds = await dialog.boundingBox()
    const size = page.viewportSize()!
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width + 1)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height + 1)
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBeTruthy()
  }
}

test('a CLI-assigned login name authenticates through the real branded form', async ({ page }) => {
  const credentials = await enterStudio(page)
  const databasePath = process.env.PLAYWRIGHT_DATABASE_PATH
  expect(databasePath).toBeTruthy()
  await runFile(process.execPath, ['dist-server/cli.js', 'user:alias', credentials.email, 'Artesã dos Fios'], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: databasePath! },
  })
  expect((await page.request.post('/api/auth/logout', { data: {} })).status()).toBe(204)
  await page.reload()
  await expect(page).toHaveTitle(/Crochet Victorioso/)
  await expect(page.locator('.victorioso-brand').first()).toContainText('Victorioso')
  await page.getByLabel('Nome de usuário ou e-mail', { exact: true }).fill('  ARTESÃ   DOS FIOS  ')
  await page.getByLabel('Senha', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'Entrar no ateliê', exact: true }).click()
  await expect(page.getByLabel('Nome do padrão', { exact: true })).toBeVisible()
  await expect(page.locator('.account-email')).toHaveText('Artesã dos Fios')
  const me = await page.request.get('/api/auth/me')
  expect((await me.json()).user.displayName).toBe('Artesã dos Fios')
})


test('the gallery contains twenty distinct editable models and supports categories and accent-free search', async ({ page }) => {
  await enterStudio(page)
  await page.getByRole('button', { name: 'Explorar 20 modelos', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Um começo cheio de inspiração.' })
  const cards = dialog.getByRole('button', { name: /^Usar modelo / })
  await expect(cards).toHaveCount(20)
  expect(new Set(await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))).size).toBe(20)
  for (const category of ['Geometria', 'Botânica', 'Afeto', 'Paisagens e bordas']) {
    const filter = dialog.getByRole('group', { name: 'Categorias de modelos' }).getByRole('button', { name: category, exact: true })
    await filter.click()
    await expect(filter).toHaveAttribute('aria-pressed', 'true')
    await expect(cards).toHaveCount(5)
  }
  await dialog.getByRole('button', { name: /^Todos/ }).click()
  await dialog.getByRole('searchbox', { name: 'Buscar modelos' }).fill('coracoes')
  await expect(cards).toHaveCount(1)
  await expect(dialog.getByRole('button', { name: 'Usar modelo Corações entrelaçados', exact: true })).toBeVisible()
  await dialog.getByRole('searchbox', { name: 'Buscar modelos' }).fill('zzzz-nao-existe')
  await expect(cards).toHaveCount(0)
  await expect(dialog.getByText('Nenhum modelo corresponde à sua busca.', { exact: false })).toBeVisible()
  await dialog.getByRole('button', { name: 'Ver todos os modelos', exact: true }).click()
  await expect(cards).toHaveCount(20)
  await page.screenshot({ path: join(artifactDirectory, 'victorioso-template-gallery.png'), fullPage: false })
  await dialog.getByRole('button', { name: 'Usar modelo Losangos imperiais', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByLabel('Nome do padrão', { exact: true })).toHaveValue('Losangos imperiais')
  const document = await exportDocument(page)
  expect([document.rows, document.cols]).toEqual([33, 32])
  expectValidStitches(document)
  await page.screenshot({ path: join(artifactDirectory, 'victorioso-studio.png'), fullPage: true })
})

test('gallery cancellation preserves unsaved stitches and modal keyboard focus', async ({ page }) => {
  await enterStudio(page)
  await importDocument(page, blankDocument('Meu desenho em andamento'))
  await clickCell(page, 5, 5)
  const before = await exportDocument(page)
  const launch = page.getByRole('button', { name: 'Explorar 20 modelos', exact: true })
  await launch.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Fechar galeria de modelos', exact: true }).focus()
  await page.keyboard.press('Shift+Tab')
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBeTruthy()
  await page.keyboard.press('Tab')
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBeTruthy()
  await page.keyboard.press('Control+z')
  page.removeAllListeners('dialog')
  page.once('dialog', (confirmation) => confirmation.dismiss())
  await dialog.getByRole('button', { name: 'Usar modelo Losangos imperiais', exact: true }).click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(launch).toBeFocused()
  expect(await exportDocument(page)).toEqual(before)
  page.on('dialog', (confirmation) => confirmation.accept())
})

test('a local PNG becomes a configurable conflict-free mosaic with derived written stitches', async ({ page }) => {
  await enterStudio(page)
  await page.getByRole('button', { name: 'Converter foto em pontos', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Da fotografia ao fio.' })
  const requests: string[] = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(`${request.method()} ${request.url()}`)
  })
  await dialog.getByLabel('Selecionar foto de crochê', { exact: true }).setInputFiles(photoFixture)
  const original = dialog.getByRole('img', { name: 'Fotografia original selecionada' })
  const preview = dialog.getByRole('img', { name: 'Prévia do mosaico convertido' })
  await expect(preview).toBeVisible()
  await expect(original).toHaveAttribute('width', '320')
  await expect(original).toHaveAttribute('height', '240')
  expect(await original.evaluate((element) => {
    const canvas = element as HTMLCanvasElement
    const pixel = canvas.getContext('2d')!.getImageData(30, 30, 1, 1).data
    return pixel[3] === 255 && pixel[0] > 0
  })).toBeTruthy()
  await dialog.getByLabel('Nome do padrão', { exact: true }).fill('Estudo fotográfico Victorioso')
  await dialog.getByRole('combobox', { name: 'Carreiras', exact: true }).selectOption('31')
  await dialog.getByRole('combobox', { name: 'Pontos por carreira', exact: true }).selectOption('40')
  await expect(preview).toHaveAttribute('viewBox', '0 0 40 31')
  const initialPath = await preview.locator('path').getAttribute('d')
  await dialog.getByRole('checkbox', { name: 'Inverter claro e escuro', exact: true }).check()
  await expect(preview.locator('path')).not.toHaveAttribute('d', initialPath!)
  await dialog.getByRole('checkbox', { name: 'Inverter claro e escuro', exact: true }).uncheck()
  await expect(preview.locator('path')).toHaveAttribute('d', initialPath!)
  await dialog.getByRole('button', { name: 'Recorte central', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Recorte central', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('slider', { name: /^Contraste/ }).focus()
  await page.keyboard.press('End')
  await expect(dialog.getByRole('slider', { name: /^Contraste/ })).toHaveValue('255')
  await expect(dialog.getByRole('button', { name: 'Contraste automático', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await dialog.getByRole('button', { name: 'Contraste automático', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Contraste automático', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByText('Sem conflitos de pontos', { exact: true })).toBeVisible()
  await dialog.getByText('Instruções por carreira (31)', { exact: true }).click()
  await expect(dialog.locator('.photo-pattern-instructions li')).toHaveCount(31)
  await dialog.getByText('Instruções por carreira (31)', { exact: true }).click()
  await dialog.evaluate((element) => element.scrollTo({ top: 0 }))
  await page.screenshot({ path: join(artifactDirectory, 'victorioso-photo-converter.png'), fullPage: false })
  await dialog.getByRole('button', { name: 'Usar este mosaico', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const document = await exportDocument(page)
  expect(document.name).toBe('Estudo fotográfico Victorioso')
  expect([document.rows, document.cols]).toEqual([31, 40])
  expectValidStitches(document)
  expect(requests).toEqual([])
})

test('invalid photos are rejected and cancelling conversion preserves the unsaved drawing', async ({ page }) => {
  await enterStudio(page)
  await importDocument(page, blankDocument('Foto sem perder os pontos'))
  await clickCell(page, 5, 5)
  const before = await exportDocument(page)
  const launch = page.getByRole('button', { name: 'Converter foto em pontos', exact: true })
  await launch.click()
  const dialog = page.getByRole('dialog')
  const input = dialog.getByLabel('Selecionar foto de crochê', { exact: true })
  await input.setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('This is not a PNG image') })
  await expect(dialog.getByRole('alert')).toContainText('PNG, JPEG ou WebP')
  await expect(dialog.getByRole('button', { name: 'Usar este mosaico', exact: true })).toBeDisabled()
  await input.setInputFiles(photoFixture)
  await expect(dialog.getByRole('img', { name: 'Prévia do mosaico convertido' })).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Fechar conversor de foto', exact: true }).focus()
  await page.keyboard.press('Shift+Tab')
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBeTruthy()
  await page.keyboard.press('Tab')
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBeTruthy()
  await page.keyboard.press('Control+z')
  page.removeAllListeners('dialog')
  page.once('dialog', (confirmation) => confirmation.dismiss())
  await dialog.getByRole('button', { name: 'Usar este mosaico', exact: true }).click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(launch).toBeFocused()
  expect(await exportDocument(page)).toEqual(before)
  page.on('dialog', (confirmation) => confirmation.accept())
})

test('the branded login, gallery and photo workbench fit a mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page).toHaveTitle(/Crochet Victorioso/)
  await expect(page.locator('.victorioso-brand').first()).toBeVisible()
  await expectViewportContained(page)
  await page.screenshot({ path: join(artifactDirectory, 'victorioso-login-mobile.png'), fullPage: true })
  await enterStudio(page)
  await expectViewportContained(page)
  await page.getByRole('button', { name: 'Explorar 20 modelos', exact: true }).click()
  const gallery = page.getByRole('dialog')
  await expect(gallery.getByRole('button', { name: /^Usar modelo / })).toHaveCount(20)
  await expectViewportContained(page)
  await page.screenshot({ path: join(artifactDirectory, 'victorioso-gallery-mobile.png'), fullPage: false })
  await gallery.getByRole('button', { name: 'Fechar galeria de modelos', exact: true }).click()
  await page.getByRole('button', { name: 'Converter foto em pontos', exact: true }).click()
  const photo = page.getByRole('dialog')
  await photo.getByLabel('Selecionar foto de crochê', { exact: true }).setInputFiles(photoFixture)
  await expect(photo.getByRole('img', { name: 'Prévia do mosaico convertido' })).toBeVisible()
  await expectViewportContained(page)
  await page.screenshot({ path: join(artifactDirectory, 'victorioso-photo-mobile.png'), fullPage: false })
  await photo.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(photo).not.toBeVisible()
})
