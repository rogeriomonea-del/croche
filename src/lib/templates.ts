import { emptyMatrix, type DesignData } from '../core'

export const TEMPLATE_CATEGORIES = ['Geometria', 'Botânica', 'Afeto', 'Paisagens e bordas'] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

export interface CrochetTemplate {
  id: string
  name: string
  category: TemplateCategory
  description: string
  suggestedUse: string
  level: 'Essencial' | 'Intermediário'
  design: DesignData
}

type Motif = (x: number, y: number) => boolean

const PALETTES = {
  plum: { main: '#f3e9db', pattern: '#52384e' },
  pine: { main: '#f5eedf', pattern: '#315846' },
  clay: { main: '#f5eada', pattern: '#a25e46' },
  gold: { main: '#fcf5e6', pattern: '#896338' },
  indigo: { main: '#f0eadd', pattern: '#38465e' },
}

/** Coordinates are top-down like a sketch. The output remains the core's bottom-up delta.
 * Each motif row occupies one two-row repeat. Deviations only occur on even rows,
 * so the generated stitches never compete for adjacent anchoring rows. */
function weave(name: string, width: number, height: number, motif: Motif, palette: keyof typeof PALETTES): DesignData {
  const delta = emptyMatrix(height * 2 + 1, width)
  for (let y = 0; y < height; y++) {
    const r = 2 * (height - y)
    for (let x = 0; x < width; x++) delta[r - 1][x] = !motif(x, y)
  }
  return { name, delta, colors: { ...PALETTES[palette] } }
}

function sprite(lines: readonly string[], left = 0, top = 0): Motif {
  return (x, y) => lines[y - top]?.[x - left] === '#'
}

function repeat(motif: Motif, width: number, height: number): Motif {
  return (x, y) => motif(x % width, y % height)
}

function centeredDistance(value: number, period: number): number {
  return Math.abs((value % period) - (period - 1) / 2)
}

const heart = sprite([
  '.##...##.',
  '####.####',
  '#########',
  '#########',
  '.#######.',
  '..#####..',
  '...###...',
  '....#....',
], 1, 1)
const tulip = sprite([
  '.#...#.',
  '.##.##.',
  '.#####.',
  '..###..',
  '...#...',
  '.#.#.#.',
  '..###..',
  '...#...',
], 1, 1)
const daisy = sprite([
  '...###...',
  '.#.###.#.',
  '###.#.###',
  '.#######.',
  '..##.##..',
  '.#######.',
  '###.#.###',
  '.#.###.#.',
  '...###...',
], 1, 1)
const butterfly = sprite([
  '#.....#',
  '##.#.##',
  '#######',
  '.#####.',
  '..###..',
  '.#####.',
  '.##.##.',
  '..#.#..',
], 1, 1)
const house = sprite([
  '....#....',
  '...###...',
  '..#####..',
  '.#######.',
  '#########',
  '.#######.',
  '.##.#.##.',
  '.#######.',
  '.##..###.',
  '.##..###.',
], 1, 3)
const bow = sprite([
  '.##.....##.',
  '.###...###.',
  '.####.####.',
  '..#######..',
  '....###....',
  '...##.##...',
  '..##...##..',
  '.###...###.',
], 1, 1)
const greek = sprite([
  '########..',
  '........#.',
  '.######.#.',
  '.#....#.#.',
  '.#.##.#.#.',
  '.#..#.#.#.',
  '.####.#.#.',
  '......#.#.',
  '#######..#',
  '..........',
])

