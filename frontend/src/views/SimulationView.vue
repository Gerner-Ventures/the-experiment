<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Typography } from 'ant-design-vue'
import { ArrowLeftOutlined } from '@ant-design/icons-vue'
import { useLocale } from '@/locales'
import { getThemeById, MAP_THEMES } from '@/config/map-themes'
import { DEFAULT_TOWN } from '@/config/default-town'
import type { MapTheme } from '@/types/world'
import PixiWorld from '@/components/world/PixiWorld.vue'
import ControlBar from '@/components/hud/ControlBar.vue'
import ThreatMeter from '@/components/hud/ThreatMeter.vue'
import ResourceBars from '@/components/hud/ResourceBars.vue'
import RoundCounter from '@/components/hud/RoundCounter.vue'
import ArcTimeline from '@/components/hud/ArcTimeline.vue'
import GMPlanPanel from '@/components/hud/GMPlanPanel.vue'
import NarrationOverlay from '@/components/hud/NarrationOverlay.vue'
import AgentDossier from '@/components/dossier/AgentDossier.vue'
import ExperimentLog from '@/components/log/ExperimentLog.vue'
import ConversationBubble from '@/components/social/ConversationBubble.vue'
import RelationshipWeb from '@/components/social/RelationshipWeb.vue'
import MeetingScene from '@/components/social/MeetingScene.vue'
import { useExperimentStore } from '@/stores/experiment'
import { useAgentStore } from '@/stores/agent'
import { useWorldStore } from '@/stores/world'
import { useGMStore } from '@/stores/gm'
import { useUIStore, PANELS } from '@/stores/ui'
import { useSocialStore } from '@/stores/social'
import { useTurnStore } from '@/stores/turn'
import { AGGRESSIVE_ACTIONS } from '@/config/action-categories'
import { MUTE_STORAGE_KEY } from '@/config/audio'
import { useWebSocket } from '@/composables/useWebSocket'
import { api } from '@/services/api'
import type { ExperimentStatus } from '@/types/experiment'
import type { AgentStatus } from '@/types/agent'

const locale = useLocale()
const route = useRoute()
const router = useRouter()

const experimentStore = useExperimentStore()
const agentStore = useAgentStore()
const worldStore = useWorldStore()
const gmStore = useGMStore()
const uiStore = useUIStore()
const socialStore = useSocialStore()
const turnStore = useTurnStore()
const ws = useWebSocket()

const pixiWorldRef = ref<InstanceType<typeof PixiWorld> | null>(null)

const highlightedTargetId = ref<string | null>(null)

// Theme and arc from sessionStorage (set by SetupView) or defaults
const themeId = sessionStorage.getItem('experiment-theme') || 'lord-of-the-flies'
const arcId = sessionStorage.getItem('experiment-arc') || 'lord_of_the_flies'
const theme = computed<MapTheme>(() => getThemeById(themeId) ?? MAP_THEMES[0])

const ready = ref(false)
const experimentCreated = ref(false)
const isDemo = computed(() => route.params.id === 'demo')
const loadError = ref<string | null>(null)

