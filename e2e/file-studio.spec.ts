import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { fileChartFromTopFirst, rowReading, type FileChart } from '../src/file'

declare global {
  interface Window { cspViolations: string[] }
}

const BASE = 'http://127.0.0.1:3173'
const artifactDirectory = '.scratch/playwright/artifacts'
const runtimeErrors = new WeakMap<Page, string[]>()

// One disposable account for this file, like e2e/studio.spec.ts, to stay under the signup rate limit.
let session: Awaited<ReturnType<BrowserContext['cookies']>> | null = null

async function enterStudio(page: Page) {
  if (session) await page.context().addCookies(session)
  const me = await page.request.get('/api/auth/me')
  if (me.status() === 401) {
    const credentials = { email: `file-${crypto.randomUUID()}@example.com`, password: 'Browser-test-file-2026' }
    const signup = await page.request.post('/api/auth/signup', { data: credentials })
    expect(signup.status()).toBe(201)
    session = await page.context().cookies()
  } else {
    expect(me.status()).toBe(200)
  }
  await page.goto('/')
  await expect(page.getByLabel('Nome do padrão', { exact: true })).toBeVisible()
}

async function openFileStudio(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Abrir estúdio de filé', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Estúdio de filé' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Known 30 x 12 chart, row 0 = TOP of the picture. */
const COLS = 30
const ROWS = 12
const MATRIX: boolean[][] = Array.from({ length: ROWS }, (_, i) =>
  Array.from({ length: COLS }, (_, j) => (i * 3 + j * 5) % 7 < 3 || (j >= 10 && j < 14 && i % 4 === 0)),
)
const EXPECTED: FileChart = fileChartFromTopFirst(MATRIX, { name: 'esperado', colors: { filled: '#b22234', open: '#ffffff' } })

/**
 * Draws the chart inside the page (margins, axis numbers, thin lines, thicker every 10) and returns PNG bytes.
 * `upsideDown` turns the whole picture half a turn, numbers and watermark included, like a screenshot taken upside down.
 */
async function renderChartPng(page: Page, upsideDown = false): Promise<Buffer> {
  const dataUrl = await page.evaluate(({ matrix, cols, rows, upsideDown }) => {
    const cell = 18
    const margin = { left: 46, top: 34, right: 28, bottom: 40 }
    const canvas = document.createElement('canvas')
    canvas.width = margin.left + cols * cell + margin.right
    canvas.height = margin.top + rows * cell + margin.bottom
    const ctx = canvas.getContext('2d')!
    if (upsideDown) ctx.setTransform(-1, 0, 0, -1, canvas.width, canvas.height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        ctx.fillStyle = matrix[i][j] ? '#b22234' : '#ffffff'
        ctx.fillRect(margin.left + j * cell, margin.top + i * cell, cell, cell)
      }
    }
    for (let k = 0; k <= cols; k++) {
      const major = k % 10 === 0
      ctx.fillStyle = major ? '#404040' : '#9a9a9a'
      ctx.fillRect(margin.left + k * cell - (major ? 1 : 0), margin.top, major ? 2 : 1, rows * cell)
    }
    for (let k = 0; k <= rows; k++) {
      const major = (rows - k) % 10 === 0
      ctx.fillStyle = major ? '#404040' : '#9a9a9a'
      ctx.fillRect(margin.left, margin.top + k * cell - (major ? 1 : 0), cols * cell, major ? 2 : 1)
    }
    ctx.fillStyle = '#555555'
    ctx.font = '11px sans-serif'
    for (let r = 1; r <= rows; r++) ctx.fillText(String(r), 8, margin.top + (rows - r) * cell + 13)
    for (let c = 5; c <= cols; c += 5) ctx.fillText(String(c), margin.left + (c - 1) * cell + 3, margin.top + rows * cell + 18)
    ctx.fillStyle = '#c8c8c8'
    ctx.fillText('gráfico de teste', canvas.width - 120, canvas.height - 6)
    return canvas.toDataURL('image/png')
  }, { matrix: MATRIX, cols: COLS, rows: ROWS, upsideDown })
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

/** Click the centre of square (r, c) of the studio canvas (row 1 at the bottom). */
async function clickSquare(dialog: Locator, r: number, c: number) {
  const canvas = dialog.getByRole('img', { name: /^Gráfico filé/ })
  const [cell, gutter, top, rows] = await canvas.evaluate((el) =>
    ['cell', 'gutter', 'top', 'rows'].map((k) => Number((el as HTMLElement).dataset[k])),
  )
  await canvas.scrollIntoViewIfNeeded()
  await canvas.click({ position: { x: gutter + (c - 0.5) * cell, y: top + (rows - r + 0.5) * cell } })
}

async function expectNoHorizontalOverflow(page: Page, dialog: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBeTruthy()
  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(artifactDirectory, name), fullPage: false, animations: 'disabled' })
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
})

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page)).toEqual([])
  if (page.url().startsWith(BASE)) expect(await page.evaluate(() => window.cspViolations)).toEqual([])
})

