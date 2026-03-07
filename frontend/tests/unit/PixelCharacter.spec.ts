import { mount } from '@vue/test-utils'
import PixelCharacter from '@/components/ui/PixelCharacter.vue'
import { getSpriteById } from '@/config/character-sprites'

// Mock canvas context since jsdom doesn't support canvas
const mockFillRect = jest.fn()
const mockClearRect = jest.fn()
const mockCtx = {
  fillStyle: '',
  imageSmoothingEnabled: true,
  fillRect: mockFillRect,
  clearRect: mockClearRect,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue(mockCtx) as any

describe('PixelCharacter', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockFillRect.mockClear()
    mockClearRect.mockClear()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('renders a canvas element', () => {
    const sprite = getSpriteById('intern')!
    const wrapper = mount(PixelCharacter, {
      props: { sprite, scale: 2, animate: false },
    })

    expect(wrapper.find('canvas').exists()).toBe(true)
  })

  it('draws pixels on mount', async () => {
    const sprite = getSpriteById('intern')!
    mount(PixelCharacter, {
      props: { sprite, scale: 2, animate: false },
    })

    // Should have called fillRect for non-transparent pixels
    expect(mockFillRect).toHaveBeenCalled()
    expect(mockClearRect).toHaveBeenCalled()
  })

  it('disables image smoothing for pixel art', () => {
    const sprite = getSpriteById('intern')!
    mount(PixelCharacter, {
      props: { sprite, scale: 3, animate: false },
    })

    expect(mockCtx.imageSmoothingEnabled).toBe(false)
  })

  it('draws at the correct scale', () => {
    const sprite = getSpriteById('intern')!
    const scale = 4
    mount(PixelCharacter, {
      props: { sprite, scale, animate: false },
    })

    // fillRect calls should use the scale factor
    const calls = mockFillRect.mock.calls
    expect(calls.length).toBeGreaterThan(0)

    // Each call should use scale as width/height
    for (const [, , w, h] of calls) {
      expect(w).toBe(scale)
      expect(h).toBe(scale)
    }
  })

  it('starts animation loop when animate=true', () => {
    const sprite = getSpriteById('intern')!
    mount(PixelCharacter, {
      props: { sprite, scale: 2, animate: true },
    })

    const initialCallCount = mockFillRect.mock.calls.length

    // Advance past initial delay + animation frames
    jest.advanceTimersByTime(5000)

    // Should have drawn additional frames
    expect(mockFillRect.mock.calls.length).toBeGreaterThan(initialCallCount)
  })

  it('does not animate when animate=false', () => {
    const sprite = getSpriteById('intern')!
    mount(PixelCharacter, {
      props: { sprite, scale: 2, animate: false },
    })

    const initialCallCount = mockFillRect.mock.calls.length

    // Advance time — should NOT trigger more draws
    jest.advanceTimersByTime(5000)

    expect(mockFillRect.mock.calls.length).toBe(initialCallCount)
  })

  it('cleans up timers on unmount', () => {
    const sprite = getSpriteById('intern')!
    const wrapper = mount(PixelCharacter, {
      props: { sprite, scale: 2, animate: true },
    })

    wrapper.unmount()

    const callCountAfterUnmount = mockFillRect.mock.calls.length

    // Advance time — no more draws should happen
    jest.advanceTimersByTime(10000)

    expect(mockFillRect.mock.calls.length).toBe(callCountAfterUnmount)
  })

  it('re-renders when sprite prop changes', async () => {
    const sprite1 = getSpriteById('intern')!
    const sprite2 = getSpriteById('medic')!
    const wrapper = mount(PixelCharacter, {
      props: { sprite: sprite1, scale: 2, animate: false },
    })

    const callsAfterFirst = mockFillRect.mock.calls.length

    await wrapper.setProps({ sprite: sprite2 })

    expect(mockFillRect.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })
})
