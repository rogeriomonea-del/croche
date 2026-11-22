// Feature-detected wrapper around the Web Speech API's speech synthesis, speaking Brazilian
// Portuguese. Everything is a silent no-op where the browser has no synthesis.

export interface Speaker {
  readonly supported: boolean
  /** Stops whatever is being said, then says `text`. */
  speak(text: string): void
  cancel(): void
}

/** The parts of `window` used here; injectable for tests. */
export interface SpeechEnvironment {
  speechSynthesis?: Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices'>
  SpeechSynthesisUtterance?: new (text?: string) => SpeechSynthesisUtterance
}

const LANG = 'pt-BR'

function normalise(lang: string): string {
  return lang.replace('_', '-').toLowerCase()
}

/** A pt-BR voice, else any Portuguese voice, else null (the utterance's lang still asks for pt-BR). */
export function pickVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const brazilian = voices.filter((v) => normalise(v.lang) === 'pt-br')
  if (brazilian.length) return brazilian.find((v) => v.localService) ?? brazilian[0]
  return voices.find((v) => normalise(v.lang).startsWith('pt')) ?? null
}

const SILENT: Speaker = { supported: false, speak() {}, cancel() {} }

export function createSpeaker(env: SpeechEnvironment | undefined = typeof window === 'undefined' ? undefined : window): Speaker {
  const synth = env?.speechSynthesis
  const Utterance = env?.SpeechSynthesisUtterance
  if (!synth || typeof Utterance !== 'function') return SILENT
  return {
    supported: true,
    speak(text: string) {
      if (!text.trim()) return
      try {
        synth.cancel()
        const utterance = new Utterance(text)
        utterance.lang = LANG
        // Voices load asynchronously in some browsers: look them up at each call.
        const voice = pickVoice(synth.getVoices() ?? [])
        if (voice) utterance.voice = voice
        utterance.rate = 0.95
        synth.speak(utterance)
      } catch {
        // Speech is a convenience: a failing engine must never break the studio.
      }
    },
    cancel() {
      try {
        synth.cancel()
      } catch {
        // ignore
      }
    },
  }
}
