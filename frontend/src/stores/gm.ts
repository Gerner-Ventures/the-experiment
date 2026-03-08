import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GMPlan } from '@/types/gm'
import type { WSMessage, GMAudioStatusData, NarrationAudioStatus } from '@/types/websocket'

export const useGMStore = defineStore('gm', () => {
  // --- GM plan state ---
  const currentPlan = ref<GMPlan | null>(null)
  const showPlanPanel = ref(false)
  const planApproved = ref(false)

  // --- Narration state ---
  const narrationText = ref('')
  const showNarration = ref(false)
  const narrationRound = ref<number | null>(null)
  const narrationAudioStatus = ref<NarrationAudioStatus | 'idle'>('idle')
  const narrationAudioUrl = ref<string | null>(null)
  const audioAutoplayBlocked = ref(false)
  const isNarrationPlaying = ref(false)

  function resetAudioState() {
    narrationAudioStatus.value = 'idle'
    narrationAudioUrl.value = null
    audioAutoplayBlocked.value = false
    isNarrationPlaying.value = false
  }

  function onPlan(msg: WSMessage) {
    const raw = msg.data as Record<string, unknown>
    const plan = (raw.plan as Record<string, unknown>) ?? raw
    const crisis = (plan.crisis_event as Record<string, unknown>) ?? {}
    const mods = (plan.resource_modifiers as Partial<GMPlan['resourceModifiers']>) ?? {}
    currentPlan.value = {
      round: (plan.round as number) ?? msg.round,
      roundTheme: (plan.round_theme as string) ?? '',
      reasoning: (plan.reasoning as string) ?? '',
      crisisEvent: {
        type: (crisis.type as GMPlan['crisisEvent']['type']) ?? 'resource',
        description: (crisis.description as string) ?? '',
        severity: (crisis.severity as GMPlan['crisisEvent']['severity']) ?? 'low',
        affects: (crisis.affects as string[]) ?? [],
      },
      resourceModifiers: mods,
      environmental: plan.environmental as string | undefined,
      narration: (plan.narration as string) ?? '',
      metaHint: (plan.meta_hint as string | null) ?? null,
    }
    planApproved.value = false
    showPlanPanel.value = true

    // Extract narration text from plan and show overlay
    narrationText.value = currentPlan.value.narration
    narrationRound.value = currentPlan.value.round
    showNarration.value = !!narrationText.value
    resetAudioState()
  }

  function onNarration(msg: WSMessage) {
    // Legacy handler — kept for backward compatibility
    const data = msg.data as { text: string }
    narrationText.value = data.text
    narrationRound.value = msg.round
    showNarration.value = true
    resetAudioState()
  }

  function onAudioStatus(msg: WSMessage<GMAudioStatusData>) {
    const data = msg.data
    // Ignore stale messages from previous rounds
    if (narrationRound.value !== null && msg.round !== narrationRound.value) return
    narrationAudioStatus.value = data.status
    if (data.status === 'ready' && data.audio_url) {
      narrationAudioUrl.value = data.audio_url
    } else if (data.status === 'error') {
      narrationAudioUrl.value = null
    }
  }

  function hydrateNarration(text: string, round: number, status: NarrationAudioStatus | 'idle', audioUrl: string | null) {
    narrationText.value = text
    narrationRound.value = round
    narrationAudioStatus.value = status
    narrationAudioUrl.value = audioUrl
    audioAutoplayBlocked.value = false
    isNarrationPlaying.value = false
    showNarration.value = !!text
  }

  function approvePlan() {
    planApproved.value = true
    showPlanPanel.value = false
  }

  function setNarrationPlaying(value: boolean) {
    isNarrationPlaying.value = value
  }

  function setAutoplayBlocked(value: boolean) {
    audioAutoplayBlocked.value = value
  }

  function dismissNarration() {
    showNarration.value = false
    isNarrationPlaying.value = false
  }

  function $reset() {
    currentPlan.value = null
    narrationText.value = ''
    showPlanPanel.value = false
    showNarration.value = false
    planApproved.value = false
    narrationRound.value = null
    narrationAudioStatus.value = 'idle'
    narrationAudioUrl.value = null
    audioAutoplayBlocked.value = false
    isNarrationPlaying.value = false
  }

  return {
    currentPlan, showPlanPanel, planApproved,
    narrationText, showNarration, narrationRound,
    narrationAudioStatus, narrationAudioUrl,
    audioAutoplayBlocked, isNarrationPlaying,
    onPlan, onNarration, onAudioStatus, hydrateNarration,
    approvePlan, dismissNarration,
    setNarrationPlaying, setAutoplayBlocked,
    $reset,
  }
})
