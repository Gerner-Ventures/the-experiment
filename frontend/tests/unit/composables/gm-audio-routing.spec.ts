import { setActivePinia, createPinia } from 'pinia'
import { useGMStore } from '@/stores/gm'

describe('gm_audio_status WebSocket routing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('gmStore.onAudioStatus handles ready status', () => {
    const store = useGMStore()
    store.onAudioStatus({
      type: 'gm_audio_status',
      round: 2,
      timestamp: new Date().toISOString(),
      data: { status: 'ready', audio_url: '/api/experiments/e1/rounds/2/narration/audio' },
    })
    expect(store.narrationAudioStatus).toBe('ready')
    expect(store.narrationAudioUrl).toBe('/api/experiments/e1/rounds/2/narration/audio')
  })

  it('gmStore.onAudioStatus handles pending status', () => {
    const store = useGMStore()
    store.onAudioStatus({
      type: 'gm_audio_status',
      round: 3,
      timestamp: new Date().toISOString(),
      data: { status: 'pending' },
    })
    expect(store.narrationAudioStatus).toBe('pending')
  })

  it('gmStore.onAudioStatus handles error status', () => {
    const store = useGMStore()
    store.onAudioStatus({
      type: 'gm_audio_status',
      round: 3,
      timestamp: new Date().toISOString(),
      data: { status: 'error', error: 'TTS timeout' },
    })
    expect(store.narrationAudioStatus).toBe('error')
  })
})
