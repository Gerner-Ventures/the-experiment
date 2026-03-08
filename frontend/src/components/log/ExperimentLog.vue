<script setup lang="ts">
import { ref, computed } from 'vue'
import { Drawer, Tag, Select, Input, Typography, Empty } from 'ant-design-vue'
import { SearchOutlined } from '@ant-design/icons-vue'
import type { ExperimentEvent } from '@/stores/experiment'
import { useLocale } from '@/locales'

const locale = useLocale()

const props = defineProps<{
  events: ExperimentEvent[]
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const filterType = ref<string | undefined>(undefined)
const filterPhase = ref<string | undefined>(undefined)
const searchText = ref('')

const eventTypes = [
  'round_start', 'round_end', 'phase_change',
  'gm_plan', 'gm_narration',
  'agent_action', 'agent_speak',
  'crisis_event',
  'meeting_start', 'meeting_vote', 'meeting_result',
  'threat_update', 'resource_update',
  'experiment_end',
]

const phases = ['gm_plan', 'dawn', 'morning', 'midday', 'afternoon', 'night']

const filteredEvents = computed(() => {
  let result = [...props.events].reverse()
  if (filterType.value) {
    result = result.filter(e => e.type === filterType.value)
  }
  if (filterPhase.value) {
    result = result.filter(e => e.phase === filterPhase.value)
  }
  if (searchText.value) {
    const q = searchText.value.toLowerCase()
    result = result.filter(e => e.summary.toLowerCase().includes(q))
  }
  return result.slice(0, 200)
})

function typeColor(type: string): string {
  if (type.startsWith('agent_')) return 'blue'
  if (type.startsWith('gm_')) return 'purple'
  if (type.startsWith('meeting_')) return 'cyan'
  if (type === 'crisis_event') return 'red'
  if (type === 'threat_update') return 'orange'
  if (type === 'resource_update') return 'green'
  if (type.startsWith('round_')) return 'gold'
  return 'default'
}
</script>

<template>
  <Drawer
    :open="visible"
    :title="locale.log.title"
    placement="left"
    :width="400"
    :closable="true"
    @close="emit('close')"
  >
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
    <div v-if="filteredEvents.length > 0" class="space-y-1">
      <div
        v-for="event in filteredEvents"
        :key="event.id"
        class="p-2 rounded border border-white/[0.04] hover:border-white/[0.08] transition-colors"
      >
        <div class="flex items-center gap-2 mb-0.5">
          <Tag :color="typeColor(event.type)" class="!text-[10px]">{{ event.type }}</Tag>
          <Typography.Text class="!text-[10px] !text-white/30 font-mono">
            R{{ event.round }}
          </Typography.Text>
          <Typography.Text v-if="event.phase" class="!text-[10px] !text-white/20 font-mono">
            {{ event.phase }}
          </Typography.Text>
        </div>
        <Typography.Text class="!text-xs !text-white/60">
          {{ event.summary }}
        </Typography.Text>
      </div>
    </div>
    <Empty v-else :description="locale.log.empty" />
  </Drawer>
</template>
