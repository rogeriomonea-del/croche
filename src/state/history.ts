import { designReducer, initialDesign, type Design, type DesignAction } from './design'

export interface DesignHistory {
  present: Design
  past: Design[]
  future: Design[]
  inStroke: boolean
  strokeRecorded: boolean
}
export type HistoryAction =
  DesignAction | { type: 'undo' } | { type: 'redo' } | { type: 'strokeStart' } | { type: 'strokeEnd' }
export const initialHistory: DesignHistory = {
  present: initialDesign,
  past: [],
  future: [],
  inStroke: false,
  strokeRecorded: false,
}

/** A drag is one reversible gesture; no derived crochet data enters history. */
export function historyReducer(state: DesignHistory, action: HistoryAction): DesignHistory {
  if (action.type === 'strokeStart') return { ...state, inStroke: true, strokeRecorded: false }
  if (action.type === 'strokeEnd') return { ...state, inStroke: false, strokeRecorded: false }
  if (action.type === 'undo') {
    if (!state.past.length) return state
    return {
      ...state,
      present: state.past[state.past.length - 1],
      past: state.past.slice(0, -1),
      future: [state.present, ...state.future],
      inStroke: false,
      strokeRecorded: false,
    }
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state
    return {
      ...state,
      present: state.future[0],
      past: [...state.past, state.present].slice(-100),
      future: state.future.slice(1),
      inStroke: false,
      strokeRecorded: false,
    }
  }
  const present = designReducer(state.present, action)
  if (action.type === 'load') return { ...initialHistory, present }
  if (present === state.present) return state
  return {
    ...state,
    present,
    past: state.inStroke && state.strokeRecorded ? state.past : [...state.past, state.present].slice(-100),
    future: [],
    strokeRecorded: state.inStroke,
  }
}
