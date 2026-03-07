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
    const data = msg.data as Record<string, unknown>
    currentPlan.value = {
      round: data.round as number,
      roundTheme: data.round_theme as string,
      reasoning: data.reasoning as string,
      crisisEvent: {
        type: data.crisis_event ? (data.crisis_event as Record<string, unknown>).type as GMPlan['crisisEvent']['type'] : 'resource',
        description: data.crisis_event ? (data.crisis_event as Record<string, unknown>).description as string : '',
        severity: data.crisis_event ? (data.crisis_event as Record<string, unknown>).severity as GMPlan['crisisEvent']['severity'] : 'low',
        affects: data.crisis_event ? (data.crisis_event as Record<string, unknown>).affects as string[] : [],
      },
      resourceModifiers: data.resource_modifiers as Partial<GMPlan['resourceModifiers']> || {},
      environmental: data.environmental as string | undefined,
      narration: data.narration as string,
      metaHint: data.meta_hint as string | null ?? null,
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
