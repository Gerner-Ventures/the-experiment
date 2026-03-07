<script setup lang="ts">
import { computed, watch } from 'vue'
import { Drawer, Tag, Progress, Typography, Descriptions, Collapse, Empty } from 'ant-design-vue'
import { useAgentStore } from '@/stores/agent'
import { useExperimentStore } from '@/stores/experiment'
import { useLocale } from '@/locales'
import { api } from '@/services/api'

const locale = useLocale()

const props = defineProps<{
  agentId: string | null
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const agentStore = useAgentStore()
const experimentStore = useExperimentStore()

const agent = computed(() => {
  if (!props.agentId) return null
  return agentStore.getAgent(props.agentId)
})

// Fetch latest dossier from backend when panel opens
watch(() => [props.visible, props.agentId] as const, async ([visible, agentId]) => {
  if (!visible || !agentId || !experimentStore.id) return
  try {
    const dossier = await api.getAgentDossier(experimentStore.id, agentId)
    agentStore.updateAgentFromDossier(agentId, dossier)
  } catch {
    // Fall back to local store data
  }
})

const suspicionColor = computed(() => {
  if (!agent.value) return '#00e5a0'
  const s = agent.value.suspicionLevel
  if (s < 25) return '#00e5a0'
  if (s < 50) return '#f5c542'
  if (s < 75) return '#ff6b35'
  return '#ff2d55'
})

const relationshipList = computed(() => {
  if (!agent.value) return []
  return Object.entries(agent.value.relationships).map(([id, rel]) => {
    const other = agentStore.getAgent(id)
    return {
      agentId: id,
      name: other?.name || id,
      trust: rel.trust,
      history: rel.history,
      notes: rel.notes,
    }
  })
})

function statusColor(status: string): string {
  switch (status) {
    case 'idle': return 'default'
    case 'thinking': return 'processing'
    case 'talking': return 'blue'
    case 'moving': return 'cyan'
    case 'working': return 'green'
    case 'sneaking': return 'orange'
    case 'exiled': return 'red'
    default: return 'default'
  }
}
</script>

<template>
  <Drawer
    :open="visible"
    :title="agent?.name || locale.dossier.title"
    placement="right"
    :width="380"
    :closable="true"
    @close="emit('close')"
  >
    <template v-if="agent">
      <div class="space-y-4">
        <!-- Status + Location -->
        <div class="flex items-center gap-2">
          <Tag :color="statusColor(agent.status)">{{ agent.status.toUpperCase() }}</Tag>
          <Typography.Text class="!text-white/40 !text-xs font-mono">
            @ {{ agent.location }}
          </Typography.Text>
        </div>

        <!-- Suspicion Meter -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <Typography.Text class="!text-white/40 font-mono !text-xs uppercase">{{ locale.dossier.suspicion }}</Typography.Text>
            <Typography.Text class="font-mono !text-xs" :style="{ color: suspicionColor }">
              {{ Math.round(agent.suspicionLevel) }}%
            </Typography.Text>
          </div>
          <Progress
            :percent="agent.suspicionLevel"
            :show-info="false"
            :stroke-color="suspicionColor"
            size="small"
          />
        </div>

        <!-- Personality -->
        <div>
          <Typography.Text class="!text-white/40 font-mono !text-xs uppercase block mb-1">{{ locale.dossier.personality }}</Typography.Text>
          <div class="flex flex-wrap gap-1">
            <Tag v-for="trait in agent.personality.traitTags" :key="trait" color="purple">
              {{ trait }}
            </Tag>
          </div>
          <Descriptions :column="2" size="small" class="mt-2">
            <Descriptions.Item v-for="(val, key) in agent.personality.axes" :key="key" :label="String(key)">
              {{ val }}
            </Descriptions.Item>
          </Descriptions>
        </div>

        <!-- Secret Goal -->
        <div>
          <Typography.Text class="!text-white/40 font-mono !text-xs uppercase block mb-1">{{ locale.dossier.goal }}</Typography.Text>
          <div class="p-2 rounded border border-white/[0.08] bg-white/[0.02]">
            <Tag color="volcano" class="mb-1">{{ agent.secretGoal.archetype }}</Tag>
            <Typography.Paragraph class="!mb-0 !text-sm !text-white/70">
              {{ agent.secretGoal.text }}
            </Typography.Paragraph>
          </div>
        </div>

        <!-- Inventory -->
        <div v-if="agent.inventory.length > 0">
          <Typography.Text class="!text-white/40 font-mono !text-xs uppercase block mb-1">{{ locale.dossier.inventory }}</Typography.Text>
          <div class="flex flex-wrap gap-1">
            <Tag v-for="item in agent.inventory" :key="item">{{ item }}</Tag>
          </div>
        </div>

        <!-- Relationships -->
        <Collapse v-if="relationshipList.length > 0" ghost>
          <Collapse.Panel key="relationships" :header="locale.dossier.relationships">
            <div v-for="rel in relationshipList" :key="rel.agentId" class="mb-2 p-2 rounded bg-white/[0.02]">
              <div class="flex items-center justify-between">
                <Typography.Text class="!text-sm">{{ rel.name }}</Typography.Text>
                <Tag :color="rel.trust > 0 ? 'green' : rel.trust < 0 ? 'red' : 'default'">
                  {{ locale.dossier.trust }}: {{ rel.trust }}
                </Tag>
              </div>
              <Typography.Text v-if="rel.notes" class="!text-xs !text-white/40 block mt-1">
                {{ rel.notes }}
              </Typography.Text>
            </div>
          </Collapse.Panel>
        </Collapse>
      </div>
    </template>

    <Empty v-else :description="locale.dossier.selectAgent" />
  </Drawer>
</template>
