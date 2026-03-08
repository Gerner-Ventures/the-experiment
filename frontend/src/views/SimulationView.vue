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
import ActionLabel from '@/components/hud/ActionLabel.vue'
import AgentDossier from '@/components/dossier/AgentDossier.vue'
import ExperimentLog from '@/components/log/ExperimentLog.vue'
import ConversationBubble from '@/components/social/ConversationBubble.vue'
import TownMeeting from '@/components/social/TownMeeting.vue'
import { useExperimentStore } from '@/stores/experiment'
import { useAgentStore } from '@/stores/agent'
import { useWorldStore } from '@/stores/world'
import { useGMStore } from '@/stores/gm'
import { useUIStore } from '@/stores/ui'
import { useSocialStore } from '@/stores/social'
import { useTurnStore } from '@/stores/turn'
import { AGGRESSIVE_ACTIONS } from '@/config/action-categories'
import { useWebSocket } from '@/composables/useWebSocket'
import { api } from '@/services/api'
import type { ExperimentStatus } from '@/types/experiment'

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

const pixiWorldRef = ref<InstanceType<typeof PixiWorld>>()

// Reactive state for the action label overlay
const actionLabelPosition = ref<{ x: number; y: number } | null>(null)
const actionLabelType = ref('')
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
import { MUTE_STORAGE_KEY } from '@/config/audio'
const isMuted = ref(localStorage.getItem(MUTE_STORAGE_KEY) === 'true')

function toggleMute() {
  isMuted.value = !isMuted.value
  localStorage.setItem(MUTE_STORAGE_KEY, String(isMuted.value))
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
    uiStore.isPlaying = true
  } catch (err) {
    console.error('Start failed:', err)
  }
}

async function handlePause() {
  if (!experimentStore.id) return
  try {
    await api.pauseExperiment(experimentStore.id)
    uiStore.isPlaying = false
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
  }
})

// When a round completes (from WS round_end), schedule next step if auto-playing
watch(() => experimentStore.completedRounds, () => {
  if (!waitingForRound || !uiStore.isPlaying) return
  waitingForRound = false

  if (experimentStore.isComplete) {
    uiStore.isPlaying = false
    router.push({ name: 'report', params: { id: experimentStore.id! } })
    return
  }

  const delay = 3000 / uiStore.playbackSpeed
  autoPlayTimer = setTimeout(autoStep, delay)
})

function autoStep() {
  if (!uiStore.isPlaying || experimentStore.isComplete) {
    uiStore.isPlaying = false
    return
  }
  waitingForRound = true
  handleStep()
}

function handleAgentClick(agentId: string) {
  uiStore.selectAgent(agentId)
}

// ─── Turn store handler wiring ───

function wireTurnHandlers() {
  const pw = pixiWorldRef.value
  if (!pw) return

  turnStore.setHandlers({
    move(_agentId, _location, onComplete) {
      // No-op until pathfinding is wired. nextTick avoids a synchronous
      // moving→acting phase flicker in the same tick.
      nextTick(onComplete)
    },
    playAction(agentId, animationName, onComplete) {
      pw.playAction(agentId, animationName, onComplete)
    },
    updateAgent(agentId, status, location) {
      const updates: Record<string, unknown> = { status }
      if (location) updates.location = location
      agentStore.onAgentUpdate(agentId, updates)
    },
    addConversation(agentId, agentName, message) {
      socialStore.onSpeak({
        type: 'agent_speak',
        round: experimentStore.currentRound,
        timestamp: new Date().toISOString(),
        data: { agent_id: agentId, agent_name: agentName, target: 'all', message },
      })
    },
    getAgentLocation(agentId) {
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
    // Show action label
    const pos = pw.getAgentScreenPosition(turn.agentId)
    if (pos) {
      actionLabelPosition.value = pos
      actionLabelType.value = turn.actionType
    }
    // Highlight target
    if (turn.targetAgentId) {
      const color = AGGRESSIVE_ACTIONS.has(turn.actionType) ? '#ff4444' : '#ffffff'
      pw.highlightAgent(turn.targetAgentId, color)
      highlightedTargetId.value = turn.targetAgentId
    }
  }

  if (oldPhase === 'acting') {
    // Clear action label
    actionLabelPosition.value = null
    actionLabelType.value = ''
    // Clear target highlight
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
      uiStore.isPlaying = false
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
            @step="handleStep"
            @play="handleStart"
            @pause="handlePause"
            @toggle-log="uiStore.togglePanel('log')"
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

        <!-- Action label overlay (during acting phase) -->
        <ActionLabel
          v-if="actionLabelPosition && actionLabelType"
          class="pointer-events-none"
          :action-type="actionLabelType"
          :position="actionLabelPosition"
        />

        <!-- Conversation bubbles (pointer-events-auto so future interactions work) -->
        <ConversationBubble
          v-for="(conv, i) in socialStore.recentConversations.slice(-3)"
          :key="conv.id"
          class="pointer-events-auto"
          :agent-name="conv.agentName"
          :message="conv.message"
          :index="i"
          :audio-status="conv.audioStatus"
          :audio-url="conv.audioUrl"
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
      :visible="uiStore.activePanel === 'dossier'"
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
      :visible="uiStore.activePanel === 'log'"
      @close="uiStore.setPanel('none')"
    />
  </div>
</template>
