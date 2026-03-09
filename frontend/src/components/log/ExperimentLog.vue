<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { Drawer, Tag, Select, Input, Typography, Empty, Segmented, Badge, Collapse, CollapsePanel } from 'ant-design-vue'
import { SearchOutlined, ClockCircleOutlined } from '@ant-design/icons-vue'
import type { ExperimentEvent } from '@/stores/experiment'
import { useTurnStore, type Turn, type TurnPhase } from '@/stores/turn'
import { useLocale } from '@/locales'

const locale = useLocale()
const turnStore = useTurnStore()

const props = defineProps<{
  events: ExperimentEvent[]
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const activeTab = ref<string>('all')
const filterType = ref<string | undefined>(undefined)
const filterPhase = ref<string | undefined>(undefined)
const filterCategory = ref<string | undefined>(undefined)
const searchText = ref('')
const expandedKeys = ref<string[]>([])
const scrollContainer = ref<HTMLElement>()
const autoScroll = ref(true)

// Auto-scroll to bottom when new events arrive
watch(() => props.events.length, () => {
  if (autoScroll.value && scrollContainer.value) {
    nextTick(() => {
      scrollContainer.value?.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }
})

// ─── Event type categories ───

const CATEGORY_MAP: Record<string, string> = {
  connected: 'system',
  round_start: 'round',
  round_end: 'round',
  phase_change: 'round',
  gm_plan: 'gm',
  gm_narration: 'gm',
  gm_audio_status: 'gm',
  agent_action: 'agent',
  agent_speak: 'agent',
  agent_speech_audio: 'agent',
  crisis_event: 'world',
  threat_update: 'world',
  resource_update: 'world',
  meeting_start: 'social',
  meeting_speech: 'social',
  meeting_vote: 'social',
  meeting_result: 'social',
  faction_update: 'social',
  cult_activity: 'social',
  exile_vote: 'social',
  exile_result: 'social',
  observer_event: 'system',
  experiment_end: 'round',
  step_error: 'system',
}

const categories = ['round', 'agent', 'gm', 'world', 'social', 'system'] as const

const eventTypes = [
  'connected',
  'round_start', 'round_end', 'phase_change',
  'gm_plan', 'gm_narration', 'gm_audio_status',
  'agent_action', 'agent_speak', 'agent_speech_audio',
  'crisis_event', 'threat_update', 'resource_update',
  'meeting_start', 'meeting_speech', 'meeting_vote', 'meeting_result',
  'faction_update', 'cult_activity',
  'exile_vote', 'exile_result',
  'experiment_end', 'step_error',
]

const phases = ['gm_plan', 'dawn', 'morning', 'midday', 'afternoon', 'night']

// ─── Filtered events ───

const filteredEvents = computed(() => {
  if (activeTab.value === 'turns') return []
  let result = [...props.events].reverse()
  if (activeTab.value === 'system') {
    result = result.filter(e =>
      CATEGORY_MAP[e.type] === 'system' || CATEGORY_MAP[e.type] === 'round')
  }
  if (filterType.value) {
    result = result.filter(e => e.type === filterType.value)
  }
  if (filterPhase.value) {
    result = result.filter(e => e.phase === filterPhase.value)
  }
  if (filterCategory.value) {
    result = result.filter(e => CATEGORY_MAP[e.type] === filterCategory.value)
  }
  if (searchText.value) {
    const q = searchText.value.toLowerCase()
    result = result.filter(e =>
      e.summary.toLowerCase().includes(q)
      || e.type.toLowerCase().includes(q)
      || formatEventHeadline(e).toLowerCase().includes(q)
      || JSON.stringify(e.data).toLowerCase().includes(q))
  }
  return result.slice(0, 200)
})

// ─── Turn queue stats ───

const queueLength = computed(() => turnStore.queue.length)
const activeTurn = computed(() => turnStore.activeTurn)
const turnPhase = computed(() => turnStore.phase)

// ─── Time formatting ───

function formatReceivedTime(receivedAt: number): string {
  const d = new Date(receivedAt)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function formatTimeDelta(event: ExperimentEvent, index: number, list: ExperimentEvent[]): string | null {
  const nextIdx = index + 1
  if (nextIdx >= list.length) return null
  const next = list[nextIdx]
  const delta = event.receivedAt - next.receivedAt
  if (delta < 1000) return `+${delta}ms`
  if (delta < 60000) return `+${(delta / 1000).toFixed(1)}s`
  return `+${(delta / 60000).toFixed(1)}m`
}

// ─── Event formatting ───

function typeColor(type: string): string {
  const cat = CATEGORY_MAP[type]
  switch (cat) {
    case 'agent': return 'blue'
    case 'gm': return 'purple'
    case 'social': return 'cyan'
    case 'world': return type === 'crisis_event' ? 'red' : type === 'threat_update' ? 'orange' : 'green'
    case 'round': return 'gold'
    case 'system': return 'default'
    default: return 'default'
  }
}

function categoryColor(cat: string): string {
  switch (cat) {
    case 'round': return 'gold'
    case 'agent': return 'blue'
    case 'gm': return 'purple'
    case 'world': return 'green'
    case 'social': return 'cyan'
    case 'system': return 'default'
    default: return 'default'
  }
}

function turnPhaseColor(phase: TurnPhase): string {
  switch (phase) {
    case 'moving': return '#3b82f6'
    case 'acting': return '#f59e0b'
    case 'talking': return '#8b5cf6'
    case 'hud-only': return '#6b7280'
    case 'idle': return '#374151'
    default: return '#374151'
  }
}

function turnPhaseLabel(phase: TurnPhase): string {
  switch (phase) {
    case 'moving': return locale.log.turnPhaseMoving
    case 'acting': return locale.log.turnPhaseActing
    case 'talking': return locale.log.turnPhaseTalking
    case 'hud-only': return locale.log.turnPhaseHud
    case 'idle': return locale.log.turnQueueEmpty
    default: return phase
  }
}

function formatEventHeadline(event: ExperimentEvent): string {
  const d = event.data
  switch (event.type) {
    case 'agent_action': {
      const action = typeof d.action === 'string' ? d.action : (d.action as Record<string, unknown>)?.type ?? ''
      const loc = typeof d.action === 'object' ? (d.action as Record<string, unknown>)?.location ?? '' : ''
      const name = (d.agent_name as string) ?? (d.agent_id as string) ?? ''
      const target = typeof d.action === 'object' ? (d.action as Record<string, unknown>)?.target ?? '' : ''
      let s = `${name} → ${action}`
      if (target) s += ` (${target})`
      if (loc) s += ` @ ${loc}`
      return s
    }
    case 'agent_speak': {
      const name = (d.agent_name as string) ?? ''
      const text = (d.message as string) ?? (d.text as string) ?? (d.dialogue as string) ?? ''
      const target = (d.target as string) ?? ''
      return `${name} → ${target}: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`
    }
    case 'agent_speech_audio': {
      const status = (d.status as string) ?? '?'
      return `Audio ${status} for ${(d.agent_id as string) ?? '?'} [${d.index ?? '?'}]`
    }
    case 'phase_change':
      return `Phase → ${event.phase ?? (d.phase as string) ?? '?'}${d.status ? ` (${d.status})` : ''}`
    case 'round_start':
      return `Round ${event.round} started`
    case 'round_end': {
      const threat = d.threat_level as number | undefined
      const agentCount = (d.agents as unknown[])?.length
      return `Round ${event.round} ended — threat: ${threat ?? '?'}, agents: ${agentCount ?? '?'}`
    }
    case 'gm_plan': {
      const plan = (d.plan as Record<string, unknown>) ?? d
      const theme = (plan.round_theme as string) ?? (plan.roundTheme as string) ?? ''
      return `GM plan R${event.round}${theme ? `: ${theme}` : ''}`
    }
    case 'gm_narration': {
      const text = (d.text as string) ?? (d.narration as string) ?? ''
      return text.slice(0, 80) + (text.length > 80 ? '...' : '')
    }
    case 'gm_audio_status':
      return `Narration audio: ${(d.status as string) ?? '?'}`
    case 'crisis_event': {
      const severity = (d.severity as string) ?? ''
      return `Crisis [${severity}]: ${(d.description as string) ?? (d.type as string) ?? '?'}`
    }
    case 'threat_update':
      return `Threat → ${d.threat_level ?? '?'}`
    case 'resource_update': {
      const res = (d.resources as Record<string, number>) ?? d
      const entries = Object.entries(res).filter(([k]) => !['summary', 'text'].includes(k))
      return entries.map(([k, v]) => `${k}: ${v}`).join(', ') || event.summary
    }
    case 'meeting_start':
      return `Meeting: "${(d.proposal as string) ?? '?'}"`
    case 'meeting_speech': {
      const text = (d.text as string) ?? ''
      return `${(d.agent_id as string) ?? '?'}: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`
    }
    case 'meeting_vote':
      return `${(d.agent_id as string) ?? '?'} voted: ${(d.vote as string) ?? '?'}`
    case 'meeting_result': {
      const summary = (d.summary as string) ?? (d.outcome as string) ?? (d.result as string) ?? '?'
      return `Result: ${summary.slice(0, 80)}${summary.length > 80 ? '...' : ''}`
    }
    case 'faction_update':
      return `Faction: ${(d.faction as string) ?? (d.name as string) ?? JSON.stringify(d).slice(0, 60)}`
    case 'cult_activity':
      return `Cult: ${(d.description as string) ?? JSON.stringify(d).slice(0, 60)}`
    case 'exile_vote':
      return `Exile vote: ${(d.voter as string) ?? '?'} → ${(d.target as string) ?? '?'}`
    case 'exile_result':
      return `Exile: ${(d.result as string) ?? (d.outcome as string) ?? '?'}`
    case 'experiment_end':
      return `Experiment ${(d.status as string) ?? 'ended'}`
    case 'step_error':
      return `Step error: ${(d.error as string) ?? (d.message as string) ?? 'unknown'}`
    case 'connected':
      return 'WebSocket connected'
    default:
      return event.summary || event.type
  }
}

/** Format a data value for display — handles nested objects, arrays, long strings */
function formatDataValue(value: unknown, depth: number = 0): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') {
    if (value.length > 200 && depth > 0) return `"${value.slice(0, 200)}..."`
    return `"${value}"`
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (depth > 1) return `[${value.length} items]`
    return JSON.stringify(value, null, 2)
  }
  if (typeof value === 'object') {
    if (depth > 1) return `{${Object.keys(value as Record<string, unknown>).length} keys}`
    return JSON.stringify(value, null, 2)
  }
  return String(value)
}

/** Get the important fields from event data to show inline */
function getDataFields(event: ExperimentEvent): Array<{ key: string; value: unknown; important: boolean }> {
  const d = event.data
  const fields: Array<{ key: string; value: unknown; important: boolean }> = []

  // Certain keys are always important
  const importantKeys = new Set([
    'agent_id', 'agent_name', 'action', 'inner_thought', 'dialogue',
    'cooperation_intent', 'target', 'message', 'text',
    'proposal', 'vote', 'summary', 'result', 'outcome',
    'status', 'threat_level', 'severity', 'description',
    'plan', 'narration', 'audio_url', 'error',
    'resources', 'agents',
  ])

  for (const [key, value] of Object.entries(d)) {
    if (value === undefined || value === null || value === '') continue
    fields.push({
      key,
      value,
      important: importantKeys.has(key),
    })
  }
  return fields
}

function formatTurnSummary(turn: Turn): string {
  let s = `${turn.agentName} → ${turn.actionType}`
  if (turn.targetLocation) s += ` @ ${turn.targetLocation}`
  if (turn.thought) s += ' [has dialogue]'
  return s
}

/** Extract agent name from any event, if applicable */
function getEventAgentName(event: ExperimentEvent): string | null {
  const d = event.data
  return (d.agent_name as string) ?? (d.agent_id as string) ?? null
}

/** Get a short human-readable action label for the collapse header */
function getEventActionLabel(event: ExperimentEvent): string {
  const d = event.data
  switch (event.type) {
    case 'agent_action': {
      const action = typeof d.action === 'string' ? d.action : (d.action as Record<string, unknown>)?.type ?? 'action'
      return String(action)
    }
    case 'agent_speak':
      return 'speak'
    case 'agent_speech_audio':
      return `audio ${(d.status as string) ?? ''}`
    case 'phase_change':
      return `phase → ${event.phase ?? (d.phase as string) ?? '?'}`
    case 'round_start':
      return `round ${event.round} start`
    case 'round_end':
      return `round ${event.round} end`
    case 'gm_plan':
      return 'gm plan'
    case 'gm_narration':
      return 'narration'
    case 'gm_audio_status':
      return `narration audio`
    case 'crisis_event':
      return `crisis [${(d.severity as string) ?? '?'}]`
    case 'threat_update':
      return `threat → ${d.threat_level ?? '?'}`
    case 'resource_update':
      return 'resource update'
    case 'meeting_start':
      return 'meeting start'
    case 'meeting_speech':
      return 'meeting speech'
    case 'meeting_vote':
      return `vote: ${(d.vote as string) ?? '?'}`
    case 'meeting_result':
      return 'meeting result'
    case 'faction_update':
      return 'faction update'
    case 'cult_activity':
      return 'cult activity'
    case 'exile_vote':
      return `exile vote → ${(d.target as string) ?? '?'}`
    case 'exile_result':
      return 'exile result'
    case 'experiment_end':
      return 'experiment end'
    case 'step_error':
      return 'error'
    case 'connected':
      return 'connected'
    default:
      return event.type
  }
}
</script>

<template>
  <Drawer
    :open="visible"
    :title="locale.log.title"
    placement="left"
    :width="480"
    :closable="true"
    @close="emit('close')"
  >
    <!-- Tab selector -->
    <Segmented
      v-model:value="activeTab"
      :options="[
        { label: locale.log.tabAll, value: 'all' },
        { label: locale.log.tabTurns, value: 'turns' },
        { label: locale.log.tabSystem, value: 'system' },
      ]"
      block
      class="mb-3"
    />

    <!-- ─── Turn Queue Panel (Turns tab) ─── -->
    <template v-if="activeTab === 'turns'">
      <!-- Active turn status -->
      <div class="mb-3 p-3 rounded-lg border border-white/[0.06] bg-white/[0.02]">
        <div class="flex items-center justify-between mb-2">
          <Typography.Text class="!text-xs !text-white/40 font-mono uppercase tracking-wider">
            {{ locale.log.turnQueueLabel }}
          </Typography.Text>
          <Badge
            :count="queueLength"
            :number-style="{ backgroundColor: queueLength > 0 ? '#3b82f6' : '#374151' }"
          />
        </div>

        <div v-if="activeTurn" class="space-y-2">
          <!-- Active turn -->
          <div class="p-2 rounded border border-white/[0.08] bg-white/[0.03]">
            <div class="flex items-center gap-2 mb-1">
              <div
                class="w-2 h-2 rounded-full animate-pulse"
                :style="{ backgroundColor: turnPhaseColor(turnPhase) }"
              />
              <Typography.Text class="!text-xs font-semibold !text-white/70">
                {{ locale.log.turnActive }}
              </Typography.Text>
              <Tag :color="turnPhaseColor(turnPhase)" class="!text-[10px] !ml-auto">
                {{ turnPhaseLabel(turnPhase) }}
              </Tag>
            </div>
            <Typography.Text class="!text-xs !text-white/50 block">
              {{ formatTurnSummary(activeTurn) }}
            </Typography.Text>
            <Typography.Text v-if="activeTurn.thought" class="!text-[10px] !text-white/30 block mt-1 italic">
              "{{ activeTurn.thought.slice(0, 100) }}{{ activeTurn.thought.length > 100 ? '...' : '' }}"
            </Typography.Text>
          </div>

          <!-- Queued turns -->
          <div v-if="turnStore.queue.length > 0" class="space-y-1">
            <Typography.Text class="!text-[10px] !text-white/30 font-mono uppercase tracking-wider">
              {{ locale.log.turnQueued }} ({{ turnStore.queue.length }})
            </Typography.Text>
            <div
              v-for="turn in turnStore.queue.slice(0, 20)"
              :key="turn.id"
              class="py-1 px-2 rounded border border-white/[0.04] text-xs"
            >
              <div class="flex items-center gap-2">
                <Typography.Text class="!text-[10px] !text-white/20 font-mono">#{{ turn.id }}</Typography.Text>
                <Typography.Text class="!text-xs !text-white/50">
                  {{ formatTurnSummary(turn) }}
                </Typography.Text>
              </div>
            </div>
            <Typography.Text
              v-if="turnStore.queue.length > 20"
              class="!text-[10px] !text-white/20 font-mono"
            >
              +{{ turnStore.queue.length - 20 }} more
            </Typography.Text>
          </div>
        </div>

        <div v-else class="py-2">
          <Typography.Text class="!text-xs !text-white/30 italic">
            {{ locale.log.turnQueueEmpty }}
          </Typography.Text>
        </div>
      </div>

      <!-- Recent agent actions from events -->
      <Typography.Text class="!text-[10px] !text-white/30 font-mono uppercase tracking-wider block mb-2">
        {{ locale.log.turnCompleted }}
      </Typography.Text>
      <div class="space-y-1">
        <div
          v-for="event in events.filter(e => e.type === 'agent_action').slice(-30).reverse()"
          :key="event.id"
          class="p-2 rounded border border-white/[0.04] hover:border-white/[0.08] transition-colors"
        >
          <div class="flex items-center gap-2 mb-0.5">
            <Tag color="blue" class="!text-[10px]">action</Tag>
            <Typography.Text class="!text-[10px] !text-white/30 font-mono">
              R{{ event.round }}
            </Typography.Text>
            <Typography.Text v-if="event.phase" class="!text-[10px] !text-white/20 font-mono">
              {{ event.phase }}
            </Typography.Text>
            <Typography.Text class="!text-[10px] !text-white/15 font-mono ml-auto">
              {{ formatReceivedTime(event.receivedAt) }}
            </Typography.Text>
          </div>
          <Typography.Text class="!text-xs !text-white/60">
            {{ formatEventHeadline(event) }}
          </Typography.Text>
        </div>
        <Empty v-if="events.filter(e => e.type === 'agent_action').length === 0" :description="locale.log.empty" />
      </div>
    </template>

    <!-- ─── All / System Events ─── -->
    <template v-else>
      <!-- Filters -->
      <div class="space-y-2 mb-4">
        <Input
          v-model:value="searchText"
          :placeholder="locale.log.search"
          size="small"
          allow-clear
        >
          <template #prefix><SearchOutlined /></template>
        </Input>
        <div class="flex gap-2">
          <Select
            v-model:value="filterType"
            :placeholder="locale.log.filterType"
            allow-clear
            size="small"
            class="flex-1"
          >
            <Select.Option v-for="t in eventTypes" :key="t" :value="t">{{ t }}</Select.Option>
          </Select>
          <Select
            v-if="activeTab === 'all'"
            v-model:value="filterCategory"
            :placeholder="locale.log.filterCategory"
            allow-clear
            size="small"
            class="flex-1"
          >
            <Select.Option v-for="c in categories" :key="c" :value="c">
              <Tag :color="categoryColor(c)" class="!text-[10px]">{{ c }}</Tag>
            </Select.Option>
          </Select>
          <Select
            v-model:value="filterPhase"
            :placeholder="locale.log.filterPhase"
            allow-clear
            size="small"
            class="flex-1"
          >
            <Select.Option v-for="p in phases" :key="p" :value="p">{{ p }}</Select.Option>
          </Select>
        </div>
      </div>

      <!-- Event list -->
      <div v-if="filteredEvents.length > 0" ref="scrollContainer" class="space-y-1">
        <Collapse v-model:activeKey="expandedKeys" ghost class="event-log-collapse">
          <CollapsePanel
            v-for="(event, idx) in filteredEvents"
            :key="String(event.id)"
            class="!border-white/[0.04] !rounded !mb-1"
          >
            <template #header>
              <div class="event-header-content">
                <!-- Row 1: agent name (if any) + action label + timestamp -->
                <div class="flex items-center gap-1.5 mb-0.5">
                  <Typography.Text
                    v-if="getEventAgentName(event)"
                    class="!text-xs !text-white/70 font-semibold truncate max-w-[120px]"
                  >
                    {{ getEventAgentName(event) }}
                  </Typography.Text>
                  <Tag :color="typeColor(event.type)" class="!text-[10px] !px-1 !py-0 !leading-tight !m-0">
                    {{ getEventActionLabel(event) }}
                  </Tag>
                  <Typography.Text class="!text-[10px] !text-white/25 font-mono">
                    R{{ event.round }}
                  </Typography.Text>
                  <Typography.Text v-if="event.phase" class="!text-[10px] !text-white/20 font-mono">
                    {{ event.phase }}
                  </Typography.Text>
                  <span class="flex-1" />
                  <Typography.Text class="!text-[10px] !text-white/30 font-mono flex items-center gap-1">
                    <ClockCircleOutlined class="!text-[8px]" />
                    {{ formatReceivedTime(event.receivedAt) }}
                  </Typography.Text>
                  <Typography.Text
                    v-if="formatTimeDelta(event, idx, filteredEvents)"
                    class="!text-[10px] !text-white/10 font-mono"
                  >
                    {{ formatTimeDelta(event, idx, filteredEvents) }}
                  </Typography.Text>
                </div>
                <!-- Row 2: detail headline -->
                <Typography.Text class="!text-[11px] !text-white/45 block">
                  {{ formatEventHeadline(event) }}
                </Typography.Text>
              </div>
            </template>

            <!-- Expanded: full data fields -->
            <div class="space-y-1.5 -mt-1">
              <!-- Server timestamp -->
              <div class="flex gap-2">
                <Typography.Text class="!text-[10px] !text-white/25 font-mono w-28 shrink-0 text-right">
                  server_time
                </Typography.Text>
                <Typography.Text class="!text-[10px] !text-white/50 font-mono">
                  {{ event.timestamp }}
                </Typography.Text>
              </div>

              <!-- All data fields -->
              <template v-for="field in getDataFields(event)" :key="field.key">
                <div class="flex gap-2">
                  <Typography.Text
                    class="!text-[10px] font-mono w-28 shrink-0 text-right"
                    :class="field.important ? '!text-white/40' : '!text-white/20'"
                  >
                    {{ field.key }}
                  </Typography.Text>
                  <div class="flex-1 min-w-0">
                    <!-- Short scalar values inline -->
                    <Typography.Text
                      v-if="typeof field.value === 'string' && field.value.length <= 200"
                      class="!text-[10px] !text-white/50 font-mono break-all"
                    >
                      {{ field.value }}
                    </Typography.Text>
                    <Typography.Text
                      v-else-if="typeof field.value === 'number' || typeof field.value === 'boolean'"
                      class="!text-[10px] !text-amber-400/70 font-mono"
                    >
                      {{ field.value }}
                    </Typography.Text>
                    <!-- Long strings wrapped -->
                    <Typography.Text
                      v-else-if="typeof field.value === 'string'"
                      class="!text-[10px] !text-white/50 font-mono break-all"
                    >
                      {{ field.value }}
                    </Typography.Text>
                    <!-- Objects/arrays as formatted JSON -->
                    <pre
                      v-else
                      class="!text-[10px] !text-white/40 font-mono bg-white/[0.02] rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all m-0 max-h-48 overflow-y-auto"
                    >{{ formatDataValue(field.value) }}</pre>
                  </div>
                </div>
              </template>
            </div>
          </CollapsePanel>
        </Collapse>
      </div>
      <Empty v-else :description="locale.log.empty" />
    </template>
  </Drawer>
</template>

<style scoped>
/* Override Ant collapse panel styling for dark theme */
:deep(.event-log-collapse .ant-collapse-header) {
  padding: 6px 8px !important;
  align-items: flex-start !important;
}
:deep(.event-log-collapse .ant-collapse-content-box) {
  padding: 4px 8px 8px !important;
}
:deep(.event-log-collapse .ant-collapse-item) {
  border-color: rgba(255, 255, 255, 0.04) !important;
}
:deep(.event-log-collapse .ant-collapse-expand-icon) {
  padding-top: 4px !important;
}
:deep(.event-log-collapse .ant-collapse-header-text) {
  flex: 1;
  min-width: 0;
}
.event-header-content {
  width: 100%;
  min-width: 0;
}
</style>
