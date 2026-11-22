import { describe, expect, it, vi } from 'vitest'
import { createSpeaker, pickVoice, type SpeechEnvironment } from './speech'

const voice = (lang: string, name = lang, localService = false) => ({ lang, name, localService }) as SpeechSynthesisVoice

class FakeUtterance {
  lang = ''
  voice: SpeechSynthesisVoice | null = null
  rate = 1
  constructor(public text: string) {}
}

function environment(voices: SpeechSynthesisVoice[] = []) {
  const calls: string[] = []
  const spoken: FakeUtterance[] = []
  const synth = {
    cancel: vi.fn(() => calls.push('cancel')),
    speak: vi.fn((u: SpeechSynthesisUtterance) => {
      calls.push('speak')
      spoken.push(u as unknown as FakeUtterance)
    }),
    getVoices: vi.fn(() => voices),
  }
  const env = { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance } as unknown as SpeechEnvironment
  return { env, synth, calls, spoken }
}

describe('pickVoice', () => {
  it('prefers a local pt-BR voice, then any pt-BR, then any Portuguese voice', () => {
    expect(pickVoice([voice('en-US'), voice('pt-PT'), voice('pt-BR', 'a'), voice('pt_BR', 'b', true)])?.name).toBe('b')
    expect(pickVoice([voice('en-US'), voice('pt-PT'), voice('PT-br', 'c')])?.name).toBe('c')
    expect(pickVoice([voice('en-US'), voice('pt-PT')])?.lang).toBe('pt-PT')
    expect(pickVoice([voice('en-US')])).toBeNull()
  })
})

describe('createSpeaker', () => {
  it('is an unsupported no-op without speech synthesis', () => {
    const speaker = createSpeaker({})
    expect(speaker.supported).toBe(false)
    expect(() => speaker.speak('Carreira 1')).not.toThrow()
    expect(() => speaker.cancel()).not.toThrow()
    expect(createSpeaker(undefined).supported).toBe(false)
  })

  it('cancels before speaking, in pt-BR with a Brazilian voice', () => {
    const { env, calls, spoken } = environment([voice('en-US'), voice('pt-BR', 'Luciana')])
    const speaker = createSpeaker(env)
    expect(speaker.supported).toBe(true)
    speaker.speak('Carreira 3, da direita para a esquerda.')
    expect(calls).toEqual(['cancel', 'speak'])
    expect(spoken[0].text).toBe('Carreira 3, da direita para a esquerda.')
    expect(spoken[0].lang).toBe('pt-BR')
    expect(spoken[0].voice?.name).toBe('Luciana')
  })

  it('keeps lang pt-BR when no Portuguese voice exists and ignores blank text', () => {
    const { env, synth, spoken } = environment([voice('en-US')])
    const speaker = createSpeaker(env)
    speaker.speak('   ')
    expect(synth.speak).not.toHaveBeenCalled()
    speaker.speak('1 fechado')
    expect(spoken[0].voice).toBeNull()
    expect(spoken[0].lang).toBe('pt-BR')
  })

  it('swallows engine errors', () => {
    const { env, synth } = environment()
    synth.speak.mockImplementation(() => {
      throw new Error('engine down')
    })
    synth.cancel.mockImplementation(() => {
      throw new Error('engine down')
    })
    const speaker = createSpeaker(env)
    expect(() => speaker.speak('2 abertos')).not.toThrow()
    expect(() => speaker.cancel()).not.toThrow()
  })
})
