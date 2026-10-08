import { designReducer, initialDesign, type Design, type DesignAction } from './design'

export interface DesignHistory {
  present: Design
  past: Design[]
  future: Design[]
  inStroke: boolean
  strokeRecorded: boolean
  /** The last recorded edit when it is one a run of events refines (a colour drag, typing a name). */
  refining: string | null
}
export type HistoryAction =
  DesignAction | { type: 'undo' } | { type: 'redo' } | { type: 'strokeStart' } | { type: 'strokeEnd' }
export const initialHistory: DesignHistory = {
  present: initialDesign,
  past: [],
  future: [],
  inStroke: false,
  strokeRecorded: false,
  refining: null,
}

/**
 * The colour picker fires on every input event and the name field on every keystroke; a run of these
 * on the same target is one undo step, so it cannot push the drawing out of the 100-step history.
 */
function refinedTarget(action: DesignAction): string | null {
  if (action.type === 'setColor') return `setColor:${action.yarn}`
  if (action.type === 'rename') return 'rename'
  return null
}

/** A drag is one reversible gesture; no derived crochet data enters history. */
export function historyReducer(state: DesignHistory, action: HistoryAction): DesignHistory {
  if (action.type === 'strokeStart') return { ...state, inStroke: true, strokeRecorded: false, refining: null }
  if (action.type === 'strokeEnd') return { ...state, inStroke: false, strokeRecorded: false, refining: null }
  if (action.type === 'undo') {
    if (!state.past.length) return state
    return {
      ...state,
      present: state.past[state.past.length - 1],
      past: state.past.slice(0, -1),
      future: [state.present, ...state.future],
      inStroke: false,
      strokeRecorded: false,
      refining: null,
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
      refining: null,
    }
  }
  const present = designReducer(state.present, action)
  if (action.type === 'load') return { ...initialHistory, present }
  if (present === state.present) return state
  const refining = refinedTarget(action)
  const merge = (state.inStroke && state.strokeRecorded) || (refining !== null && refining === state.refining)
  return {
    ...state,
    present,
    past: merge ? state.past : [...state.past, state.present].slice(-100),
    future: [],
    strokeRecorded: state.inStroke,
    refining,
  }
}
