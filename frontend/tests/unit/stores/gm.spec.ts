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
      expect(store.showNarration).toBe(true)
    })
  })

  describe('narration audio status', () => {
    it('starts with idle audio status', () => {
      const store = useGMStore()
      expect(store.narrationAudioStatus).toBe('idle')
      expect(store.narrationAudioUrl).toBeNull()
    })

    it('transitions to pending on gm_audio_status pending', () => {
      const store = useGMStore()
      // narrationRound is null initially, so any round is accepted
      store.onAudioStatus(makeMsg('gm_audio_status', {
        status: 'pending',
      } as GMAudioStatusData, 1))
      expect(store.narrationAudioStatus).toBe('pending')
    })

    it('transitions to ready with audio URL', () => {
      const store = useGMStore()
      store.onAudioStatus(makeMsg('gm_audio_status', {
        status: 'ready',
        audio_url: '/api/experiments/exp_1/rounds/1/narration/audio',
      } as GMAudioStatusData, 1))
      expect(store.narrationAudioStatus).toBe('ready')
      expect(store.narrationAudioUrl).toBe('/api/experiments/exp_1/rounds/1/narration/audio')
    })

    it('transitions to error', () => {
      const store = useGMStore()
      store.onAudioStatus(makeMsg('gm_audio_status', {
        status: 'error',
        error: 'TTS failed',
      } as GMAudioStatusData, 1))
      expect(store.narrationAudioStatus).toBe('error')
    })

    it('ignores stale audio status from a different round', () => {
      const store = useGMStore()
      // Set up narration for round 2
      store.onPlan(makeMsg('gm_plan', {
        plan: {
          round: 2,
          round_theme: 'Test',
          reasoning: '',
          crisis_event: { type: 'resource', description: '', severity: 'low' },
          resource_modifiers: {},
          narration: 'Day two.',
          meta_hint: null,
        },
      }, 2))
      expect(store.narrationRound).toBe(2)

      // Stale message from round 1 should be ignored
      store.onAudioStatus(makeMsg('gm_audio_status', {
        status: 'ready',
        audio_url: '/audio/round1',
      } as GMAudioStatusData, 1))
      expect(store.narrationAudioStatus).toBe('idle')
      expect(store.narrationAudioUrl).toBeNull()
    })

    it('resets audio state on new plan', () => {
      const store = useGMStore()
      store.onAudioStatus(makeMsg('gm_audio_status', {
        status: 'ready',
        audio_url: '/audio',
      } as GMAudioStatusData, 1))
      expect(store.narrationAudioStatus).toBe('ready')

      store.onPlan(makeMsg('gm_plan', {
        plan: {
          round: 2,
          round_theme: 'Next',
          reasoning: '',
          crisis_event: { type: 'resource', description: '', severity: 'low' },
          resource_modifiers: {},
          narration: 'Day two.',
          meta_hint: null,
        },
      }, 2))
      expect(store.narrationAudioStatus).toBe('idle')
      expect(store.narrationAudioUrl).toBeNull()
    })

    it('resets all narration state on $reset', () => {
      const store = useGMStore()
      store.onAudioStatus(makeMsg('gm_audio_status', {
        status: 'ready',
        audio_url: '/audio',
      } as GMAudioStatusData, 1))
      store.$reset()
      expect(store.narrationAudioStatus).toBe('idle')
      expect(store.narrationAudioUrl).toBeNull()
      expect(store.narrationRound).toBeNull()
      expect(store.isNarrationPlaying).toBe(false)
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
      store.isNarrationPlaying = true
      store.dismissNarration()
      expect(store.showNarration).toBe(false)
      expect(store.isNarrationPlaying).toBe(false)
    })
  })
})
