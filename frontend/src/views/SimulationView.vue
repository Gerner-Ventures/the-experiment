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
import TownMeeting from '@/components/social/TownMeeting.vue'
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
  return socialStore.conversations.find(
    (c) => c.agentId === turn.agentId && c.message === turn.thought,
  ) ?? null
})

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
        try {
          const meta = await api.getRoundNarration(detail.experiment_id, planRound)
          gmStore.hydrateNarration(
            planNarration,
            planRound,
            meta.status === 'ready' ? 'ready' : 'unavailable',
            meta.status === 'ready' ? meta.audio_url ?? null : null,
          )
        } catch {
          // Backend narration endpoint unavailable — show text only
          gmStore.hydrateNarration(planNarration, planRound, 'unavailable', null)
        }
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
    addConversation(agentId: string, agentName: string, message: string) {
      socialStore.addConversation(agentId, agentName, message)
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
        class="absolute inset-0 z-0"
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

        <!-- Turn-driven conversation bubble -->
        <ConversationBubble
          v-if="turnStore.phase === 'talking' && turnStore.activeTurn?.thought"
          :key="turnStore.activeTurn.id"
          class="pointer-events-auto"
          :agent-name="turnStore.activeTurn.agentName"
          :message="turnStore.activeTurn.thought"
          :agent-id="turnStore.activeTurn.agentId"
          :get-position="(id: string) => pixiWorldRef?.getAgentScreenPosition(id) ?? null"
          :audio-status="activeBubbleAudio?.audioStatus ?? 'idle'"
          :audio-url="activeBubbleAudio?.audioUrl ?? null"
          @dismiss="turnStore.onBubbleDismissed()"
          @audio-end="turnStore.notifyAudioComplete()"
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
    />

    <!-- Agent Dossier Drawer -->
    <AgentDossier
      :agent-id="uiStore.selectedAgentId"
      :visible="uiStore.activePanel === PANELS.DOSSIER"
      @close="uiStore.deselectAgent()"
    />

    <!-- Town Meeting Panel -->
    <TownMeeting
      :meeting="socialStore.meeting"
      :visible="socialStore.isMeetingActive"
      @dismiss="socialStore.dismissMeeting()"
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
