<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Button, Badge, Space, Row, Col, Typography,
} from 'ant-design-vue'
import {
  ExperimentOutlined, ThunderboltOutlined,
} from '@ant-design/icons-vue'
import GlitchText from '@/components/ui/GlitchText.vue'
import AgentConfigurator from '@/components/setup/AgentConfigurator.vue'
import ArcSelector from '@/components/setup/ArcSelector.vue'
import MapThemePicker from '@/components/setup/MapThemePicker.vue'
import ParameterControls from '@/components/setup/ParameterControls.vue'
import type { AgentConfig } from '@/types/agent'
import { useLocale } from '@/locales'
import { MIN_AGENTS, DEFAULT_LLM_MODEL, DEFAULT_PERSONALITY_AXES, GOAL_PRESET_KEYS, GOAL_ARCHETYPE_MAP } from '@/config/agent-options'
import { CHARACTERS } from '@/config/character-options'

const locale = useLocale()
const router = useRouter()

// Boot sequence state
const bootPhase = ref(0) // 0=booting, 1=ready, 2=configuring
const bootLines = locale.boot.lines
const currentBootLine = ref(0)
const systemReady = ref(false)
const timers: ReturnType<typeof setTimeout>[] = []

function onBootLineComplete() {
  if (currentBootLine.value < bootLines.length - 1) {
    timers.push(setTimeout(() => currentBootLine.value++, 300))
  } else {
    timers.push(setTimeout(() => {
      systemReady.value = true
      bootPhase.value = 1
    }, 800))
  }
}

onUnmounted(() => timers.forEach(clearTimeout))

function enterSetup() {
  bootPhase.value = 2
}

const defaultGoalKeys = GOAL_PRESET_KEYS.slice(0, MIN_AGENTS)
const defaultAgents: AgentConfig[] = CHARACTERS.slice(0, MIN_AGENTS).map((char, i) => {
  const goalKey = defaultGoalKeys[i % defaultGoalKeys.length]
  return {
    id: String(i + 1),
    name: char.name,
    characterId: char.id,
    personality: [],
    personalityAxes: { ...DEFAULT_PERSONALITY_AXES },
    secretGoal: locale.agents.goalPresets[goalKey].goal,
    goalArchetype: GOAL_ARCHETYPE_MAP[goalKey],
    llmModel: i % 3 === 2 ? 'gpt-4o' : DEFAULT_LLM_MODEL,
  }
})
const agents = ref<AgentConfig[]>(defaultAgents)

const selectedTheme = ref('lord-of-the-flies')
const selectedArc = ref('lord-of-the-flies')
const totalRounds = ref(15)
const startingResources = ref(100)

const canBegin = computed(() =>
  agents.value.length >= MIN_AGENTS &&
  agents.value.every(a => a.name && a.secretGoal)
)

const readyCount = computed(() =>
  agents.value.filter(a => a.name && a.secretGoal).length
)

function beginExperiment() {
  sessionStorage.setItem('experiment-config', JSON.stringify({
    agents: agents.value,
    themeId: selectedTheme.value,
    arc: selectedArc.value,
    rounds: totalRounds.value,
    resources: startingResources.value,
  }))
  router.push({ name: 'simulation', params: { id: 'demo' } })
}
</script>

<template>
  <div class="h-full w-full flex flex-col bg-void relative overflow-hidden">
    <!-- Background grid -->
    <div
      class="absolute inset-0 opacity-[0.02]"
      style="background-image: linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px); background-size: 40px 40px;"
    />
    <!-- Vignette -->
    <div class="absolute inset-0 pointer-events-none" style="background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%);" />

    <!-- ═══ BOOT SEQUENCE ═══ -->
    <Transition name="fade">
      <div v-if="bootPhase < 2" class="relative z-10 h-full flex flex-col items-center justify-center gap-8">
        <div class="text-center space-y-4">
          <div class="relative inline-block">
            <h1 class="font-display text-6xl font-bold tracking-tight text-white/90">
              {{ locale.app.title }}
            </h1>
            <div class="absolute -inset-x-8 -inset-y-4 border border-accent/10 rounded-lg" />
          </div>
          <p class="font-mono text-sm text-white/30 tracking-widest uppercase">
            {{ locale.app.subtitle }}
          </p>
        </div>

        <div class="w-full max-w-lg space-y-2 px-8">
          <div v-for="(line, i) in bootLines" :key="i" class="font-mono text-xs">
            <template v-if="i < currentBootLine">
              <span class="text-accent/50"><span class="text-accent/30 mr-2">[OK]</span>{{ line }}</span>
            </template>
            <template v-else-if="i === currentBootLine">
              <span class="text-accent">
                <span class="text-accent/50 mr-2">[..]</span>
                <GlitchText :text="line" :speed="20" @complete="onBootLineComplete" />
              </span>
            </template>
          </div>
        </div>

        <Transition name="fade">
          <div v-if="systemReady" class="animate-fade-in-up mt-4">
            <Button type="primary" size="large" @click="enterSetup">
              <template #icon><ExperimentOutlined /></template>
              {{ locale.boot.beginConfig }}
            </Button>
            <p class="text-center font-mono text-[10px] text-white/20 mt-3 tracking-widest">
              {{ locale.boot.ethicsApproval }}
            </p>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- ═══ CONFIGURATION SCREEN ═══ -->
    <Transition name="fade">
      <div v-if="bootPhase === 2" class="relative z-10 h-full flex flex-col">
        <!-- Top bar -->
        <header class="flex items-center justify-between px-6 py-3 border-b border-white/[0.06] bg-base/80 backdrop-blur-sm shrink-0">
          <Space>
            <Badge status="success" />
            <Typography.Text class="font-mono !text-xs !text-white/40 uppercase tracking-widest">
              {{ locale.setup.header }}
            </Typography.Text>
          </Space>
          <Space>
            <Typography.Text class="font-mono !text-[10px] !text-white/20">
              {{ locale.setup.subjectsReady.replace('{ready}', String(readyCount)).replace('{total}', String(agents.length)) }}
            </Typography.Text>
            <Button
              type="primary"
              :disabled="!canBegin"
              @click="beginExperiment"
            >
              <template #icon><ThunderboltOutlined /></template>
              {{ locale.setup.launchExperiment }}
            </Button>
          </Space>
        </header>

        <!-- Main config grid -->
        <div class="flex-1 overflow-y-auto p-6">
          <Row :gutter="[24, 24]" class="max-w-7xl mx-auto">
            <Col :span="16">
              <AgentConfigurator v-model:agents="agents" />
            </Col>
            <Col :span="8">
              <Space direction="vertical" :size="16" class="w-full">
                <ArcSelector v-model="selectedArc" />
                <MapThemePicker v-model="selectedTheme" />
                <ParameterControls
                  v-model:rounds="totalRounds"
                  v-model:resources="startingResources"
                />
              </Space>
            </Col>
          </Row>
        </div>
      </div>
    </Transition>
  </div>
</template>
