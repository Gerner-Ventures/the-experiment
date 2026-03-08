/**
 * Tests for social store audio state tracking (Task 6).
 */
import { setActivePinia, createPinia } from 'pinia'
import { useSocialStore } from '@/stores/social'
import type { WSMessage } from '@/types/websocket'
import type { AgentSpeechAudioData } from '@/types/websocket'

function makeMsg(type: string, data: Record<string, unknown>, round = 1): WSMessage {
  return { type: type as WSMessage['type'], round, timestamp: '2026-03-07T00:00:00Z', data }
}

describe('Social store audio state tracking', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initializes conversation entries with idle audio status', () => {
    const store = useSocialStore()
    store.onSpeak(makeMsg('agent_speak', {
      agent_id: 'a1',
      agent_name: 'Alice',
      target: 'all',
      message: 'Hello',
    }))
    expect(store.conversations).toHaveLength(1)
    expect(store.conversations[0].audioStatus).toBe('idle')
    expect(store.conversations[0].audioUrl).toBeNull()
    expect(store.conversations[0].round).toBe(1)
    expect(store.conversations[0].index).toBe(0)
  })

  it('computes index as count of same-agent same-round messages', () => {
    const store = useSocialStore()
    store.onSpeak(makeMsg('agent_speak', {
      agent_id: 'a1', agent_name: 'Alice', target: 'all', message: 'First',
    }))
    store.onSpeak(makeMsg('agent_speak', {
      agent_id: 'a1', agent_name: 'Alice', target: 'all', message: 'Second',
    }))
    store.onSpeak(makeMsg('agent_speak', {
      agent_id: 'a2', agent_name: 'Bob', target: 'all', message: 'Hi',
    }))
    expect(store.conversations[0].index).toBe(0)
    expect(store.conversations[1].index).toBe(1)
    expect(store.conversations[2].index).toBe(0) // different agent
  })

  it('computes index per-round', () => {
    const store = useSocialStore()
    store.onSpeak(makeMsg('agent_speak', {
      agent_id: 'a1', agent_name: 'Alice', target: 'all', message: 'R1',
    }, 1))
    store.onSpeak(makeMsg('agent_speak', {
      agent_id: 'a1', agent_name: 'Alice', target: 'all', message: 'R2',
    }, 2))
    expect(store.conversations[0].index).toBe(0)
    expect(store.conversations[1].index).toBe(0) // different round
  })

  it('onSpeechAudio updates matching conversation entry to ready', () => {
    const store = useSocialStore()
    store.onSpeak(makeMsg('agent_speak', {
      agent_id: 'a1', agent_name: 'Alice', target: 'all', message: 'Hello',
    }))

    const audioMsg: WSMessage<AgentSpeechAudioData> = {
      type: 'agent_speech_audio',
      round: 1,
      timestamp: '2026-03-07T00:00:01Z',
      data: {
        agent_id: 'a1',
        round: 1,
        index: 0,
        status: 'ready',
        audio_url: 'https://example.com/audio.mp3',
      },
    }
    store.onSpeechAudio(audioMsg)

    expect(store.conversations[0].audioStatus).toBe('ready')
    expect(store.conversations[0].audioUrl).toBe('https://example.com/audio.mp3')
  })

  it('onSpeechAudio handles error status', () => {
    const store = useSocialStore()
    store.onSpeak(makeMsg('agent_speak', {
      agent_id: 'a1', agent_name: 'Alice', target: 'all', message: 'Hello',
    }))

    const audioMsg: WSMessage<AgentSpeechAudioData> = {
      type: 'agent_speech_audio',
      round: 1,
      timestamp: '2026-03-07T00:00:01Z',
      data: {
        agent_id: 'a1',
        round: 1,
        index: 0,
        status: 'error',
      },
    }
    store.onSpeechAudio(audioMsg)

    expect(store.conversations[0].audioStatus).toBe('error')
    expect(store.conversations[0].audioUrl).toBeNull()
  })

  it('onSpeechAudio does not crash when no matching entry exists', () => {
    const store = useSocialStore()
    const audioMsg: WSMessage<AgentSpeechAudioData> = {
      type: 'agent_speech_audio',
      round: 1,
      timestamp: '2026-03-07T00:00:01Z',
      data: {
        agent_id: 'a1',
        round: 1,
        index: 0,
        status: 'ready',
        audio_url: 'https://example.com/audio.mp3',
      },
    }
    // Should not throw
    expect(() => store.onSpeechAudio(audioMsg)).not.toThrow()
  })

  it('onSpeechAudio matches correct entry by agent+round+index', () => {
    const store = useSocialStore()
    // Two messages from same agent in same round
    store.onSpeak(makeMsg('agent_speak', {
      agent_id: 'a1', agent_name: 'Alice', target: 'all', message: 'First',
    }))
    store.onSpeak(makeMsg('agent_speak', {
      agent_id: 'a1', agent_name: 'Alice', target: 'all', message: 'Second',
    }))

    // Update only the second one
    const audioMsg: WSMessage<AgentSpeechAudioData> = {
      type: 'agent_speech_audio',
      round: 1,
      timestamp: '2026-03-07T00:00:01Z',
      data: {
        agent_id: 'a1',
        round: 1,
        index: 1,
        status: 'ready',
        audio_url: 'https://example.com/audio2.mp3',
      },
    }
    store.onSpeechAudio(audioMsg)

    expect(store.conversations[0].audioStatus).toBe('idle')
    expect(store.conversations[1].audioStatus).toBe('ready')
    expect(store.conversations[1].audioUrl).toBe('https://example.com/audio2.mp3')
  })
})
