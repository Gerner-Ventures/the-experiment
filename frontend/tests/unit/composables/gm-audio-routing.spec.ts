import { setActivePinia, createPinia } from 'pinia'
import { useGMStore } from '@/stores/gm'

describe('gm_audio_status WebSocket routing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('gmStore.onAudioStatus handles ready status', () => {
    const store = useGMStore()
    store.setNarrationFallback('Fallback narration.', 2)
    store.onAudioStatus({
      type: 'gm_audio_status',
      round: 2,
      timestamp: new Date().toISOString(),
      data: {
        status: 'ready',
        narration_id: 'narr-2',
        audio_url: '/api/experiments/e1/rounds/2/narration/audio?v=narr-2',
      },
    })
    expect(store.narrationAudioStatus).toBe('idle')

    store.hydrateNarration('Resolved narration.', 2, 'narr-2', 'pending', null)
    expect(store.narrationAudioStatus).toBe('ready')
    expect(store.narrationAudioUrl).toBe('/api/experiments/e1/rounds/2/narration/audio?v=narr-2')
  })

  it('gmStore.onAudioStatus handles pending status', () => {
    const store = useGMStore()
    store.setNarrationFallback('Fallback narration.', 3)
    store.onAudioStatus({
      type: 'gm_audio_status',
      round: 3,
      timestamp: new Date().toISOString(),
      data: { status: 'pending', narration_id: 'narr-3' },
    })
    expect(store.narrationAudioStatus).toBe('pending')
  })

  it('gmStore.onAudioStatus handles error status', () => {
    const store = useGMStore()
    store.hydrateNarration('Resolved narration.', 3, 'narr-3', 'pending', null)
    store.onAudioStatus({
      type: 'gm_audio_status',
      round: 3,
      timestamp: new Date().toISOString(),
      data: { status: 'error', narration_id: 'narr-3', error: 'TTS timeout' },
    })
    expect(store.narrationAudioStatus).toBe('error')
  })
})
