import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { GMPlan } from '@/types/gm'
import type { WSMessage } from '@/types/websocket'

export const useGMStore = defineStore('gm', () => {
  const currentPlan = ref<GMPlan | null>(null)
  const narrationText = ref('')
  const showPlanPanel = ref(false)
  const showNarration = ref(false)
  const planApproved = ref(false)

  function onPlan(msg: WSMessage) {
    const raw = msg.data as Record<string, unknown>
    // Backend sends GMPlanRecord: { status, plan: { round, round_theme, ... } }
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
  }

  function onNarration(msg: WSMessage) {
    const data = msg.data as { text: string }
    narrationText.value = data.text
    showNarration.value = true
  }

  function approvePlan() {
    planApproved.value = true
    showPlanPanel.value = false
  }

  function dismissNarration() {
    showNarration.value = false
  }

  function $reset() {
    currentPlan.value = null
    narrationText.value = ''
    showPlanPanel.value = false
    showNarration.value = false
    planApproved.value = false
  }

  return {
    currentPlan, narrationText, showPlanPanel, showNarration, planApproved,
    onPlan, onNarration, approvePlan, dismissNarration,
    $reset,
  }
})