// Mute state for agent voice narration
const isMuted = ref(window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true')

// TODO: toggling mute while audio is mid-playback does not stop the current bubble's audio
function toggleMute() {
  isMuted.value = !isMuted.value
  window.localStorage.setItem(MUTE_STORAGE_KEY, String(isMuted.value))
}

// Find the socialStore conversation entry matching the active turn bubble (for audio data)
const activeBubbleAudio = computed(() => {
  const turn = turnStore.activeTurn
  if (!turn?.thought) return null
  if (turn.thoughtConversationId != null) {
    const byId = socialStore.conversations.find((conversation) => conversation.id === turn.thoughtConversationId)
    if (byId) {
      return byId
    }
  }
  if (turn.thoughtAudioIndex != null) {
    const byIndex = socialStore.conversations.find((conversation) =>
      conversation.agentId === turn.agentId
      && conversation.round === turn.round
      && conversation.index === turn.thoughtAudioIndex
      && conversation.source === (turn.thoughtSource ?? 'inner_thought'),
    )
    if (byIndex) {
      return byIndex
    }
  }
  for (let i = socialStore.conversations.length - 1; i >= 0; i--) {
    const conversation = socialStore.conversations[i]
    if (
      conversation.agentId === turn.agentId
      && conversation.round === turn.round
      && conversation.source === (turn.thoughtSource ?? 'inner_thought')
      && conversation.message === turn.thought
    ) {
      return conversation
    }
  }
  console.warn('[Simulation] Missing audio match for active turn bubble', {
    agentId: turn.agentId,
    round: turn.round,
    source: turn.thoughtSource ?? 'inner_thought',
    thought: turn.thought,
    thoughtConversationId: turn.thoughtConversationId ?? null,
    thoughtAudioIndex: turn.thoughtAudioIndex ?? null,
    conversations: socialStore.conversations
      .filter(c => c.agentId === turn.agentId && c.round === turn.round)
      .map(c => ({
        id: c.id,
        index: c.index,
        source: c.source,
        message: c.message,
        audioStatus: c.audioStatus,
        audioUrl: c.audioUrl,
      })),
  })
  return null
})


let narrationHydrationToken = 0
const NARRATION_METADATA_RETRY_MS = 500
const NARRATION_METADATA_MAX_ATTEMPTS = 8
let lastNarrationRecoveryUrl: string | null = null

function apiErrorStatus(err: unknown): number | null {
  if (!(err instanceof Error)) return null
  const match = err.message.match(/^API (\d+):/)
  return match ? Number(match[1]) : null
}

function delay(ms: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, ms))
}

async function syncRoundNarration(experimentId: string, round: number, fallbackText: string) {
  const token = ++narrationHydrationToken
  gmStore.setNarrationFallback(fallbackText, round)

  for (let attempt = 0; attempt <= NARRATION_METADATA_MAX_ATTEMPTS; attempt++) {
    try {
      const meta = await api.getRoundNarration(experimentId, round)
      if (token !== narrationHydrationToken) return

      gmStore.hydrateNarration(
        meta.text,
        meta.round_number,
        meta.narration_id,
        meta.status,
        meta.audio_url ?? null,
      )
      if (meta.audio_url !== lastNarrationRecoveryUrl) {
        lastNarrationRecoveryUrl = null
      }

      if (meta.status !== 'pending') {
        return
      }
    } catch (err) {
      if (token !== narrationHydrationToken) return
      const status = apiErrorStatus(err)
      const retryable = status === 409
      if (!retryable || attempt === NARRATION_METADATA_MAX_ATTEMPTS) {
        if (!retryable) {
          console.warn('Failed to load round narration metadata:', err)
        }
        gmStore.hydrateNarration(fallbackText, round, null, 'unavailable', null)
        return
      }
    }

    if (attempt === NARRATION_METADATA_MAX_ATTEMPTS) {
      gmStore.hydrateNarration(fallbackText, round, null, 'unavailable', null)
      return
    }
    await delay(NARRATION_METADATA_RETRY_MS)
  }
}

function handleNarrationAudioError() {
  const experimentId = experimentStore.id
  const round = gmStore.narrationRound
  const text = gmStore.narrationText
  const audioUrl = gmStore.narrationAudioUrl
  if (!experimentId || round === null || !text || !audioUrl) return
  if (lastNarrationRecoveryUrl === audioUrl) return
  lastNarrationRecoveryUrl = audioUrl
  void syncRoundNarration(experimentId, round, text)
}

