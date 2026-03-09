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
  const narrationId = ref<string | null>(null)
  const narrationAudioStatus = ref<NarrationAudioStatus | 'idle'>('idle')
  const narrationAudioUrl = ref<string | null>(null)
  const narrationAudioError = ref<string | null>(null)
  const audioAutoplayBlocked = ref(false)
  const isNarrationPlaying = ref(false)
  const queuedAudioStatus = ref<GMAudioStatusData | null>(null)

  function resetAudioState(options?: { preserveQueuedStatus?: boolean }) {
    narrationAudioStatus.value = 'idle'
    narrationAudioUrl.value = null
    narrationAudioError.value = null
    audioAutoplayBlocked.value = false
    isNarrationPlaying.value = false
    if (!options?.preserveQueuedStatus) {
      queuedAudioStatus.value = null
    }
  }

  function syncNarrationIdentity(
    text: string,
    round: number,
    nextNarrationId: string | null,
    options?: { preserveQueuedStatus?: boolean },
  ) {
    const identityChanged = narrationText.value !== text
      || narrationRound.value !== round
      || narrationId.value !== nextNarrationId

    if (identityChanged) {
      resetAudioState(options)
    }

    narrationText.value = text
    narrationRound.value = round
    narrationId.value = nextNarrationId
    showNarration.value = !!text

    return identityChanged
  }

  function applyAudioStatus(data: GMAudioStatusData) {
    if (narrationId.value === null || data.narration_id !== narrationId.value) {
      return false
    }

    narrationAudioStatus.value = data.status
    narrationAudioUrl.value = data.status === 'ready' ? data.audio_url ?? null : null
    narrationAudioError.value = data.error ?? null
    queuedAudioStatus.value = null
    return true
  }

  function reconcileQueuedAudioStatus() {
    const queued = queuedAudioStatus.value
    if (!queued || narrationId.value === null) return
    if (queued.narration_id !== narrationId.value) {
      queuedAudioStatus.value = null
      return
    }

    if (narrationAudioStatus.value === 'pending' || queued.status !== 'pending') {
      applyAudioStatus(queued)
      return
    }

    queuedAudioStatus.value = null
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

    setNarrationFallback(currentPlan.value.narration, currentPlan.value.round)
  }

  function onNarration(msg: WSMessage) {
    // Legacy handler — kept for backward compatibility
    const data = msg.data as { text: string }
    setNarrationFallback(data.text, msg.round)
  }

  function onAudioStatus(msg: WSMessage<GMAudioStatusData>) {
    const data = msg.data
    if (narrationRound.value === null || msg.round !== narrationRound.value) return

    if (narrationId.value === null) {
      queuedAudioStatus.value = data
      if (data.status === 'pending') {
        narrationAudioStatus.value = 'pending'
        narrationAudioUrl.value = null
        narrationAudioError.value = null
      }
      return
    }

    applyAudioStatus(data)
  }

  function setNarrationFallback(text: string, round: number) {
    syncNarrationIdentity(text, round, null)
  }

  function hydrateNarration(
    text: string,
    round: number,
    nextNarrationId: string | null,
    status: NarrationAudioStatus | 'idle',
    audioUrl: string | null,
    audioError: string | null = null,
  ) {
    syncNarrationIdentity(text, round, nextNarrationId, { preserveQueuedStatus: true })
    narrationAudioStatus.value = status
    narrationAudioUrl.value = audioUrl
    narrationAudioError.value = audioError
    reconcileQueuedAudioStatus()
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
    narrationId.value = null
    resetAudioState()
  }

  return {
    currentPlan, showPlanPanel, planApproved,
    narrationText, showNarration, narrationRound, narrationId,
    narrationAudioStatus, narrationAudioUrl, narrationAudioError,
    audioAutoplayBlocked, isNarrationPlaying,
    onPlan, onNarration, onAudioStatus, setNarrationFallback, hydrateNarration,
    approvePlan, dismissNarration,
    setNarrationPlaying, setAutoplayBlocked,
    $reset,
  }
})
