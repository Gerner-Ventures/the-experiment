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

beforeEach(() => {
  jest.useFakeTimers()
  global.Audio = jest.fn().mockImplementation(() => ({
    play: mockPlay,
    pause: mockPause,
    load: mockLoad,
    addEventListener: mockAddEventListener,
    removeAttribute: jest.fn(),
  })) as unknown as typeof Audio
  mockPlay.mockClear()
  mockPause.mockClear()
  mockLoad.mockClear()
  mockAddEventListener.mockClear()
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
  it('shows text overlay when visible', async () => {
    const wrapper = createWrapper()
    // The typewriter watch fires on visible change; since we mount with visible=true
    // we need to trigger the watch by toggling visibility
    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true })
    // Advance timers to let typewriter type at least the first char
    jest.advanceTimersByTime(50)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('D')
  })

  it('shows loading text when audio is pending', async () => {
    const wrapper = createWrapper({ audioStatus: 'pending' })
    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true })
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
    // Trigger audioStatus watch by changing from idle to ready
    await wrapper.setProps({ audioStatus: 'ready' })
    await wrapper.vm.$nextTick()
    expect(global.Audio).toHaveBeenCalledWith('/api/experiments/e1/rounds/1/narration/audio')
    expect(mockPlay).toHaveBeenCalled()
  })

  it('emits dismiss on click when typewriter is complete', async () => {
    const wrapper = createWrapper({ text: 'Hi' })
    // Trigger typewriter via watch
    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true })
    // Advance enough for 2-char typewriter to complete (2 * 30ms + buffer)
    jest.advanceTimersByTime(200)
    await wrapper.vm.$nextTick()

    await wrapper.find('.fixed').trigger('click')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })

  it('does not render when not visible', () => {
    const wrapper = createWrapper({ visible: false })
    expect(wrapper.find('.fixed').exists()).toBe(false)
  })
})
