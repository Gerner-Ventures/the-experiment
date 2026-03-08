import { setActivePinia, createPinia } from 'pinia'
import { useUIStore, PANELS, type ActivePanel } from '@/stores/ui'

describe('UI store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('PANELS constants', () => {
    it('has values matching ActivePanel type', () => {
      const validPanels: ActivePanel[] = ['none', 'dossier', 'log', 'gm-plan', 'meeting', 'relationship-web']

      expect(PANELS.NONE).toBe('none')
      expect(PANELS.DOSSIER).toBe('dossier')
      expect(PANELS.LOG).toBe('log')
      expect(PANELS.GM_PLAN).toBe('gm-plan')
      expect(PANELS.MEETING).toBe('meeting')
      expect(PANELS.RELATIONSHIP_WEB).toBe('relationship-web')

      // Every PANELS value should be a valid ActivePanel
      const panelValues = Object.values(PANELS)
      for (const val of panelValues) {
        expect(validPanels).toContain(val)
      }
    })

    it('covers all ActivePanel values', () => {
      const panelValues = new Set(Object.values(PANELS))
      expect(panelValues.has('none')).toBe(true)
      expect(panelValues.has('dossier')).toBe(true)
      expect(panelValues.has('log')).toBe(true)
      expect(panelValues.has('gm-plan')).toBe(true)
      expect(panelValues.has('meeting')).toBe(true)
      expect(panelValues.has('relationship-web')).toBe(true)
    })
  })

  describe('setPlaying', () => {
    it('sets isPlaying to true', () => {
      const store = useUIStore()
      expect(store.isPlaying).toBe(false)

      store.setPlaying(true)
      expect(store.isPlaying).toBe(true)
    })

    it('sets isPlaying to false', () => {
      const store = useUIStore()
      store.setPlaying(true)
      store.setPlaying(false)
      expect(store.isPlaying).toBe(false)
    })
  })

  describe('startStepping', () => {
    it('sets isStepping to true and status message', () => {
      const store = useUIStore()

      store.startStepping('Processing round...')

      expect(store.isStepping).toBe(true)
      expect(store.steppingStatus).toBe('Processing round...')
    })
  })

  describe('clearStepping', () => {
    it('resets isStepping and status', () => {
      const store = useUIStore()
      store.startStepping('Some status')

      store.clearStepping()

      expect(store.isStepping).toBe(false)
      expect(store.steppingStatus).toBe('')
    })
  })

  describe('startStepping / clearStepping lifecycle', () => {
    it('transitions through the full stepping lifecycle', () => {
      const store = useUIStore()

      // Initial state
      expect(store.isStepping).toBe(false)
      expect(store.steppingStatus).toBe('')

      // Start stepping
      store.startStepping('Round 1 starting...')
      expect(store.isStepping).toBe(true)
      expect(store.steppingStatus).toBe('Round 1 starting...')

      // Update status mid-step
      store.setSteppingStatus('Agent Alice: talk')
      expect(store.isStepping).toBe(true)
      expect(store.steppingStatus).toBe('Agent Alice: talk')

      // Clear stepping
      store.clearStepping()
      expect(store.isStepping).toBe(false)
      expect(store.steppingStatus).toBe('')
    })
  })

  describe('setSteppingStatus', () => {
    it('updates only the status text without changing isStepping', () => {
      const store = useUIStore()

      // Without starting stepping first
      store.setSteppingStatus('hello')
      expect(store.steppingStatus).toBe('hello')
      expect(store.isStepping).toBe(false) // unchanged

      // With stepping started
      store.startStepping('initial')
      store.setSteppingStatus('updated')
      expect(store.steppingStatus).toBe('updated')
      expect(store.isStepping).toBe(true) // unchanged
    })
  })

  describe('$reset', () => {
    it('resets all stepping state', () => {
      const store = useUIStore()
      store.startStepping('active')
      store.setPlaying(true)
      store.selectAgent('agent-1')

      store.$reset()

      expect(store.isStepping).toBe(false)
      expect(store.steppingStatus).toBe('')
      expect(store.isPlaying).toBe(false)
      expect(store.selectedAgentId).toBeNull()
      expect(store.activePanel).toBe('none')
    })
  })
})