test('a chart picture becomes a filet chart read row by row, with progress kept across reloads', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (/^https?:/.test(url) && !url.startsWith(`${BASE}/`)) external.push(`${request.method()} ${url}`)
  })
  await enterStudio(page)
  const png = await renderChartPng(page)
  let dialog = await openFileStudio(page)

  // Import: the grid is found and read exactly.
  await dialog.getByRole('button', { name: 'Importar foto ou gráfico', exact: true }).click()
  await dialog.getByLabel('Escolher foto ou print do gráfico', { exact: true }).setInputFiles({ name: 'grafico-teste.png', mimeType: 'image/png', buffer: png })
  await expect(dialog.getByText('Grade detectada: 30 × 12 quadradinhos', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('img', { name: 'Gráfico lido: 30 × 12 quadradinhos' })).toBeVisible()
  await shot(page, 'file-studio-import-desktop.png')
  await dialog.getByRole('button', { name: 'Usar este gráfico', exact: true }).click()
  await expect(dialog.getByText('12 carreiras × 30 colunas', { exact: false })).toBeVisible()

  // The exported document holds exactly the drawn matrix (cells[0] = row 1 = bottom of the picture).
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Exportar JSON', exact: true }).click()
  const exported = JSON.parse(await readFile((await (await download).path())!, 'utf8')) as { cells: string[]; colors: { filled: string; open: string } }
  expect(exported.cells).toEqual(EXPECTED.filled.map((row) => row.map((v) => (v ? '1' : '0')).join('')))
  expect(exported.colors.open).toMatch(/^#f[0-9a-f]f[0-9a-f]f[0-9a-f]$/)
  await shot(page, 'file-studio-editar-desktop.png')

  // Tecer: tap a square of row 3; the reader says what src/file says for that row.
  await dialog.getByRole('button', { name: 'Tecer', exact: true }).click()
  await clickSquare(dialog, 3, 7)
  const reader = dialog.locator('.file-reader')
  await expect(reader.getByRole('heading', { name: 'Carreira 3 de 12' })).toBeVisible()
  const row3 = rowReading(EXPECTED, 3)
  await expect(dialog.getByTestId('file-reader-text')).toHaveText(row3.text)
  await expect(reader.getByText(row3.direction, { exact: true })).toBeVisible()
  await expect(reader.getByText(`Trecho 1 de ${row3.segments.length}`, { exact: true })).toBeVisible()

  await reader.getByRole('button', { name: 'Carreira ▶', exact: true }).click()
  const row4 = rowReading(EXPECTED, 4)
  expect(row4.direction).not.toBe(row3.direction)
  await expect(reader.getByRole('heading', { name: 'Carreira 4 de 12' })).toBeVisible()
  await expect(dialog.getByTestId('file-reader-text')).toHaveText(row4.text)
  await expect(reader.getByText(row4.direction, { exact: true })).toBeVisible()

  await reader.getByRole('button', { name: 'Carreira feita', exact: true }).click()
  await expect(reader.getByRole('button', { name: 'Carreira feita', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(reader.getByText('1 de 12 carreiras feitas', { exact: true })).toBeVisible()

  // Keyboard: ↑ next row, ↓ back, → next segment.
  await page.keyboard.press('ArrowUp')
  await expect(reader.getByRole('heading', { name: 'Carreira 5 de 12' })).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(reader.getByRole('heading', { name: 'Carreira 4 de 12' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(reader.getByText(`Trecho 2 de ${row4.segments.length}`, { exact: true })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(reader.getByText(`Trecho 1 de ${row4.segments.length}`, { exact: true })).toBeVisible()

  // The full recipe lists every row and selects one.
  const recipe = dialog.getByRole('region', { name: 'Receita completa' })
  await expect(recipe.getByRole('button')).toHaveCount(12)
  await expect(recipe.getByRole('button', { name: rowReading(EXPECTED, 1).text })).toBeVisible()
  await dialog.evaluate((node) => node.scrollTo({ top: 0 }))
  await shot(page, 'file-studio-tecer-desktop.png')

  // Reload: the chart, the row and the done state come back.
  await page.waitForTimeout(400)
  await page.reload()
  await expect(page.getByLabel('Nome do padrão', { exact: true })).toBeVisible()
  dialog = await openFileStudio(page)
  await expect(dialog.getByRole('button', { name: 'Tecer', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const restored = dialog.locator('.file-reader')
  await expect(restored.getByRole('heading', { name: 'Carreira 4 de 12' })).toBeVisible()
  await expect(dialog.getByTestId('file-reader-text')).toHaveText(row4.text)
  await expect(restored.getByRole('button', { name: 'Carreira feita', exact: true })).toHaveAttribute('aria-pressed', 'true')
  for (const r of [1, 7, 12]) {
    await recipe.getByRole('button', { name: rowReading(EXPECTED, r).text }).click()
    await expect(dialog.getByTestId('file-reader-text')).toHaveText(rowReading(EXPECTED, r).text)
  }
  await recipe.getByRole('button', { name: row4.text }).click()

  // Phone: nothing scrolls sideways; the reader stays first.
  await page.setViewportSize({ width: 390, height: 844 })
  await dialog.evaluate((node) => node.scrollTo({ top: 0 }))
  await expectNoHorizontalOverflow(page, dialog)
  await expect(restored.getByRole('heading', { name: 'Carreira 4 de 12' })).toBeInViewport()
  for (const name of ['◀ Trecho', 'Trecho ▶', '◀ Carreira', 'Carreira ▶', 'Carreira feita']) {
    const box = await restored.getByRole('button', { name, exact: true }).boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(48)
  }
  await shot(page, 'file-studio-tecer-mobile.png')
  await dialog.getByRole('button', { name: 'Editar', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Editar', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('button', { name: 'Tecer', exact: true })).toHaveAttribute('aria-pressed', 'false')
  // The chart refits the narrower screen: it does not scroll sideways inside its panel either.
  expect(await dialog.locator('.file-chart-scroll').evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBeTruthy()
  await expectNoHorizontalOverflow(page, dialog)
  await shot(page, 'file-studio-editar-mobile.png')
  await dialog.getByRole('button', { name: 'Importar foto ou gráfico', exact: true }).click()
  await dialog.getByLabel('Escolher foto ou print do gráfico', { exact: true }).setInputFiles({ name: 'grafico-teste.png', mimeType: 'image/png', buffer: png })
  await expect(dialog.getByText('Grade detectada: 30 × 12 quadradinhos', { exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page, dialog)
  await shot(page, 'file-studio-import-mobile.png')

  expect(external).toEqual([])
})

test('editing: tap toggles, a drag is one undo step, bad JSON is explained and Escape closes', async ({ page }) => {
  await enterStudio(page)
  const launcher = page.getByRole('button', { name: 'Abrir estúdio de filé', exact: true })
  const dialog = await openFileStudio(page)
  await expect(dialog.getByText('10 carreiras × 20 colunas', { exact: false })).toBeVisible()
  const exportCells = async () => {
    const download = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Exportar JSON', exact: true }).click()
    return (JSON.parse(await readFile((await (await download).path())!, 'utf8')) as { cells: string[] }).cells
  }

  await clickSquare(dialog, 1, 1)
  expect((await exportCells())[0][0]).toBe('1')

  // Drag along row 2 from column 2 to 8: one stroke.
  const canvas = dialog.getByRole('img', { name: /^Gráfico filé/ })
  const [cell, gutter, top, rows] = await canvas.evaluate((el) => ['cell', 'gutter', 'top', 'rows'].map((k) => Number((el as HTMLElement).dataset[k])))
  const box = (await canvas.boundingBox())!
  const y = box.y + top + (rows - 2 + 0.5) * cell
  await page.mouse.move(box.x + gutter + 1.5 * cell, y)
  await page.mouse.down()
  await page.mouse.move(box.x + gutter + 7.5 * cell, y, { steps: 6 })
  await page.mouse.up()
  expect((await exportCells())[1]).toBe('0' + '1'.repeat(7) + '0'.repeat(12))

  await dialog.getByRole('button', { name: 'Desfazer', exact: true }).focus()
  await page.keyboard.press('Control+z')
  let cells = await exportCells()
  expect(cells[1]).toBe('0'.repeat(20))
  expect(cells[0][0]).toBe('1')
  await page.keyboard.press('Control+Shift+z')
  cells = await exportCells()
  expect(cells[1].slice(1, 8)).toBe('1111111')

  await dialog.getByLabel('Escolher arquivo JSON do gráfico filé', { exact: true }).setInputFiles({
    name: 'quebrado.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'crochet-file-pattern', version: 1, name: 'x', rows: 2, cols: 2, colors: { filled: '#000000', open: '#ffffff' }, cells: ['01'] })),
  })
  await expect(dialog.getByRole('alert')).toContainText('cells: esperadas 2 carreiras')

  await dialog.getByLabel('Carreiras', { exact: true }).fill('3')
  await dialog.getByLabel('Colunas', { exact: true }).fill('5')
  await dialog.getByRole('button', { name: 'Aplicar tamanho', exact: true }).click()
  await expect(dialog.getByText('3 carreiras × 5 colunas', { exact: false })).toBeVisible()

  // A picture without a grid asks for the size, and the counts typed are used.
  const blob = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 300
    canvas.height = 200
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 300, 200)
    ctx.fillStyle = '#20304a'
    ctx.beginPath()
    ctx.arc(150, 100, 70, 0, Math.PI * 2)
    ctx.fill()
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await dialog.getByRole('button', { name: 'Importar foto ou gráfico', exact: true }).click()
  await dialog.getByLabel('Escolher foto ou print do gráfico', { exact: true }).setInputFiles({ name: 'circulo.png', mimeType: 'image/png', buffer: Buffer.from(blob, 'base64') })
  await expect(dialog.getByText('Grade não encontrada — informe o tamanho', { exact: true })).toBeVisible()
  await dialog.getByRole('spinbutton', { name: 'Colunas', exact: true }).fill('24')
  await dialog.getByRole('spinbutton', { name: 'Carreiras', exact: true }).fill('16')
  await expect(dialog.getByRole('img', { name: 'Gráfico lido: 24 × 16 quadradinhos' })).toBeVisible()
  await dialog.getByRole('spinbutton', { name: 'Carreiras', exact: true }).fill('0')
  await expect(dialog.getByText('Use números inteiros de 1 a 200.', { exact: true })).toBeVisible()
  await dialog.getByRole('spinbutton', { name: 'Carreiras', exact: true }).fill('16')
  await dialog.getByRole('button', { name: 'Usar este gráfico', exact: true }).click()
  await expect(dialog.getByText('16 carreiras × 24 colunas', { exact: false })).toBeVisible()
  const circle = await exportCells()
  // The content box hugs the circle: its corners are open, its middle closed.
  expect([circle[0][0], circle[0][23], circle[15][0], circle[15][23], circle[8][12]]).toEqual(['0', '0', '0', '0', '1'])

  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(launcher).toBeFocused()
})

test('an upside-down chart is turned before it is read; the size can be corrected and restored', async ({ page }) => {
  await enterStudio(page)
  const png = await renderChartPng(page, true)
  const dialog = await openFileStudio(page)
  await dialog.getByRole('button', { name: 'Importar foto ou gráfico', exact: true }).click()
  await dialog.getByLabel('Escolher foto ou print do gráfico', { exact: true }).setInputFiles({ name: 'grafico-de-cabeca-para-baixo.png', mimeType: 'image/png', buffer: png })
  await expect(dialog.getByText('Grade detectada: 30 × 12 quadradinhos', { exact: true })).toBeVisible()
  const rotate = dialog.getByRole('button', { name: 'Girar 180°', exact: true })
  const mirror = dialog.getByRole('button', { name: 'Espelhar', exact: true })
  const use = dialog.getByRole('button', { name: 'Usar este gráfico', exact: true })
  await expect(rotate).toHaveAttribute('aria-pressed', 'false')
  await expect(mirror).toHaveAttribute('aria-pressed', 'false')

  // Size correction: another count re-reads the grid; the detected size comes back with one click.
  await dialog.getByText('Corrigir tamanho', { exact: true }).click()
  const colsField = dialog.getByRole('spinbutton', { name: 'Colunas', exact: true })
  const rowsField = dialog.getByRole('spinbutton', { name: 'Carreiras', exact: true })
  await expect(colsField).toHaveValue('30')
  await expect(rowsField).toHaveValue('12')
  await colsField.fill('31')
  await expect(dialog.getByRole('img', { name: 'Gráfico lido: 31 × 12 quadradinhos' })).toBeVisible()
  await expect(dialog.getByText('Lendo como 31 × 12 quadradinhos (tamanho corrigido).', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Grade detectada: 30 × 12 quadradinhos', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Usar tamanho detectado', exact: true }).click()
  await expect(dialog.getByRole('img', { name: 'Gráfico lido: 30 × 12 quadradinhos' })).toBeVisible()
  await expect(colsField).toHaveValue('30')
  await expect(dialog.getByRole('button', { name: 'Usar tamanho detectado', exact: true })).toBeDisabled()

  // A new analysis is visibly busy: spinner shown and the controls disabled until it is done.
  await dialog.evaluate((node) => {
    const seen = { busy: false }
    ;(window as unknown as { busySeen: typeof seen }).busySeen = seen
    new MutationObserver(() => {
      const spinner = node.querySelector('.file-import-busy')
      const buttons = ['Usar este gráfico', 'Girar 180°', 'Espelhar'].map((name) =>
        [...node.querySelectorAll('button')].find((b) => b.textContent?.trim() === name),
      )
      if (spinner && buttons.every((b) => b?.disabled)) seen.busy = true
    }).observe(node, { subtree: true, childList: true, attributes: true })
  })
  // Rapid changes: only the last value's reading may end up on screen.
  const sensitivity = dialog.getByRole('slider', { name: /^Sensibilidade/ })
  await sensitivity.fill('1')
  await sensitivity.fill('-1')
  await sensitivity.fill('0')
  await expect.poll(() => page.evaluate(() => (window as unknown as { busySeen: { busy: boolean } }).busySeen.busy)).toBe(true)
  await expect(use).toBeEnabled()
  await expect(rotate).toBeEnabled()

  // Turn it: the reference is shown the way it is read.
  await expect(dialog.getByRole('img', { name: 'Imagem de referência importada', exact: true })).toBeVisible()
  await rotate.click()
  await expect(rotate).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('img', { name: 'Imagem de referência importada, girada 180°', exact: true })).toBeVisible()
  await mirror.click()
  await expect(dialog.getByRole('img', { name: 'Imagem de referência importada, girada 180°, espelhada', exact: true })).toBeVisible()
  await mirror.click()
  await expect(mirror).toHaveAttribute('aria-pressed', 'false')
  await dialog.evaluate((node) => node.scrollTo({ top: 0 }))
  await shot(page, 'file-studio-import-orientation-desktop.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await expectNoHorizontalOverflow(page, dialog)
  await dialog.getByRole('group', { name: 'Orientação do gráfico' }).scrollIntoViewIfNeeded()
  await shot(page, 'file-studio-import-orientation-mobile.png')
  await page.setViewportSize({ width: 1440, height: 1000 })

  await use.click()
  await expect(dialog.getByText('12 carreiras × 30 colunas', { exact: false })).toBeVisible()
  await dialog.getByRole('button', { name: 'Tecer', exact: true }).click()
  const row1 = rowReading(EXPECTED, 1)
  await dialog.getByRole('region', { name: 'Receita completa' }).getByRole('button', { name: row1.text }).click()
  await expect(dialog.locator('.file-reader').getByRole('heading', { name: 'Carreira 1 de 12' })).toBeVisible()
  await expect(dialog.getByTestId('file-reader-text')).toHaveText(row1.text)

  // The orientation starts over with a new picture.
  await dialog.getByRole('button', { name: 'Editar', exact: true }).click()
  await dialog.getByRole('button', { name: 'Importar foto ou gráfico', exact: true }).click()
  await dialog.getByLabel('Escolher foto ou print do gráfico', { exact: true }).setInputFiles({ name: 'grafico-de-cabeca-para-baixo.png', mimeType: 'image/png', buffer: png })
  await expect(dialog.getByText('Grade detectada: 30 × 12 quadradinhos', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Girar 180°', exact: true })).toHaveAttribute('aria-pressed', 'false')
})
