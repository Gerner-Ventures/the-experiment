import { setActivePinia, createPinia } from 'pinia'
import { useGMStore } from '@/stores/gm'
import type { WSMessage } from '@/types/websocket'
import type { GMAudioStatusData } from '@/types/websocket'

function makeMsg<T>(type: string, data: T, round = 1): WSMessage<T> {
  return { type: type as WSMessage['type'], round, timestamp: new Date().toISOString(), data }
}

describe('useGMStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('narration from gm_plan', () => {
    it('extracts narration text from gm_plan message', () => {
      const store = useGMStore()
      store.onPlan(makeMsg('gm_plan', {
        plan: {
          round: 1,
          round_theme: 'Test',
          reasoning: '',
          crisis_event: { type: 'resource', description: '', severity: 'low' },
          resource_modifiers: {},
          narration: 'Day one begins.',
          meta_hint: null,
        },
      }))
      expect(store.narrationText).toBe('Day one begins.')
      expect(store.narrationId).toBeNull()
      expect(store.showNarration).toBe(true)
    })
  })

  describe('narration audio status', () => {
    it('starts with idle audio status', () => {
      const store = useGMStore()
      expect(store.narrationId).toBeNull()
      expect(store.narrationAudioStatus).toBe('idle')
      expect(store.narrationAudioUrl).toBeNull()
      expect(store.narrationAudioError).toBeNull()
    })

    it('transitions to pending on gm_audio_status pending while narration id is unresolved', () => {
      const store = useGMStore()
      store.setNarrationFallback('Day one begins.', 1)
      store.onAudioStatus(makeMsg('gm_audio_status', {
        status: 'pending',
        narration_id: 'narr-1',
      } as GMAudioStatusData, 1))
      expect(store.narrationAudioStatus).toBe('pending')
      expect(store.narrationId).toBeNull()
    })

    it('hydrates canonical narration metadata and applies a queued ready event when ids match', () => {
      const store = useGMStore()
      store.setNarrationFallback('Fallback narration.', 1)
      store.onAudioStatus(makeMsg('gm_audio_status', {
        status: 'ready',
        narration_id: 'narr-1',
        audio_url: '/api/experiments/exp_1/rounds/1/narration/audio?v=narr-1',
      } as GMAudioStatusData, 1))

      expect(store.narrationAudioStatus).toBe('idle')

      store.hydrateNarration('Resolved narration.', 1, 'narr-1', 'pending', null)

      expect(store.narrationText).toBe('Resolved narration.')
      expect(store.narrationId).toBe('narr-1')
      expect(store.narrationAudioStatus).toBe('ready')
      expect(store.narrationAudioUrl).toBe('/api/experiments/exp_1/rounds/1/narration/audio?v=narr-1')
    })

    it('transitions to error', () => {
      const store = useGMStore()
      store.hydrateNarration('Resolved narration.', 1, 'narr-1', 'pending', null)
      store.onAudioStatus(makeMsg('gm_audio_status', {
        status: 'error',
        narration_id: 'narr-1',
        error: 'TTS failed',
      } as GMAudioStatusData, 1))
      expect(store.narrationAudioStatus).toBe('error')
      expect(store.narrationAudioError).toBe('TTS failed')
    })

    it('ignores stale queued ready status after a same-round narration revision', () => {
      const store = useGMStore()
      store.setNarrationFallback('Original narration.', 2)
      store.onAudioStatus(makeMsg('gm_audio_status', {
        status: 'ready',
        narration_id: 'old-narration',
        audio_url: '/audio/round2?v=old',
      } as GMAudioStatusData, 2))

      store.hydrateNarration('Revised narration.', 2, 'new-narration', 'pending', null)

      expect(store.narrationId).toBe('new-narration')
      expect(store.narrationAudioStatus).toBe('pending')
      expect(store.narrationAudioUrl).toBeNull()
    })

    it('applies a queued error status after metadata hydrates with a cached ready URL', () => {
      const store = useGMStore()
      store.setNarrationFallback('Fallback narration.', 2)
      store.onAudioStatus(makeMsg('gm_audio_status', {
        status: 'error',
        narration_id: 'narr-2',
        error: 'Audio expired',
      } as GMAudioStatusData, 2))

      store.hydrateNarration('Resolved narration.', 2, 'narr-2', 'ready', '/audio/round2?v=narr-2')

      expect(store.narrationAudioStatus).toBe('error')
      expect(store.narrationAudioUrl).toBeNull()
      expect(store.narrationAudioError).toBe('Audio expired')
    })

    it('ignores stale audio status from a different round', () => {
      const store = useGMStore()
      store.hydrateNarration('Day two.', 2, 'narr-2', 'pending', null)
      store.onAudioStatus(makeMsg('gm_audio_status', {
        status: 'ready',
        narration_id: 'narr-1',
        audio_url: '/audio/round1',
      } as GMAudioStatusData, 1))
      expect(store.narrationAudioStatus).toBe('pending')
      expect(store.narrationAudioUrl).toBeNull()
    })

    it('ignores stale audio status for a different narration id in the same round', () => {
      const store = useGMStore()
      store.hydrateNarration('Day two.', 2, 'narr-2', 'pending', null)
      store.onAudioStatus(makeMsg('gm_audio_status', {
        status: 'ready',
        narration_id: 'old-narr-2',
        audio_url: '/audio/round2?v=old',
      } as GMAudioStatusData, 2))
      expect(store.narrationAudioStatus).toBe('pending')
      expect(store.narrationAudioUrl).toBeNull()
    })

    it('resets audio state on new plan identity', () => {
      const store = useGMStore()
      store.hydrateNarration('Resolved narration.', 1, 'narr-1', 'ready', '/audio?v=narr-1')
      expect(store.narrationAudioStatus).toBe('ready')

      store.onPlan(makeMsg('gm_plan', {
        plan: {
          round: 1,
          round_theme: 'Next',
          reasoning: '',
          crisis_event: { type: 'resource', description: '', severity: 'low' },
          resource_modifiers: {},
          narration: 'Revised round one.',
          meta_hint: null,
        },
      }, 1))
      expect(store.narrationId).toBeNull()
      expect(store.narrationAudioStatus).toBe('idle')
      expect(store.narrationAudioUrl).toBeNull()
    })

    it('resets all narration state on $reset', () => {
      const store = useGMStore()
      store.hydrateNarration('Resolved narration.', 1, 'narr-1', 'error', null, 'TTS failed')
      store.$reset()
      expect(store.narrationId).toBeNull()
      expect(store.narrationAudioStatus).toBe('idle')
      expect(store.narrationAudioUrl).toBeNull()
      expect(store.narrationAudioError).toBeNull()
      expect(store.narrationRound).toBeNull()
      expect(store.isNarrationPlaying).toBe(false)
    })
  })

  describe('legacy onNarration', () => {
    it('resets stale audio state from previous round', () => {
      const store = useGMStore()
      store.hydrateNarration('Day one.', 1, 'narr-1', 'ready', '/audio/r1')
      expect(store.narrationAudioStatus).toBe('ready')
      expect(store.narrationAudioUrl).toBe('/audio/r1')

      // Legacy narration arrives — should clear stale audio state
      store.onNarration(makeMsg('gm_narration', { text: 'New text.' }, 2))
      expect(store.narrationText).toBe('New text.')
      expect(store.narrationRound).toBe(2)
      expect(store.narrationId).toBeNull()
      expect(store.narrationAudioStatus).toBe('idle')
      expect(store.narrationAudioUrl).toBeNull()
    })
  })

  describe('dismissNarration', () => {
    it('hides narration and stops playing', () => {
      const store = useGMStore()
      store.onPlan(makeMsg('gm_plan', {
        plan: {
          round: 1,
          round_theme: 'Test',
          reasoning: '',
          crisis_event: { type: 'resource', description: '', severity: 'low' },
          resource_modifiers: {},
          narration: 'Day one.',
          meta_hint: null,
        },
      }))
      store.setNarrationPlaying(true)
      store.dismissNarration()
      expect(store.showNarration).toBe(false)
      expect(store.isNarrationPlaying).toBe(false)
    })
  })
})
