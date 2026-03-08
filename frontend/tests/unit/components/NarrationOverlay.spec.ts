import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import NarrationOverlay from '@/components/hud/NarrationOverlay.vue'

// Mock locale
jest.mock('@/locales', () => ({
  useLocale: () => ({
    gm: {
      clickToContinue: 'Click to continue',
      audioLoading: 'Loading narration audio…',
      audioPlay: 'Play narration',
      audioReplay: 'Replay narration',
      audioError: 'Audio unavailable',
    },
  }),
}))

// Mock HTMLAudioElement
const mockPlay = jest.fn().mockResolvedValue(undefined)
const mockPause = jest.fn()
const mockLoad = jest.fn()
const mockAddEventListener = jest.fn()
const mockRemoveEventListener = jest.fn()

beforeEach(() => {
  jest.useFakeTimers()
  global.Audio = jest.fn().mockImplementation(() => ({
    play: mockPlay,
    pause: mockPause,
    load: mockLoad,
    addEventListener: mockAddEventListener,
    removeEventListener: mockRemoveEventListener,
    removeAttribute: jest.fn(),
  })) as unknown as typeof Audio
  mockPlay.mockClear()
  mockPause.mockClear()
  mockLoad.mockClear()
  mockAddEventListener.mockClear()
  mockRemoveEventListener.mockClear()
})

afterEach(() => {
  jest.useRealTimers()
})

function createWrapper(props = {}) {
  setActivePinia(createPinia())
  return mount(NarrationOverlay, {
    props: {
      text: 'Day one begins.',
      visible: true,
      audioStatus: 'idle' as const,
      audioUrl: null,
      autoplayBlocked: false,
      ...props,
    },
  })
}

describe('NarrationOverlay', () => {
  it('starts typewriter on mount when visible (reconnect path)', async () => {
    const wrapper = createWrapper()
    jest.advanceTimersByTime(50)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('D')
  })

  it('shows loading text when audio is pending', async () => {
    const wrapper = createWrapper({ audioStatus: 'pending' })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Loading narration audio')
  })

  it('shows play button when autoplay is blocked', async () => {
    const wrapper = createWrapper({
      audioStatus: 'ready',
      audioUrl: '/audio',
      autoplayBlocked: true,
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Play narration')
  })

  it('shows error text when audio fails', async () => {
    const wrapper = createWrapper({ audioStatus: 'error' })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Audio unavailable')
  })

  it('attempts autoplay when audio becomes ready', async () => {
    const wrapper = createWrapper({
      audioStatus: 'idle',
      audioUrl: '/api/experiments/e1/rounds/1/narration/audio',
    })
    await wrapper.setProps({ audioStatus: 'ready' })
    await wrapper.vm.$nextTick()
    expect(global.Audio).toHaveBeenCalledWith('/api/experiments/e1/rounds/1/narration/audio')
    expect(mockPlay).toHaveBeenCalled()
  })

  it('emits dismiss on click when typewriter is complete', async () => {
    const wrapper = createWrapper({ text: 'Hi' })
    jest.advanceTimersByTime(200)
    await wrapper.vm.$nextTick()

    await wrapper.find('.fixed').trigger('click')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })

  it('does not render when not visible', () => {
    const wrapper = createWrapper({ visible: false })
    expect(wrapper.find('.fixed').exists()).toBe(false)
  })

  it('shows play button when autoplay is blocked by browser', async () => {
    mockPlay.mockRejectedValueOnce(new DOMException('NotAllowedError'))
    const wrapper = createWrapper({
      audioStatus: 'idle',
      audioUrl: '/audio',
    })
    await wrapper.setProps({ audioStatus: 'ready' })
    await wrapper.vm.$nextTick()
    await jest.runAllTimersAsync()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:autoplayBlocked')).toBeTruthy()
    expect(wrapper.emitted('update:autoplayBlocked')![0]).toEqual([true])
  })

  it('autoplays audio on mount when already ready (reconnect)', async () => {
    const wrapper = createWrapper({
      audioStatus: 'ready',
      audioUrl: '/api/experiments/e1/rounds/1/narration/audio',
    })
    await wrapper.vm.$nextTick()
    expect(global.Audio).toHaveBeenCalledWith('/api/experiments/e1/rounds/1/narration/audio')
    expect(mockPlay).toHaveBeenCalled()
  })

  it('starts typewriter and autoplays on mount with hydrated props (full reconnect)', async () => {
    const wrapper = createWrapper({
      text: 'Reconnected narration.',
      audioStatus: 'ready',
      audioUrl: '/audio/reconnect',
    })
    // Typewriter should start immediately
    jest.advanceTimersByTime(50)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('R')
    // Audio should autoplay
    expect(global.Audio).toHaveBeenCalledWith('/audio/reconnect')
    expect(mockPlay).toHaveBeenCalled()
  })
})
