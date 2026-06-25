// src/store/corpusStore.voiceProfiles.test.ts
import { describe, it, expect } from 'vitest'
import { makeCorpusStore } from './corpusStore'
import type { CorpusRepository } from '../lib/corpus'
import type { VoiceProfile } from '../ai/prompts/voiceProfile'

const PROFILE: VoiceProfile = {
  handle: 'aanya', displayName: 'Aanya', fromScripts: false, vocabulary: [], formality: '',
  sentenceRhythm: '', audienceAddress: '', toneDescriptors: [], hookHabits: [],
  emotionalRegister: '', structuralPattern: '', personaConsistencyScore: 5, reelCount: 8, builtAt: 1,
}

function fakeRepo(): CorpusRepository {
  const profiles = new Map<string, VoiceProfile>([['aanya', PROFILE]])
  return {
    remember: async () => [], get: async () => undefined, getMany: async () => [],
    setFeedback: async () => undefined, list: async () => [], count: async () => 0,
    rememberContent: async () => {}, listContentFor: async () => [], listAllContent: async () => [],
    clear: async () => {},
    upsertVoiceProfile: async (h, p) => { profiles.set(h, p) },
    getVoiceProfile: async (h) => profiles.get(h),
    listVoiceProfiles: async () => [...profiles.values()],
  }
}

describe('corpusStore voice profiles', () => {
  it('hydrate loads voice profiles into the store map', async () => {
    const useStore = makeCorpusStore(fakeRepo())
    await useStore.getState().hydrate()
    expect(useStore.getState().voiceProfiles.aanya?.displayName).toBe('Aanya')
  })

  it('setVoiceProfile writes through the repo and mirrors into the map', async () => {
    const useStore = makeCorpusStore(fakeRepo())
    await useStore.getState().hydrate()
    await useStore.getState().setVoiceProfile('bhavna', { ...PROFILE, handle: 'bhavna', displayName: 'Bhavna' })
    expect(useStore.getState().voiceProfiles.bhavna?.displayName).toBe('Bhavna')
  })
})
