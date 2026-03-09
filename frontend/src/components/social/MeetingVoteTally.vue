<script setup lang="ts">
import { computed } from 'vue'
import { Tag, Progress, Button } from 'ant-design-vue'
import { useLocale } from '@/locales'

const locale = useLocale()

const props = defineProps<{
  votes: Record<string, string>
  result: string | null
  tally: Record<string, number> | null
  passed: boolean | null
}>()

const emit = defineEmits<{
  continue: []
}>()

const voteCount = computed(() => {
  // Prefer backend tally if available
  if (props.tally) {
    return {
      support: props.tally.support ?? 0,
      oppose: props.tally.oppose ?? 0,
    }
  }
  // Fall back to counting votes
  const votes = Object.values(props.votes)
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

const passedLabel = computed(() => {
  if (props.passed === true) return locale.social.meetingScene.votePassed
  if (props.passed === false) return locale.social.meetingScene.voteFailed
  return null
})
</script>

<template>
  <div class="meeting-vote-tally max-w-md mx-auto space-y-4">
    <!-- Passed/failed banner -->
    <div v-if="passedLabel" class="text-center">
      <span
        class="inline-block font-mono text-sm font-bold uppercase tracking-wider px-4 py-1.5 rounded-full"
        :class="passed ? 'bg-green-500/20 text-green-300 ring-1 ring-green-500/30' : 'bg-red-500/20 text-red-300 ring-1 ring-red-500/30'"
      >
        {{ passedLabel }}
      </span>
    </div>

    <!-- Vote tally bar -->
    <div>
      <div class="flex items-center justify-between mb-1">
        <Tag color="green" class="!text-xs">{{ locale.social.support }} {{ voteCount.support }}</Tag>
        <Tag color="red" class="!text-xs">{{ locale.social.oppose }} {{ voteCount.oppose }}</Tag>
      </div>
      <Progress
        :percent="votePct"
        :show-info="false"
        :stroke-color="'#4ade80'"
        :trail-color="'#f87171'"
      />
    </div>

    <!-- Result text -->
    <div v-if="result" class="p-3 rounded border border-white/[0.08] bg-white/[0.02]">
      <p class="text-sm text-white/70 italic font-mono mb-0">{{ result }}</p>
    </div>

    <!-- Prominent continue button -->
    <div v-if="result" class="text-center pt-3">
      <Button
        type="primary"
        size="large"
        class="meeting-continue-btn !font-bold !text-base !px-8 !py-2 !h-auto"
        @click="emit('continue')"
      >
        {{ locale.social.meetingScene.returnToIsland }}
      </Button>
      <p class="text-xs text-white/40 mt-2 font-mono">
        {{ locale.social.meetingScene.clickToContinue }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.meeting-continue-btn {
  animation: continue-pulse 2s ease-in-out infinite;
  box-shadow: 0 0 20px rgba(var(--color-accent-rgb, 200 180 140), 0.3);
}

@keyframes continue-pulse {
  0%, 100% {
    box-shadow: 0 0 20px rgba(var(--color-accent-rgb, 200 180 140), 0.3);
  }
  50% {
    box-shadow: 0 0 30px rgba(var(--color-accent-rgb, 200 180 140), 0.5),
                0 0 60px rgba(var(--color-accent-rgb, 200 180 140), 0.2);
  }
}
</style>
