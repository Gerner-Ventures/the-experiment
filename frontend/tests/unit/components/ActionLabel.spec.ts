import { mount } from '@vue/test-utils'
import ActionLabel from '@/components/hud/ActionLabel.vue'

describe('ActionLabel', () => {
  it('renders action type from locale (title case)', () => {
    const wrapper = mount(ActionLabel, {
      props: { actionType: 'stab', position: { x: 100, y: 200 } },
    })
    expect(wrapper.text()).toBe('Stab')
  })

  it('falls back to uppercase for unknown action types', () => {
    const wrapper = mount(ActionLabel, {
      props: { actionType: 'xyzzy', position: { x: 100, y: 200 } },
    })
    expect(wrapper.text()).toBe('XYZZY')
  })

  it('applies aggressive style for aggressive actions', () => {
    const wrapper = mount(ActionLabel, {
      props: { actionType: 'stab', position: { x: 100, y: 200 } },
    })
    expect(wrapper.find('.action-label--aggressive').exists()).toBe(true)
    expect(wrapper.find('.action-label--normal').exists()).toBe(false)
  })

  it('applies normal style for non-aggressive actions', () => {
    const wrapper = mount(ActionLabel, {
      props: { actionType: 'gather', position: { x: 100, y: 200 } },
    })
    expect(wrapper.find('.action-label--normal').exists()).toBe(true)
    expect(wrapper.find('.action-label--aggressive').exists()).toBe(false)
  })

  it.each(['attack', 'stab', 'shoot', 'threaten', 'poison'])(
    'treats %s as aggressive',
    (action) => {
      const wrapper = mount(ActionLabel, {
        props: { actionType: action, position: { x: 0, y: 0 } },
      })
      expect(wrapper.find('.action-label--aggressive').exists()).toBe(true)
    },
  )

  it('positions based on agent screen position', () => {
    const wrapper = mount(ActionLabel, {
      props: { actionType: 'dance', position: { x: 300, y: 400 } },
    })
    const style = wrapper.attributes('style')
    expect(style).toContain('left: 300px')
    expect(style).toContain('top: 340px') // 400 - 60
  })
})