const specifications: Array<{
  id: string
  name: string
  category: TemplateCategory
  description: string
  suggestedUse: string
  level: CrochetTemplate['level']
  width: number
  height: number
  motif: Motif
  palette: keyof typeof PALETTES
}> = [
  {
    id: 'losangos-imperiais', name: 'Losangos imperiais', category: 'Geometria',
    description: 'Diamantes concêntricos, desenhados como pequenas joias na trama.',
    suggestedUse: 'Mantas e almofadas', level: 'Essencial', width: 32, height: 16, palette: 'plum',
    motif: (x, y) => {
      const distance = centeredDistance(x, 16) + centeredDistance(y, 16)
      return Math.abs(distance - 7) <= 1 || distance <= 2
    },
  },
  {
    id: 'chevron-de-linho', name: 'Chevron de linho', category: 'Geometria',
    description: 'O ritmo clássico do zigue-zague em faixas largas e contínuas.',
    suggestedUse: 'Passadeiras e cachecóis', level: 'Essencial', width: 32, height: 16, palette: 'clay',
    motif: (x, y) => ((y + Math.floor(centeredDistance(x, 16))) % 8) < 3,
  },
  {
    id: 'entrelace-ancestral', name: 'Entrelace ancestral', category: 'Geometria',
    description: 'Fitas alternadas compõem uma trama que lembra a cestaria artesanal.',
    suggestedUse: 'Bolsas e cestos', level: 'Intermediário', width: 32, height: 16, palette: 'gold',
    motif: (x, y) => {
      const over = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0
      return over ? y % 8 >= 2 && y % 8 <= 5 : x % 8 >= 2 && x % 8 <= 5
    },
  },
  {
    id: 'estrelas-de-oito-pontas', name: 'Estrelas de oito pontas', category: 'Geometria',
    description: 'Uma constelação de estrelas inspirada nos bordados de inverno.',
    suggestedUse: 'Colchas e painéis', level: 'Intermediário', width: 34, height: 17, palette: 'indigo',
    motif: (x, y) => {
      const dx = centeredDistance(x, 17), dy = centeredDistance(y, 17)
      return (dx <= 2 && dy <= 7) || (dy <= 2 && dx <= 7) || (Math.abs(dx - dy) <= 1 && dx <= 5)
    },
  },
  {
    id: 'azulejo-portugues', name: 'Azulejo português', category: 'Geometria',
    description: 'Pequenas cruzes florais emolduradas por uma grade de azulejos.',
    suggestedUse: 'Jogos americanos', level: 'Intermediário', width: 33, height: 17, palette: 'indigo',
    motif: (x, y) => {
      const dx = centeredDistance(x, 8), dy = centeredDistance(y, 8)
      return x % 8 === 0 || y % 8 === 0 || (dx + dy <= 2) || (dx <= 0.5 && dy <= 2.5) || (dy <= 0.5 && dx <= 2.5)
    },
  },
  {
    id: 'jardim-de-tulipas', name: 'Jardim de tulipas', category: 'Botânica',
    description: 'Flores de caule delicado em um jardim que se repete ponto a ponto.',
    suggestedUse: 'Barras de manta', level: 'Essencial', width: 27, height: 20, palette: 'clay',
    motif: repeat(tulip, 9, 10),
  },
  {
    id: 'margaridas-do-campo', name: 'Margaridas do campo', category: 'Botânica',
    description: 'Pétalas geométricas com miolo vazado, como flores prensadas em linho.',
    suggestedUse: 'Almofadas e bolsas', level: 'Intermediário', width: 33, height: 22, palette: 'gold',
    motif: repeat(daisy, 11, 11),
  },
  {
    id: 'ramo-de-oliveira', name: 'Ramo de oliveira', category: 'Botânica',
    description: 'Um ramo central com pares de folhas, para uma peça serena e natural.',
    suggestedUse: 'Painéis e capas', level: 'Intermediário', width: 25, height: 21, palette: 'pine',
    motif: (x, y) => {
      const stem = 12 + Math.round(Math.sin(y / 5) * 2)
      if (x === stem && y >= 1) return true
      for (const leafY of [3, 8, 13, 18]) {
        const direction = x < stem ? -1 : 1
        const dx = (x - stem) * direction
        const dy = y - leafY + dx * 0.6
        if (dx >= 2 && dx <= 7 && ((dx - 4.5) ** 2 / 8 + dy ** 2 / 2.8) <= 1) return true
      }
      return false
    },
  },
  {
    id: 'samambaia-serena', name: 'Samambaia serena', category: 'Botânica',
    description: 'Folhagens simétricas que se abrem sobre um fundo de linhas delicadas.',
    suggestedUse: 'Caminhos de mesa', level: 'Intermediário', width: 30, height: 20, palette: 'pine',
    motif: (x, y) => {
      const dx = Math.abs((x % 15) - 7)
      return (dx === 0 && y > 1) || (y > 2 && y < 18 && dx <= Math.min(6, y / 2) && (y + dx) % 4 === 0)
    },
  },
  {
    id: 'folhas-ao-vento', name: 'Folhas ao vento', category: 'Botânica',
    description: 'Folhas alongadas dançam em fileiras desencontradas.',
    suggestedUse: 'Xales e mantas', level: 'Essencial', width: 32, height: 20, palette: 'plum',
    motif: (x, y) => {
      const localX = (x + (Math.floor(y / 10) % 2) * 4) % 8
      const localY = y % 10
      return Math.abs(localX - 3.5) / 3 + Math.abs(localY - 4.5) / 4 < 1 && localX !== Math.round(localY * 0.6)
    },
  },
  {
    id: 'coracoes-entrelacados', name: 'Corações entrelaçados', category: 'Afeto',
    description: 'Uma coleção de pequenos corações para presentear com as próprias mãos.',
    suggestedUse: 'Mantas de bebê', level: 'Essencial', width: 33, height: 20, palette: 'plum',
    motif: repeat(heart, 11, 10),
  },
  {
    id: 'borboletas-livres', name: 'Borboletas livres', category: 'Afeto',
    description: 'Asas abertas e traços delicados em uma composição leve e alegre.',
    suggestedUse: 'Peças infantis', level: 'Essencial', width: 27, height: 20, palette: 'clay',
    motif: repeat(butterfly, 9, 10),
  },
  {
    id: 'lua-de-inverno', name: 'Lua de inverno', category: 'Afeto',
    description: 'Uma lua crescente sob pequenas estrelas, para noites aconchegantes.',
    suggestedUse: 'Painéis e mantas', level: 'Intermediário', width: 29, height: 21, palette: 'indigo',
    motif: (x, y) => {
      const moon = (x - 13) ** 2 + (y - 10) ** 2 < 65 && (x - 16) ** 2 + (y - 8) ** 2 > 49
      const stars = [[23, 4], [5, 3], [24, 15], [4, 16]].some(([cx, cy]) => Math.abs(x - cx) + Math.abs(y - cy) <= 1)
      return moon || stars
    },
  },
  {
    id: 'casinhas-do-vale', name: 'Casinhas do vale', category: 'Afeto',
    description: 'Telhados, janelinhas e portas formam uma pequena vila acolhedora.',
    suggestedUse: 'Barras e almofadas', level: 'Essencial', width: 33, height: 16, palette: 'clay',
    motif: (x, y) => repeat(house, 11, 16)(x, y) || y === 14,
  },
  {
    id: 'lacos-de-memoria', name: 'Laços de memória', category: 'Afeto',
    description: 'Laços de fita com pontas soltas, inspirados em um delicado enxoval.',
    suggestedUse: 'Enxovais e presentes', level: 'Essencial', width: 26, height: 20, palette: 'plum',
    motif: repeat(bow, 13, 10),
  },
  {
    id: 'mare-mansa', name: 'Maré mansa', category: 'Paisagens e bordas',
    description: 'Ondas paralelas trazem o movimento tranquilo da água para a trama.',
    suggestedUse: 'Mantas e passadeiras', level: 'Essencial', width: 36, height: 18, palette: 'indigo',
    motif: (x, y) => ((y + Math.round(Math.sin(x * Math.PI / 12) * 2) + 24) % 6) < 2,
  },
  {
    id: 'arcos-do-claustro', name: 'Arcos do claustro', category: 'Paisagens e bordas',
    description: 'Arcadas em camadas, inspiradas na serenidade da arquitetura antiga.',
    suggestedUse: 'Bordas de colchas', level: 'Intermediário', width: 36, height: 18, palette: 'gold',
    motif: (x, y) => {
      const dx = centeredDistance(x + Math.floor(y / 9) * 6, 12)
      const arch = Math.round(Math.sqrt(Math.max(0, 25 - dx * dx)))
      return Math.abs((y % 9) - (7 - arch)) <= 1
    },
  },
  {
    id: 'grega-vitoriosa', name: 'Grega vitoriosa', category: 'Paisagens e bordas',
    description: 'Um meandro contínuo e marcante para emoldurar suas melhores peças.',
    suggestedUse: 'Acabamentos e barras', level: 'Intermediário', width: 30, height: 12, palette: 'plum',
    motif: (x, y) => y === 0 || y === 11 || repeat(greek, 10, 10)(x, y - 1),
  },
  {
    id: 'conchas-da-costa', name: 'Conchas da costa', category: 'Paisagens e bordas',
    description: 'Leques de conchas com nervuras, repetidos como lembranças do litoral.',
    suggestedUse: 'Bolsas e caminhos', level: 'Intermediário', width: 33, height: 20, palette: 'clay',
    motif: (x, y) => {
      const dx = Math.abs((x % 11) - 5), dy = y % 10
      return dy >= 1 && dy <= 8 && dx <= (8 - dy) * 0.8 && (dy === 1 || dx === 0 || Math.abs(dx - (8 - dy) * 0.75) < 0.7 || dx === 2)
    },
  },
  {
    id: 'montanhas-da-aurora', name: 'Montanhas da aurora', category: 'Paisagens e bordas',
    description: 'Picos sobrepostos e um pequeno sol compõem uma paisagem de fios.',
    suggestedUse: 'Painéis e almofadas', level: 'Intermediário', width: 35, height: 21, palette: 'pine',
    motif: (x, y) => {
      const sun = (x - 27) ** 2 + (y - 4) ** 2 <= 5
      const first = Math.abs(x - 12) * 0.72 + 4
      const second = Math.abs(x - 26) * 0.65 + 10
      return sun || Math.abs(y - first) < 1.4 || Math.abs(y - second) < 1.4 || y === 19
    },
  },
]

/** Original studio motifs; these are editable crochet documents, not decorative images. */
export const CROCHET_TEMPLATES: readonly CrochetTemplate[] = specifications.map(({ width, height, motif, palette, ...details }) => ({
  ...details,
  design: weave(details.name, width, height, motif, palette),
}))

/** Give every application its own boolean matrix so an edit cannot change a gallery specimen. */
export function createTemplateDesign(id: string): DesignData {
  const template = CROCHET_TEMPLATES.find((item) => item.id === id)
  if (!template) throw new Error(`Modelo desconhecido: ${id}`)
  return {
    name: template.design.name,
    delta: template.design.delta.map((row) => [...row]),
    colors: { ...template.design.colors },
  }
}
