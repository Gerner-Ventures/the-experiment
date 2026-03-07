import { mount } from '@vue/test-utils'
import GlitchText from '@/components/ui/GlitchText.vue'

describe('GlitchText', () => {
  it('renders without crashing', () => {
    const wrapper = mount(GlitchText, {
      props: { text: 'HELLO WORLD' },
    })
    expect(wrapper.exists()).toBe(true)
  })

  it('emits complete event after finishing', async () => {
    jest.useFakeTimers()
    const wrapper = mount(GlitchText, {
      props: { text: 'HI', speed: 1 },
    })

    // GlitchText uses nested setTimeouts — need to flush enough cycles
    // Initial delay (200ms) + per-char: glitch timeout + real char timeout
    for (let i = 0; i < 50; i++) {
      jest.advanceTimersByTime(250)
      await Promise.resolve() // flush microtasks
    }

    expect(wrapper.emitted('complete')).toBeTruthy()
    jest.useRealTimers()
  })

  it('uses the specified tag', () => {
    const wrapper = mount(GlitchText, {
      props: { text: 'TEST', tag: 'h1' },
    })
    expect(wrapper.element.tagName).toBe('H1')
  })
})
