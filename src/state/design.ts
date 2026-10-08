import { emptyMatrix, resize, toggle, type DesignData, type Matrix, type Yarn } from '../core'

export const DEFAULT_NAME = 'Novo padrão'

/** The whole drawing: its name, which cells deviate from their stripe, and the two yarn colours (SPEC §2, §10). */
export interface Design {
  name: string
  delta: Matrix
  colors: Record<Yarn, string>
}

export type DesignAction =
  | { type: 'toggle'; r: number; c: number }
  | { type: 'paint'; cells: { r: number; c: number }[]; value: boolean }
  | { type: 'resize'; rows: number; cols: number }
  | { type: 'setColor'; yarn: Yarn; color: string }
  | { type: 'swapColors' }
  | { type: 'clear' }
  | { type: 'load'; design: DesignData }
  | { type: 'rename'; name: string }

export const initialDesign: Design = {
  name: DEFAULT_NAME,
  delta: emptyMatrix(15, 20),
  colors: { main: '#f3ead8', pattern: '#0f766e' },
}

export function designReducer(state: Design, action: DesignAction): Design {
  switch (action.type) {
    case 'paint': {
      // Already resolved from view coordinates by the editor. Still use the core toggle so
      // protected edge rows cannot be changed by any tool, including an erase stroke.
      let delta = state.delta
      for (const { r, c } of action.cells) {
        if (delta[r - 1]?.[c - 1] !== undefined && delta[r - 1][c - 1] !== action.value) {
          delta = toggle(delta, r, c)
        }
      }
      return delta === state.delta ? state : { ...state, delta }
    }
    case 'toggle': {
      const delta = toggle(state.delta, action.r, action.c)
      return delta === state.delta ? state : { ...state, delta }
    }
    case 'resize':
      return { ...state, delta: resize(state.delta, action.rows, action.cols) }
    case 'setColor':
      return { ...state, colors: { ...state.colors, [action.yarn]: action.color } }
    case 'swapColors':
      return { ...state, colors: { main: state.colors.pattern, pattern: state.colors.main } }
    case 'clear':
      return { ...state, delta: emptyMatrix(state.delta.length, state.delta[0].length) }
    case 'load':
      return { name: action.design.name, delta: action.design.delta, colors: { ...action.design.colors } }
    // Kept as typed: trimming here would eat the space the user is about to type a word after.
    // The document is trimmed when it is validated for saving or export (parseDocument).
    case 'rename':
      return action.name === state.name ? state : { ...state, name: action.name }
  }
}
