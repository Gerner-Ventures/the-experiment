import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ActivePanel = 'none' | 'dossier' | 'log' | 'gm-plan' | 'meeting'

export const useUIStore = defineStore('ui', () => {
  const selectedAgentId = ref<string | null>(null)
  const activePanel = ref<ActivePanel>('none')
  const playbackSpeed = ref(1)
  const isPlaying = ref(false)
  const showNarration = ref(false)
  const isStepping = ref(false)
  const steppingStatus = ref('')

  const hasSelectedAgent = computed(() => selectedAgentId.value !== null)

  function selectAgent(id: string) {
    selectedAgentId.value = id
    activePanel.value = 'dossier'
  }

  function deselectAgent() {
    selectedAgentId.value = null
    if (activePanel.value === 'dossier') {
      activePanel.value = 'none'
    }
  }

  function setPanel(panel: ActivePanel) {
    activePanel.value = panel
  }

  function togglePanel(panel: ActivePanel) {
    activePanel.value = activePanel.value === panel ? 'none' : panel
  }

  function setPlaybackSpeed(speed: number) {
    playbackSpeed.value = speed
  }

  function togglePlaying() {
    isPlaying.value = !isPlaying.value
  }

  function setSteppingStatus(status: string) {
    steppingStatus.value = status
  }

  function clearStepping() {
    isStepping.value = false
    steppingStatus.value = ''
  }

  function startStepping(status: string) {
    isStepping.value = true
    steppingStatus.value = status
  }

  function $reset() {
    selectedAgentId.value = null
    activePanel.value = 'none'
    playbackSpeed.value = 1
    isPlaying.value = false
    showNarration.value = false
    isStepping.value = false
    steppingStatus.value = ''
  }

  return {
    selectedAgentId, activePanel, playbackSpeed, isPlaying, showNarration,
    isStepping, steppingStatus,
    hasSelectedAgent,
    selectAgent, deselectAgent, setPanel, togglePanel,
    setPlaybackSpeed, togglePlaying,
    setSteppingStatus, clearStepping, startStepping,
    $reset,
  }
})
