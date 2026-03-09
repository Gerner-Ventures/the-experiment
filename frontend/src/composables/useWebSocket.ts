import { ref, type Ref } from 'vue'
import type { WSMessage } from '@/types/websocket'
import { routeMessage } from '@/composables/wsRouter'

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