async function initExperiment() {
  const experimentId = route.params.id as string

  if (isDemo.value) {
    ready.value = true
    return
  }

  try {
    // Load experiment from backend (already created by SetupView)
    const detail = await api.getExperiment(experimentId)

    const ws_ = (detail.world_state ?? {}) as Record<string, unknown>
    const resources = ws_.resources as Record<string, number> | undefined

    experimentStore.setExperiment({
      id: detail.experiment_id,
      name: detail.experiment_name,
      status: detail.status as ExperimentStatus,
      currentRound: detail.current_round,
      totalRounds: detail.total_rounds,
    })

    agentStore.setAgents(detail.agents)
    if (resources) {
      worldStore.setResources({
        food: resources.food ?? 0,
        water: resources.water ?? 0,
        materials: resources.materials ?? 0,
        power: resources.power ?? 0,
      })
    }
    worldStore.setThreatLevel((ws_.threat_level as number) ?? 0)

    // Connect WebSocket for live updates
    const wsUrl = api.getWebSocketUrl(detail.experiment_id)
    ws.connect(wsUrl)

    // Hydrate narration state if an applied GM plan exists (reconnect / refresh)
    if (detail.gm_plan) {
      const planData = detail.gm_plan as { plan?: Record<string, unknown>; status?: string }
      const planRound = (planData.plan?.round as number) ?? detail.current_round
      const planNarration = (planData.plan?.narration as string) ?? ''
      if (planData.status === 'applied' && planNarration) {
        await syncRoundNarration(detail.experiment_id, planRound, planNarration)
      }
    }

    experimentCreated.value = true
    ready.value = true
  } catch (err) {
    console.error('Failed to load experiment:', err)
    loadError.value = err instanceof Error ? err.message : 'Failed to load experiment'
    ready.value = true
  }
}

async function handleStep() {
  if (!experimentStore.id || uiStore.isStepping) return
  try {
    console.debug('[Step] Starting step, isStepping:', uiStore.isStepping)
    uiStore.startStepping(locale.hud.steppingRunning)
    console.debug('[Step] Called startStepping, isStepping:', uiStore.isStepping)
    await api.stepRound(experimentStore.id)
    console.debug('[Step] stepRound API returned')
  } catch (err) {
    console.error('[Step] Step failed:', err)
    uiStore.clearStepping()
    waitingForRound = false
  }
}

async function handleStart() {
  if (!experimentStore.id) return
  try {
    await api.startExperiment(experimentStore.id)
    uiStore.setPlaying(true)
  } catch (err) {
    console.error('Start failed:', err)
  }
}

async function handlePause() {
  if (!experimentStore.id) return
  try {
    await api.pauseExperiment(experimentStore.id)
    uiStore.setPlaying(false)
  } catch (err) {
    console.error('Pause failed:', err)
  }
}

async function handleApprovePlan() {
  if (!experimentStore.id) return
  gmStore.approvePlan()
  try {
    await api.approvePlan(experimentStore.id)
  } catch (err) {
    console.error('Approve plan failed:', err)
  }
}

// Auto-play mode: watch for round completion via store updates
let autoPlayTimer: ReturnType<typeof setTimeout> | null = null
let waitingForRound = false

watch(() => uiStore.isPlaying, (playing) => {
  if (playing) {
    autoStep()
  } else {
    if (autoPlayTimer) {
      clearTimeout(autoPlayTimer)
      autoPlayTimer = null
    }
    waitingForRound = false
    uiStore.clearStepping()
  }
})

watch(
  () => gmStore.showNarration,
  (visible) => {
    turnStore.setBlocked(visible)
  },
  { immediate: true },
)

// When a round completes (from WS round_end), schedule next step if auto-playing
watch(() => experimentStore.completedRounds, () => {
  if (!waitingForRound || !uiStore.isPlaying) return
  waitingForRound = false

  if (experimentStore.isComplete) {
    uiStore.setPlaying(false)
    router.push({ name: 'report', params: { id: experimentStore.id! } })
    return
  }

  // Keep status visible during delay between rounds
  uiStore.setSteppingStatus(locale.hud.steppingNextRound)

  const delay = 3000 / uiStore.playbackSpeed
  autoPlayTimer = setTimeout(autoStep, delay)
})

