import { ref, type Ref } from 'vue'
import type { WSMessage, WSMessageType } from '@/types/websocket'
import { useExperimentStore } from '@/stores/experiment'
import { useAgentStore } from '@/stores/agent'
import { useWorldStore } from '@/stores/world'
import { useGMStore } from '@/stores/gm'
import { useSocialStore } from '@/stores/social'
import { useUIStore } from '@/stores/ui'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export interface UseWebSocket {
  state: Ref<ConnectionState>
  connect(url: string): void
  disconnect(): void
  send(data: Record<string, unknown>): void
}

export function useWebSocket(): UseWebSocket {
  const state = ref<ConnectionState>('disconnected')
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let currentUrl = ''

  function connect(url: string) {
    currentUrl = url
    reconnectAttempts = 0
    doConnect()
  }

  function doConnect() {
    if (ws) {
      ws.close()
    }

    state.value = 'connecting'
    ws = new WebSocket(currentUrl)

    ws.onopen = () => {
      state.value = 'connected'
      reconnectAttempts = 0
    }

    ws.onmessage = (event) => {
      let msg: WSMessage
      try {
        msg = JSON.parse(event.data) as WSMessage
      } catch (err) {
        console.warn('[WS] Failed to parse message:', err, event.data)
        return
      }
      console.debug('[WS]', msg.type, msg.phase ?? '', msg.data)
      try {
        routeMessage(msg)
      } catch (err) {
        console.error('[WS] Error handling message type:', msg.type, err)
      }
    }

    ws.onclose = () => {
      state.value = 'disconnected'
      scheduleReconnect()
    }

    ws.onerror = () => {
      // onclose will fire after onerror
    }
  }

  function scheduleReconnect() {
    if (!currentUrl) return
    reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000)
    reconnectTimer = setTimeout(doConnect, delay)
  }

  function disconnect() {
    currentUrl = ''
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    state.value = 'disconnected'
  }

  function send(data: Record<string, unknown>) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }

  return { state, connect, disconnect, send }
}

function routeMessage(msg: WSMessage) {
  const experimentStore = useExperimentStore()
  const agentStore = useAgentStore()
  const worldStore = useWorldStore()
  const gmStore = useGMStore()
  const socialStore = useSocialStore()

  // Always log the event
  experimentStore.addEvent(msg)

  const router: Partial<Record<WSMessageType, (m: WSMessage) => void>> = {
    connected: () => { /* connection confirmed, no action needed */ },
    round_start: (m) => experimentStore.onRoundStart(m),
    round_end: (m) => experimentStore.onRoundEnd(m),
    phase_change: (m) => experimentStore.onPhaseChange(m),
    gm_plan: (m) => gmStore.onPlan(m),
    gm_narration: (m) => gmStore.onNarration(m),
    agent_action: (m) => agentStore.onAction(m),
    agent_move: (m) => agentStore.onMove(m),
    agent_speak: (m) => socialStore.onSpeak(m),
    crisis_event: (m) => worldStore.onCrisis(m),
    threat_update: (m) => worldStore.onThreatUpdate(m),
    resource_update: (m) => worldStore.onResourceUpdate(m),
    meeting_start: (m) => socialStore.onMeetingStart(m),
    meeting_speech: (m) => socialStore.onMeetingSpeech(m),
    meeting_vote: (m) => socialStore.onMeetingVote(m),
    meeting_result: (m) => socialStore.onMeetingResult(m),
    faction_update: (m) => socialStore.onFactionUpdate(m),
    cult_activity: (m) => socialStore.onCultActivity(m),
    exile_vote: (m) => socialStore.onExileVote(m),
    exile_result: (m) => socialStore.onExileResult(m),
    experiment_end: (m) => experimentStore.onEnd(m),
    step_error: () => {
      useUIStore().clearStepping()
    },
  }

  const handler = router[msg.type as WSMessageType]
  if (handler) {
    handler(msg)
  }
}
