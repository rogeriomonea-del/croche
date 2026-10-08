import { emptyMatrix, resize, toggle, type Matrix, type Yarn } from '../core'

/** The whole drawing: which cells deviate from their stripe, plus the two yarn colours (SPEC §2). */
export interface Design {
  delta: Matrix
  colors: Record<Yarn, string>
}

export type DesignAction =
  | { type: 'toggle'; r: number; c: number }
  | { type: 'resize'; rows: number; cols: number }
  | { type: 'setColor'; yarn: Yarn; color: string }
  | { type: 'swapColors' }
  | { type: 'clear' }

export const initialDesign: Design = {
  delta: emptyMatrix(15, 20),
  colors: { main: '#f3ead8', pattern: '#0f766e' },
}

export function designReducer(state: Design, action: DesignAction): Design {
  switch (action.type) {
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
  }
}