function autoStep() {
  if (!uiStore.isPlaying || experimentStore.isComplete) {
    uiStore.setPlaying(false)
    return
  }
  waitingForRound = true
  handleStep()
}

function handleAgentClick(agentId: string) {
  uiStore.selectAgent(agentId)
}

function onMeetingSceneExited() {
  socialStore.dismissMeeting()
}

function onExileComplete(agentId: string) {
  console.debug(`[Simulation] Exile complete: ${agentId}`)
  // Mark agent as exiled (deferred until after meeting animation completes)
  agentStore.updateAgentStatus(agentId, 'exiled')
  // Remove exiled agent from game world
  pixiWorldRef.value?.removeAgent(agentId)
}

// ─── Day/night cycle phase wiring ───

watch(() => experimentStore.currentPhase, (phase) => {
  if (phase) pixiWorldRef.value?.setPhase(phase)
})

// ─── Turn store handler wiring ───

function wireTurnHandlers() {
  const pw = pixiWorldRef.value
  if (!pw) return

  turnStore.setHandlers({
    move(agentId: string, location: string, onComplete: () => void) {
      pw.moveAgentToLocation(agentId, location, onComplete)
    },
    playAction(agentId: string, animationName: string, onComplete: () => void) {
      pw.playAction(agentId, animationName, onComplete)
    },
    updateAgent(agentId: string, status: AgentStatus, location?: string) {
      agentStore.updateAgentStatus(agentId, status, location)
    },
    addConversation(agentId: string, agentName: string, message: string, source, round) {
      return socialStore.addConversation(agentId, agentName, message, '', undefined, round, source)
    },
    getAgentLocation(agentId: string) {
      return agentStore.getAgent(agentId)?.location
    },
  })
}

// ─── Action label + target highlight reactivity ───

watch(() => turnStore.phase, (newPhase, oldPhase) => {
  const pw = pixiWorldRef.value
  if (!pw) return

  if (newPhase === 'acting' && turnStore.activeTurn) {
    const turn = turnStore.activeTurn
    // Highlight target agent during action
    if (turn.targetAgentId) {
      const color = AGGRESSIVE_ACTIONS.has(turn.actionType) ? '#ff4444' : '#ffffff'
      pw.highlightAgent(turn.targetAgentId, color)
      highlightedTargetId.value = turn.targetAgentId
    }
  }

  if (oldPhase === 'acting') {
    if (highlightedTargetId.value) {
      pw.clearHighlight(highlightedTargetId.value)
      highlightedTargetId.value = null
    }
  }
})

onMounted(async () => {
  await initExperiment()
  await nextTick()
  wireTurnHandlers()

  // Replay current phase into PixiWorld after mount.
  // A phase_change WS message may have arrived before PixiWorld existed,
  // setting experimentStore.currentPhase while pixiWorldRef was still null.
  // The watcher would have silently no-op'd, so we replay here.
  // TODO: backend should expose current_phase in ExperimentDetail / WS connect
  // payload so reconnects can fully hydrate without waiting for the next transition.
  if (experimentStore.currentPhase) {
    pixiWorldRef.value?.setPhase(experimentStore.currentPhase)
  }
})

onUnmounted(() => {
  ws.disconnect()
  if (autoPlayTimer) clearTimeout(autoPlayTimer)
  experimentStore.$reset()
  agentStore.$reset()
  worldStore.$reset()
  gmStore.$reset()
  uiStore.$reset()
  socialStore.$reset()
  turnStore.$reset()
})

// When stepping clears (from step_error, disconnect, etc.), reset waitingForRound
// so auto-play doesn't stall permanently
watch(() => uiStore.isStepping, (stepping) => {
  if (!stepping) {
    waitingForRound = false
  }
})

// Clear stepping and auto-play state if WebSocket disconnects mid-round
watch(() => ws.state.value, (state) => {
  if (state === 'disconnected') {
    if (uiStore.isStepping) {
      uiStore.clearStepping()
      waitingForRound = false
    }
    if (uiStore.isPlaying) {
      uiStore.setPlaying(false)
    }
  }
})

