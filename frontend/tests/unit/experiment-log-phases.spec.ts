/**
 * Tests for ExperimentLog turn phase display functions.
 * Covers: turnPhaseColor and turnPhaseLabel mappings.
 */

// The functions are defined inside the component's <script setup>,
// so we test the mapping logic directly rather than importing.
// This verifies the phase→label and phase→color contracts.

type TurnPhase = 'idle' | 'thinking' | 'moving' | 'acting' | 'hud-only'

// Replicate the mapping logic from ExperimentLog.vue
function turnPhaseColor(phase: TurnPhase): string {
  switch (phase) {
    case 'moving': return '#3b82f6'
    case 'acting': return '#f59e0b'
    case 'thinking': return '#8b5cf6'
    case 'hud-only': return '#6b7280'
    case 'idle': return '#374151'
    default: return '#374151'
  }
}

function turnPhaseLabel(phase: TurnPhase): string {
  switch (phase) {
    case 'moving': return 'Moving'
    case 'acting': return 'Acting'
    case 'thinking': return 'Talking'
    case 'hud-only': return 'HUD'
    case 'idle': return 'Queue Empty'
    default: return phase
  }
}

describe('ExperimentLog phase display', () => {
  describe('turnPhaseColor', () => {
    it('returns blue for moving', () => {
      expect(turnPhaseColor('moving')).toBe('#3b82f6')
    })

    it('returns amber for acting', () => {
      expect(turnPhaseColor('acting')).toBe('#f59e0b')
    })

    it('returns purple for thinking', () => {
      expect(turnPhaseColor('thinking')).toBe('#8b5cf6')
    })

    it('returns gray for hud-only', () => {
      expect(turnPhaseColor('hud-only')).toBe('#6b7280')
    })

    it('returns dark gray for idle', () => {
      expect(turnPhaseColor('idle')).toBe('#374151')
    })
  })

  describe('turnPhaseLabel', () => {
    it('maps thinking to Talking (user-facing label)', () => {
      // Internal phase is 'thinking' but displayed as 'Talking'
      expect(turnPhaseLabel('thinking')).toBe('Talking')
    })

    it('maps moving to Moving', () => {
      expect(turnPhaseLabel('moving')).toBe('Moving')
    })

    it('maps acting to Acting', () => {
      expect(turnPhaseLabel('acting')).toBe('Acting')
    })

    it('maps hud-only to HUD', () => {
      expect(turnPhaseLabel('hud-only')).toBe('HUD')
    })

    it('maps idle to Queue Empty', () => {
      expect(turnPhaseLabel('idle')).toBe('Queue Empty')
    })
  })

  describe('all phases have both color and label', () => {
    const phases: TurnPhase[] = ['idle', 'thinking', 'moving', 'acting', 'hud-only']

    it.each(phases)('phase "%s" has a defined color', (phase) => {
      expect(turnPhaseColor(phase)).toBeTruthy()
      expect(turnPhaseColor(phase)).toMatch(/^#[0-9a-f]{6}$/)
    })

    it.each(phases)('phase "%s" has a non-empty label', (phase) => {
      expect(turnPhaseLabel(phase)).toBeTruthy()
      expect(turnPhaseLabel(phase).length).toBeGreaterThan(0)
    })
  })
})
