import { HD_ACTION_TO_ANIMATION, HD_ANIMATION_REGISTRY, getHDAnimationForAction } from '@/config/sprites/hd/animations'

describe('Meeting-related sprite animation mappings', () => {
  it('HD_ACTION_TO_ANIMATION maps meeting_speech to talk', () => {
    expect(HD_ACTION_TO_ANIMATION['meeting_speech']).toBe('talk')
  })

  it('HD_ACTION_TO_ANIMATION maps meeting_vote to vote', () => {
    expect(HD_ACTION_TO_ANIMATION['meeting_vote']).toBe('vote')
  })

  it('HD_ANIMATION_REGISTRY has a think animation with the think pose in its poses array', () => {
    const thinkAnim = HD_ANIMATION_REGISTRY['think']
    expect(thinkAnim).toBeDefined()
    expect(thinkAnim.poses).toContain('think')
  })

  it('HD_ANIMATION_REGISTRY think animation is not looping', () => {
    const thinkAnim = HD_ANIMATION_REGISTRY['think']
    expect(thinkAnim.loop).toBe(false)
  })

  it('getHDAnimationForAction(meeting_speech) returns the talk animation', () => {
    const anim = getHDAnimationForAction('meeting_speech')
    expect(anim.name).toBe('talk')
  })

  it('getHDAnimationForAction(meeting_vote) returns the vote animation', () => {
    const anim = getHDAnimationForAction('meeting_vote')
    expect(anim.name).toBe('vote')
  })
})
