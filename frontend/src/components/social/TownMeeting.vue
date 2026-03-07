<script setup lang="ts">
import { computed } from 'vue'
import { Drawer, Tag, Typography, Button, Progress } from 'ant-design-vue'
import type { MeetingState } from '@/stores/social'
import { useAgentStore } from '@/stores/agent'
import { useLocale } from '@/locales'

const locale = useLocale()
const agentStore = useAgentStore()

const props = defineProps<{
  meeting: MeetingState | null
  visible: boolean
}>()

const emit = defineEmits<{
  dismiss: []
}>()

const voteCount = computed(() => {
  if (!props.meeting) return { support: 0, oppose: 0 }
  const votes = Object.values(props.meeting.votes)
  return {
    support: votes.filter(v => v === 'support').length,
    oppose: votes.filter(v => v === 'oppose').length,
  }
})

const votePct = computed(() => {
  const total = voteCount.value.support + voteCount.value.oppose
  if (total === 0) return 50
  return Math.round((voteCount.value.support / total) * 100)
})

function getAgentName(agentId: string): string {
  return agentStore.getAgent(agentId)?.name || agentId
}
</script>

<template>
  <Drawer
    :open="visible"
    :title="locale.social.meetingTitle"
    placement="bottom"
    :height="360"
    :closable="true"
    @close="emit('dismiss')"
  >
    <template v-if="meeting">
      <div class="max-w-2xl mx-auto space-y-4">
        <!-- Proposal -->
        <div class="text-center">
          <Typography.Text class="!text-white/40 font-mono !text-xs uppercase block mb-1">{{ locale.social.proposal }}</Typography.Text>
          <Typography.Title :level="4" class="!mt-0">
            "{{ meeting.proposal }}"
          </Typography.Title>
        </div>

        <!-- Vote tally -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <Tag color="green">{{ locale.social.support }} {{ voteCount.support }}</Tag>
            <Tag color="red">{{ locale.social.oppose }} {{ voteCount.oppose }}</Tag>
          </div>
          <Progress
            :percent="votePct"
            :show-info="false"
            :stroke-color="'#4ade80'"
            :trail-color="'#f87171'"
          />
        </div>

        <!-- Individual votes -->
        <div class="flex flex-wrap gap-2">
          <Tag
            v-for="(vote, agentId) in meeting.votes"
            :key="agentId"
            :color="vote === 'support' ? 'green' : 'red'"
          >
            {{ getAgentName(agentId as string) }}: {{ vote }}
          </Tag>
        </div>

        <!-- Result -->
        <div v-if="meeting.result" class="p-3 rounded border border-white/[0.08] bg-white/[0.02]">
          <Typography.Paragraph class="!mb-0 !text-white/70 italic">
            {{ meeting.result }}
          </Typography.Paragraph>
        </div>

        <div v-if="!meeting.active" class="text-center">
          <Button type="primary" @click="emit('dismiss')">{{ locale.social.continue }}</Button>
        </div>
      </div>
    </template>
  </Drawer>
</template>
