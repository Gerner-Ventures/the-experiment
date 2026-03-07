<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
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
import TownMeeting from '@/components/social/TownMeeting.vue'
import { useExperimentStore } from '@/stores/experiment'
import { useAgentStore } from '@/stores/agent'
import { useWorldStore } from '@/stores/world'
import { useGMStore } from '@/stores/gm'
import { useUIStore } from '@/stores/ui'
import { useSocialStore } from '@/stores/social'
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
const ws = useWebSocket()

// Theme from sessionStorage (set by SetupView) or default
const themeId = sessionStorage.getItem('experiment-theme') || 'lord-of-the-flies'
const theme = computed<MapTheme>(() => getThemeById(themeId) ?? MAP_THEMES[0])

const ready = ref(false)
const experimentCreated = ref(false)
const isDemo = computed(() => route.params.id === 'demo')
const loadError = ref<string | null>(null)

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

    experimentCreated.value = true
    ready.value = true
  } catch (err) {
    console.error('Failed to load experiment:', err)
    loadError.value = err instanceof Error ? err.message : 'Failed to load experiment'
    ready.value = true
  }
}

async function handleStep() {
  if (!experimentStore.id) return
  try {
    await api.stepRound(experimentStore.id)
  } catch (err) {
    console.error('Step failed:', err)
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

// Auto-play mode
let autoPlayTimer: ReturnType<typeof setTimeout> | null = null

watch(() => uiStore.isPlaying, (playing) => {
  if (playing) {
    autoStep()
  } else if (autoPlayTimer) {
    clearTimeout(autoPlayTimer)
    autoPlayTimer = null
  }
})

function autoStep() {
  if (!uiStore.isPlaying || experimentStore.isComplete) {
    uiStore.isPlaying = false
    return
  }
  handleStep().then(() => {
    const delay = 3000 / uiStore.playbackSpeed
    autoPlayTimer = setTimeout(autoStep, delay)
  })
}

function handleAgentClick(agentId: string) {
  uiStore.selectAgent(agentId)
}

onMounted(async () => {
  await initExperiment()
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
})

// Redirect to report when experiment completes
watch(() => experimentStore.isComplete, (complete) => {
  if (complete && experimentStore.id) {
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

    <!-- PixiJS World -->
    <div class="flex-1 relative">
      <PixiWorld
        v-if="ready && (experimentCreated || isDemo)"
        :theme="theme"
        :map-data="DEFAULT_TOWN"
        :agents="agentStore.agentConfigs"
        :demo-mode="!experimentCreated"
        @agent-click="handleAgentClick"
      />
      <div v-else-if="loadError" class="h-full flex flex-col items-center justify-center gap-4">
        <Typography.Text class="font-mono !text-sm !text-red-400">
          {{ loadError }}
        </Typography.Text>
        <Button @click="goBack">Back to Setup</Button>
      </div>
      <div v-else class="h-full flex items-center justify-center">
        <Typography.Text class="font-mono !text-sm !text-white/30">
          {{ locale.simulation.loading }}
        </Typography.Text>
      </div>

      <!-- Control Bar (bottom center) -->
      <div class="absolute bottom-0 left-1/2 -translate-x-1/2 z-10">
        <ControlBar
          :is-playing="uiStore.isPlaying"
          :speed="uiStore.playbackSpeed"
          :is-complete="experimentStore.isComplete"
          :has-experiment="experimentCreated"
          @step="handleStep"
          @play="handleStart"
          @pause="handlePause"
          @speed-change="uiStore.setPlaybackSpeed"
          @toggle-log="uiStore.togglePanel('log')"
        />
      </div>

      <!-- Left side: Resource bars + Threat -->
      <div class="absolute top-3 left-3 z-10 space-y-2 pointer-events-auto">
        <ThreatMeter :value="worldStore.threatLevel" />
        <ResourceBars :resources="worldStore.resources" />
      </div>

      <!-- Right side: Arc timeline -->
      <div class="absolute top-3 right-3 z-10 pointer-events-auto">
        <ArcTimeline
          v-if="experimentCreated"
          :arc-name="themeId"
          :current-round="experimentStore.currentRound"
          :total-rounds="experimentStore.totalRounds"
        />
      </div>

      <!-- Conversation bubbles -->
      <ConversationBubble
        v-for="(conv, i) in socialStore.recentConversations.slice(-3)"
        :key="conv.id"
        :agent-name="conv.agentName"
        :message="conv.message"
        :index="i"
      />
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
      @dismiss="gmStore.dismissNarration()"
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