// Redirect to report when experiment completes (only when not auto-playing,
// since the currentRound watcher handles navigation during auto-play)
watch(() => experimentStore.isComplete, (complete) => {
  if (complete && experimentStore.id && !uiStore.isPlaying) {
    router.push({ name: 'report', params: { id: experimentStore.id } })
  }
})

function goBack() {
  router.push({ name: 'setup', query: { configure: '1' } })
}
</script>

<template>
  <div class="h-full w-full flex flex-col bg-void relative overflow-hidden">
    <!-- Top bar -->
    <header class="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-base/80 backdrop-blur-sm shrink-0 z-20">
      <div class="flex items-center gap-3">
        <Button size="small" class="!inline-flex !items-center !justify-center" @click="goBack">
          <template #icon><ArrowLeftOutlined /></template>
        </Button>
        <Typography.Text class="font-mono !text-xs !text-white/40 uppercase tracking-widest">
          {{ theme.name }}
        </Typography.Text>
      </div>
      <div class="flex items-center gap-4">
        <RoundCounter
          :current="experimentStore.currentRound"
          :total="experimentStore.totalRounds"
          :phase="experimentStore.currentPhase"
        />
        <div class="flex items-center gap-1.5">
          <div
            class="w-1.5 h-1.5 rounded-full"
            :class="{
              'bg-green-500': ws.state.value === 'connected',
              'bg-yellow-500 animate-pulse': ws.state.value === 'connecting',
              'bg-white/20': ws.state.value === 'disconnected',
            }"
          />
          <Typography.Text class="font-mono !text-[10px] !text-white/20">
            {{ ws.state.value === 'connected' ? 'LIVE' : ws.state.value === 'connecting' ? 'CONNECTING' : 'OFFLINE' }}
          </Typography.Text>
        </div>
      </div>
    </header>

    <!-- PixiJS World — isolate creates a stacking context so the WebGL canvas
         cannot escape above the HUD during GPU compositing / resize events -->
    <div class="flex-1 relative isolate">
      <!-- Canvas layer (z-0) -->
      <PixiWorld
        v-if="ready && (experimentCreated || isDemo)"
        ref="pixiWorldRef"
        class="absolute inset-0 z-0 transition-opacity duration-500"
        :class="{ 'opacity-0 pointer-events-none': socialStore.isMeetingActive }"
        :theme="theme"
        :map-data="DEFAULT_TOWN"
        :agents="agentStore.agentConfigs"
        :demo-mode="!experimentCreated"
        @agent-click="handleAgentClick"
      />
      <div v-else-if="loadError" class="absolute inset-0 flex flex-col items-center justify-center gap-4">
        <Typography.Text class="font-mono !text-sm !text-red-400">
          {{ loadError }}
        </Typography.Text>
        <Button @click="goBack">Back to Setup</Button>
      </div>
      <div v-else class="absolute inset-0 flex items-center justify-center">
        <Typography.Text class="font-mono !text-sm !text-white/30">
          {{ locale.simulation.loading }}
        </Typography.Text>
      </div>

      <!-- HUD overlay layer (z-10) — always rendered, pointer-events pass through
           to canvas except on interactive children -->
      <div class="absolute inset-0 z-10 pointer-events-none">
        <!-- Control Bar (bottom center) -->
        <div class="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-auto">
          <ControlBar
            :is-playing="uiStore.isPlaying"
            :is-stepping="uiStore.isStepping"
            :stepping-status="uiStore.steppingStatus"
            :is-complete="experimentStore.isComplete"
            :has-experiment="experimentCreated"
            :is-muted="isMuted"
            :auto-start="experimentCreated && experimentStore.currentRound === 0"
            @step="handleStep"
            @play="handleStart"
            @pause="handlePause"
            @toggle-log="uiStore.togglePanel(PANELS.LOG)"
            @toggle-relationship-web="uiStore.togglePanel(PANELS.RELATIONSHIP_WEB)"
            @toggle-mute="toggleMute"
          />
        </div>

        <!-- Left side: Resource bars + Threat (display-only, no pointer-events
             so canvas panning works through these regions) -->
        <div class="absolute top-3 left-3 space-y-2">
          <ThreatMeter :value="worldStore.threatLevel" />
          <ResourceBars :resources="worldStore.resources" />
        </div>

        <!-- Right side: Arc timeline -->
        <div class="absolute top-3 right-3">
          <ArcTimeline
            v-if="experimentCreated"
            class="pointer-events-auto"
            :arc-name="arcId"
            :current-round="experimentStore.currentRound"
            :total-rounds="experimentStore.totalRounds"
          />
        </div>

        <!-- Turn-driven conversation bubble (hidden during meeting — MeetingScene renders its own) -->
        <ConversationBubble
          v-if="turnStore.phase === 'thinking' && turnStore.activeTurn?.thought && !socialStore.isMeetingActive"
          :key="turnStore.activeTurn.id"
          class="pointer-events-auto"
          :turn-id="turnStore.activeTurn.id"
          :agent-name="turnStore.activeTurn.agentName"
          :message="turnStore.activeTurn.thought"
          :agent-id="turnStore.activeTurn.agentId"
          variant="thought"
          :get-position="(id: string) => pixiWorldRef?.getAgentScreenPosition(id) ?? null"
          :audio-status="activeBubbleAudio?.audioStatus ?? 'idle'"
          :audio-url="activeBubbleAudio?.audioUrl ?? null"
          @dismiss="turnStore.onBubbleDismissed($event)"
          @audio-end="turnStore.notifyAudioComplete($event)"
        />
      </div>
    </div>

    <!-- GM Plan Panel (Drawer) -->
    <GMPlanPanel
      :plan="gmStore.currentPlan"
      :visible="gmStore.showPlanPanel"
      @approve="handleApprovePlan"
      @close="gmStore.showPlanPanel = false"
    />

    <!-- Narration Overlay -->
    <NarrationOverlay
      :text="gmStore.narrationText"
      :visible="gmStore.showNarration"
      :audio-status="gmStore.narrationAudioStatus"
      :audio-url="gmStore.narrationAudioUrl"
      :autoplay-blocked="gmStore.audioAutoplayBlocked"
      @dismiss="gmStore.dismissNarration()"
      @update:playing="gmStore.setNarrationPlaying($event)"
      @update:autoplay-blocked="gmStore.setAutoplayBlocked($event)"
      @audio-error="handleNarrationAudioError"
    />

    <!-- Agent Dossier Drawer -->
    <AgentDossier
      :agent-id="uiStore.selectedAgentId"
      :visible="uiStore.activePanel === PANELS.DOSSIER"
      @close="uiStore.deselectAgent()"
    />

    <!-- Meeting Scene Overlay -->
    <MeetingScene
      v-if="socialStore.isMeetingActive && socialStore.meeting"
      :meeting="socialStore.meeting"
      :active-turn="turnStore.activeTurn"
      :turn-phase="turnStore.phase"
      :has-pending-turns="turnStore.hasPendingTurns"
      :active-bubble-audio="activeBubbleAudio"
      :theme-id="themeId"
      @bubble-dismiss="turnStore.onBubbleDismissed($event)"
      @audio-end="turnStore.notifyAudioComplete($event)"
      @scene-exited="onMeetingSceneExited"
      @exile-complete="onExileComplete"
    />

    <!-- Event Log Drawer -->
    <ExperimentLog
      :events="experimentStore.events"
      :visible="uiStore.activePanel === PANELS.LOG"
      @close="uiStore.setPanel(PANELS.NONE)"
    />

    <!-- Relationship Web Drawer -->
    <RelationshipWeb
      :visible="uiStore.activePanel === PANELS.RELATIONSHIP_WEB"
      @close="uiStore.setPanel(PANELS.NONE)"
    />
  </div>
</template>
