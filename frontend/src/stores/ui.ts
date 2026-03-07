import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ActivePanel = 'none' | 'dossier' | 'log' | 'gm-plan' | 'meeting'

export const useUIStore = defineStore('ui', () => {
  const selectedAgentId = ref<string | null>(null)
  const activePanel = ref<ActivePanel>('none')
  const playbackSpeed = ref(1)
  const isPlaying = ref(false)
  const isStepping = ref(false)
  const steppingStatus = ref('')
  const showNarration = ref(false)

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

  function $reset() {
    selectedAgentId.value = null
    activePanel.value = 'none'
    playbackSpeed.value = 1
    isPlaying.value = false
    isStepping.value = false
    steppingStatus.value = ''
    showNarration.value = false
  }

  return {
    selectedAgentId, activePanel, playbackSpeed, isPlaying, isStepping, steppingStatus, showNarration,
    hasSelectedAgent,
    selectAgent, deselectAgent, setPanel, togglePanel,
    setPlaybackSpeed, togglePlaying,
    $reset,
  }
})
