<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import gsap from 'gsap'
import type { MeetingState, MeetingScenePhase } from '@/stores/social'
import type { TurnPhase } from '@/stores/turn'
import type { Turn } from '@/stores/turn'
import type { AudioStatus } from '@/stores/social'
import type { ConversationMessage } from '@/stores/social'
import { useAgentStore } from '@/stores/agent'
import { useSocialStore } from '@/stores/social'
import { SPOKEN_ACTIONS } from '@/config/action-categories'
import { getMeetingBackdrop } from '@/config/meeting-themes'
import MeetingAgentSeat from './MeetingAgentSeat.vue'
import MeetingProposal from './MeetingProposal.vue'
import MeetingVoteTally from './MeetingVoteTally.vue'
import ConversationBubble from './ConversationBubble.vue'

const SEAT_RADIUS_X = 280
const SEAT_RADIUS_Y = 120
const SEAT_CENTER_Y_PCT = 0.45

const agentStore = useAgentStore()
const socialStore = useSocialStore()

const props = defineProps<{
  meeting: MeetingState
  activeTurn: Turn | null
  turnPhase: TurnPhase
  hasPendingTurns: boolean
  activeBubbleAudio: ConversationMessage | null
  themeId: string
}>()

const themeBackdrop = computed(() => getMeetingBackdrop(props.themeId))

const backdropStyle = computed(() => ({
  background: themeBackdrop.value.gradients[props.meeting.scenePhase] ?? themeBackdrop.value.gradients.entering,
  transition: 'background 2s ease',
}))

const emit = defineEmits<{
  'bubble-dismiss': []
  'audio-end': []
  'scene-entered': []
  'scene-exited': []
  'exile-complete': [agentId: string]
}>()

const sceneRef = ref<HTMLElement | null>(null)
const backdropRef = ref<HTMLElement | null>(null)
const seatsContainerRef = ref<HTMLElement | null>(null)

const showBackdrop = ref(false)
const showSeats = ref(false)
const showProposal = ref(false)
const showTally = ref(false)
const exileStage = ref<Map<string, 'none' | 'flashing' | 'dead' | 'faded'>>(new Map())

// Track whether entrance animation has completed
const entranceComplete = ref(false)

// Agents participating in the meeting
const meetingAgents = computed(() => {
  return agentStore.agentList.filter(a => a.status !== 'exiled')
})

// Semicircle seat positions
const seatPositions = computed(() => {
  const count = meetingAgents.value.length
  if (count === 0) return []

  const positions: Array<{ x: number; y: number }> = []
  for (let i = 0; i < count; i++) {
    const angle = Math.PI * (i / (count - 1 || 1))
    positions.push({
      x: Math.cos(angle) * SEAT_RADIUS_X,
      y: -Math.sin(angle) * SEAT_RADIUS_Y,
    })
  }
  return positions
})

// Whether the active turn is spoken dialog or inner thought
const activeTurnIsSpoken = computed(() => {
  const action = props.activeTurn?.actionType
  return action ? SPOKEN_ACTIONS.has(action) : false
})

// Speaking agent ID — only for spoken actions (speech, vote)
const speakingAgentId = computed(() => {
  if (props.turnPhase === 'talking' && props.activeTurn && activeTurnIsSpoken.value) {
    return props.activeTurn.agentId
  }
  return null
})

// Thinking agent ID — for non-spoken actions (inner thoughts)
const thinkingAgentId = computed(() => {
  if (props.turnPhase === 'talking' && props.activeTurn && !activeTurnIsSpoken.value) {
    return props.activeTurn.agentId
  }
  return null
})

// Track which agent votes have been visually revealed via the turn queue.
// All votes arrive from the backend at once, but we only show each vote badge
// after the agent's meeting_vote turn has started processing.
const revealedVoteAgentIds = ref<Set<string>>(new Set())

const revealedVotes = computed(() => {
  const result: Record<string, string> = {}
  for (const agentId of revealedVoteAgentIds.value) {
    if (props.meeting.votes[agentId]) {
      result[agentId] = props.meeting.votes[agentId]
    }
  }
  return result
})

// Reveal vote badge when a meeting_vote turn starts processing
watch(
  () => props.activeTurn,
  (turn) => {
    if (turn?.actionType === 'meeting_vote') {
      revealedVoteAgentIds.value.add(turn.agentId)
    }
  },
)

// Get seat position for ConversationBubble anchoring
function getMeetingSeatPosition(agentId: string): { x: number; y: number } | null {
  const idx = meetingAgents.value.findIndex(a => a.id === agentId)
  if (idx < 0 || !seatPositions.value[idx]) {
    // Fallback: center of viewport (will show bubble centrally)
    return { x: window.innerWidth / 2, y: window.innerHeight * 0.4 }
  }

  const seat = seatPositions.value[idx]
  const container = seatsContainerRef.value
  if (!container) {
    // Container not mounted yet — use viewport center
    return { x: window.innerWidth / 2, y: window.innerHeight * 0.4 }
  }

  const rect = container.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2 + seat.x,
    y: rect.top + rect.height * SEAT_CENTER_Y_PCT + seat.y,
  }
}

// ─── Self-pacing phase logic ───
// The scene owns its own phase progression based on:
// 1. GSAP entrance completing → advance to 'proposal'
// 2. Active turn actionType → detect speech/vote transitions
// 3. Turn queue draining + result data present → advance to 'result'

function advancePhase(phase: MeetingScenePhase) {
  if (props.meeting.scenePhase !== phase) {
    socialStore.advanceMeetingPhase(phase)
    console.debug(`[MeetingScene] Phase → ${phase}`)
  }
}

// Watch active turn to detect phase transitions
watch(
  () => props.activeTurn?.actionType,
  (actionType, prevActionType) => {
    if (!actionType) return

    // First speech turn starts → advance to speeches (if entrance is done)
    if (actionType === 'meeting_speech' && props.meeting.scenePhase === 'proposal') {
      advancePhase('speeches')
    }

    // First vote turn starts → advance to voting
    if (actionType === 'meeting_vote' && props.meeting.scenePhase === 'speeches') {
      advancePhase('voting')
    }
  },
)

// Watch for turn queue draining to advance to result.
// IMPORTANT: Also check hasPendingTurns — activeTurn can be momentarily null
// during the 400ms gap between turns while speech/vote turns are still queued.
watch(
  () => props.activeTurn,
  (turn) => {
    if (turn === null && !props.hasPendingTurns && props.meeting.result) {
      // Turn queue fully drained and we have a result — show it
      const phase = props.meeting.scenePhase
      if (phase === 'voting' || phase === 'speeches' || phase === 'proposal') {
        advancePhase('result')
      }
    }
  },
)

// Also check: if result arrives while queue is already empty
watch(
  () => props.meeting.result,
  (result) => {
    if (result && !props.activeTurn && !props.hasPendingTurns) {
      const phase = props.meeting.scenePhase
      if (phase === 'voting' || phase === 'speeches' || phase === 'proposal') {
        advancePhase('result')
      }
    }
  },
)

// ─── GSAP Entrance Timeline ───

let entranceTl: gsap.core.Timeline | null = null
let exitTl: gsap.core.Timeline | null = null

function playEntrance() {
  showBackdrop.value = true

  nextTick(() => {
    entranceTl = gsap.timeline({
      onComplete() {
        entranceComplete.value = true
        emit('scene-entered')
        // Auto-advance to proposal phase after entrance
        advancePhase('proposal')
      },
    })

    // Backdrop fade in
    if (backdropRef.value) {
      entranceTl.fromTo(
        backdropRef.value,
        { opacity: 0 },
        { opacity: 1, duration: 0.3, ease: 'power2.out' },
      )
    }

    // Show seats with stagger
    entranceTl.call(() => { showSeats.value = true })
    entranceTl.addLabel('seats', '>')

    // Animate individual seat containers after they render
    entranceTl.call(() => {
      nextTick(() => {
        const seatEls = seatsContainerRef.value?.querySelectorAll('.meeting-seat')
        if (seatEls?.length) {
          gsap.fromTo(
            Array.from(seatEls),
            { opacity: 0, y: 30 },
            { opacity: 1, y: 0, duration: 0.3, stagger: 0.05, ease: 'back.out(1.5)' },
          )
        }
      })
    }, undefined, 'seats')

    // Show proposal after seats land
    entranceTl.call(() => { showProposal.value = true }, undefined, 'seats+=0.5')
  })
}

function playExit() {
  exitTl = gsap.timeline({
    onComplete() {
      emit('scene-exited')
    },
  })

  if (sceneRef.value) {
    exitTl.to(sceneRef.value, { opacity: 0, duration: 0.5, ease: 'power2.in' })
  }
}

// ─── Exile Animation ───

function playExileAnimation(agentId: string) {
  exileStage.value.set(agentId, 'flashing')

  setTimeout(() => {
    exileStage.value.set(agentId, 'dead')

    setTimeout(() => {
      exileStage.value.set(agentId, 'faded')

      setTimeout(() => {
        emit('exile-complete', agentId)
      }, 800)
    }, 500)
  }, 450)
}

// ─── Phase Watchers ───

watch(() => props.meeting.scenePhase, (phase) => {
  switch (phase) {
    case 'result':
      showTally.value = true
      break
    case 'exile':
      if (props.meeting.exileTarget) {
        playExileAnimation(props.meeting.exileTarget)
      }
      break
    case 'exiting':
      playExit()
      break
  }
})

function handleContinue() {
  if (props.meeting.exileTarget && !exileStage.value.has(props.meeting.exileTarget)) {
    emit('exile-complete', props.meeting.exileTarget)
  }
  emit('scene-exited')
}

onMounted(() => {
  playEntrance()
})

onUnmounted(() => {
  entranceTl?.kill()
  exitTl?.kill()
})
</script>

<template>
  <div
    ref="sceneRef"
    class="meeting-scene fixed inset-0 z-40"
    :class="themeBackdrop.sceneClass"
  >
    <!-- Backdrop — themed gradient -->
    <div
      ref="backdropRef"
      v-show="showBackdrop"
      class="absolute inset-0"
      :style="backdropStyle"
    />

    <!-- Theme scene elements (CSS-driven scenery) -->
    <div v-if="showBackdrop" class="meeting-scenery absolute inset-0 pointer-events-none" />

    <!-- Content layer — absolute positioning prevents layout shifts -->
    <div class="relative z-10 w-full h-full">
      <!-- Proposal banner — pinned to upper area -->
      <div class="absolute top-[8%] left-1/2 -translate-x-1/2 w-full max-w-lg px-4">
        <Transition name="fade-up">
          <MeetingProposal
            v-if="showProposal"
            :text="meeting.proposal"
          />
        </Transition>
      </div>

      <!-- Agent seats in semicircle — pinned to center -->
      <div
        v-if="showSeats"
        ref="seatsContainerRef"
        class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        :style="{ width: `${SEAT_RADIUS_X * 2 + 120}px`, height: `${SEAT_RADIUS_Y * 2 + 80}px` }"
      >
        <div
          v-for="(agent, idx) in meetingAgents"
          :key="agent.id"
          class="meeting-seat absolute"
          :style="{
            left: `calc(50% + ${seatPositions[idx]?.x ?? 0}px)`,
            top: `calc(${SEAT_CENTER_Y_PCT * 100}% + ${seatPositions[idx]?.y ?? 0}px)`,
            transform: 'translate(-50%, -50%)',
          }"
        >
          <MeetingAgentSeat
            :agent-id="agent.id"
            :agent-name="agent.name"
            :character-id="agent.characterId"
            :is-speaking="speakingAgentId === agent.id"
            :is-thinking="thinkingAgentId === agent.id"
            :show-vote="!!revealedVotes[agent.id]"
            :vote="revealedVotes[agent.id] ?? null"
            :is-exile-target="meeting.exileTarget === agent.id"
            :exile-phase="(exileStage.get(agent.id) ?? 'none') as 'none' | 'flashing' | 'dead' | 'faded'"
          />
        </div>
      </div>

      <!-- Vote tally + result — pinned to lower area -->
      <div class="absolute bottom-[8%] left-1/2 -translate-x-1/2 w-full max-w-md px-4">
        <Transition name="fade-up">
          <MeetingVoteTally
            v-if="showTally && (meeting.scenePhase === 'result' || meeting.scenePhase === 'exile')"
            :votes="meeting.votes"
            :result="meeting.result"
            :tally="meeting.tally"
            :passed="meeting.passed"
            @continue="handleContinue"
          />
        </Transition>
      </div>
    </div>

    <!-- Meeting conversation bubble (anchored to seats) -->
    <ConversationBubble
      v-if="turnPhase === 'talking' && activeTurn?.thought"
      :key="activeTurn.id"
      class="pointer-events-auto"
      :agent-name="activeTurn.agentName"
      :message="activeTurn.thought"
      :agent-id="activeTurn.agentId"
      :get-position="getMeetingSeatPosition"
      :audio-status="(activeBubbleAudio?.audioStatus ?? 'idle') as AudioStatus"
      :audio-url="activeBubbleAudio?.audioUrl ?? null"
      :variant="activeTurnIsSpoken ? 'speech' : 'thought'"
      @dismiss="emit('bubble-dismiss')"
      @audio-end="emit('audio-end')"
    />
  </div>
</template>

<style scoped>
.fade-up-enter-active {
  transition: opacity 0.4s ease-out, transform 0.4s ease-out;
}

.fade-up-leave-active {
  transition: opacity 0.2s ease-in, transform 0.2s ease-in;
}

.fade-up-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.fade-up-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ─── Beach theme (Lord of the Flies) ─── */
.meeting-theme--beach .meeting-scenery {
  /* Sun disc at horizon */
  background:
    radial-gradient(circle at 50% 92%, rgba(255,180,60,0.6) 0%, rgba(255,120,30,0.3) 4%, transparent 8%),
    /* Ocean horizon */
    linear-gradient(to bottom, transparent 85%, rgba(40,80,120,0.3) 88%, rgba(20,50,80,0.5) 100%);
}

.meeting-theme--beach .meeting-scenery::before {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 18%;
  /* Sandy ground with rock silhouettes */
  background:
    /* Rocks */
    radial-gradient(ellipse at 15% 60%, rgba(60,50,40,0.9) 0%, transparent 50%),
    radial-gradient(ellipse at 85% 50%, rgba(50,40,35,0.8) 0%, transparent 40%),
    radial-gradient(ellipse at 70% 70%, rgba(55,45,38,0.7) 0%, transparent 35%),
    /* Sand */
    linear-gradient(to bottom, transparent 0%, rgba(180,150,100,0.3) 30%, rgba(160,130,80,0.4) 100%);
}

/* ─── Matrix theme (The Construct) ─── */
.meeting-theme--matrix .meeting-scenery {
  background:
    /* Glowing grid lines */
    repeating-linear-gradient(90deg, transparent, transparent 59px, rgba(0,255,65,0.04) 60px),
    repeating-linear-gradient(0deg, transparent, transparent 59px, rgba(0,255,65,0.04) 60px);
}

.meeting-theme--matrix .meeting-scenery::before {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 25%;
  /* Code river flowing at base */
  background:
    linear-gradient(to bottom, transparent 0%, rgba(0,255,65,0.05) 40%, rgba(0,255,65,0.1) 100%);
  border-top: 1px solid rgba(0,255,65,0.15);
}

.meeting-theme--matrix .meeting-scenery::after {
  content: '';
  position: absolute;
  inset: 0;
  /* Scanline overlay */
  background: repeating-linear-gradient(
    to bottom,
    transparent,
    transparent 2px,
    rgba(0,0,0,0.1) 2px,
    rgba(0,0,0,0.1) 4px
  );
}

/* ─── Arena theme (Gladiator) ─── */
.meeting-theme--arena .meeting-scenery {
  /* Colosseum arch silhouettes */
  background:
    /* Upper arches */
    radial-gradient(ellipse at 10% 25%, rgba(120,90,50,0.15) 0%, transparent 15%),
    radial-gradient(ellipse at 30% 20%, rgba(120,90,50,0.12) 0%, transparent 12%),
    radial-gradient(ellipse at 50% 18%, rgba(120,90,50,0.15) 0%, transparent 12%),
    radial-gradient(ellipse at 70% 20%, rgba(120,90,50,0.12) 0%, transparent 12%),
    radial-gradient(ellipse at 90% 25%, rgba(120,90,50,0.15) 0%, transparent 15%);
}

.meeting-theme--arena .meeting-scenery::before {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 20%;
  /* Sandy arena floor with column bases */
  background:
    /* Column silhouettes */
    linear-gradient(to right,
      transparent 8%, rgba(100,70,40,0.5) 9%, rgba(100,70,40,0.5) 10%, transparent 11%,
      transparent 28%, rgba(100,70,40,0.4) 29%, rgba(100,70,40,0.4) 30%, transparent 31%,
      transparent 48%, rgba(100,70,40,0.4) 49%, rgba(100,70,40,0.4) 50%, transparent 51%,
      transparent 68%, rgba(100,70,40,0.4) 69%, rgba(100,70,40,0.4) 70%, transparent 71%,
      transparent 88%, rgba(100,70,40,0.5) 89%, rgba(100,70,40,0.5) 90%, transparent 91%
    ),
    /* Sandy floor */
    linear-gradient(to bottom, transparent 0%, rgba(160,120,60,0.2) 40%, rgba(140,100,50,0.3) 100%);
}

/* Torch flicker effects */
.meeting-theme--arena .meeting-scenery::after {
  content: '';
  position: absolute;
  top: 15%;
  left: 0;
  right: 0;
  height: 10%;
  background:
    radial-gradient(circle at 10% 50%, rgba(255,150,30,0.15) 0%, transparent 8%),
    radial-gradient(circle at 90% 50%, rgba(255,150,30,0.15) 0%, transparent 8%);
  animation: torch-flicker 3s ease-in-out infinite alternate;
}

@keyframes torch-flicker {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.7; }
}

/* ─── Sector 7G theme (1984) ─── */
.meeting-theme--sector .meeting-scenery {
  /* Industrial haze */
  background:
    radial-gradient(ellipse at 30% 80%, rgba(255,100,0,0.08) 0%, transparent 30%),
    radial-gradient(ellipse at 70% 85%, rgba(255,80,0,0.06) 0%, transparent 25%);
}

.meeting-theme--sector .meeting-scenery::before {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 22%;
  /* Waste field with barrel silhouettes */
  background:
    /* Burning barrels (glowing) */
    radial-gradient(circle at 25% 40%, rgba(255,100,0,0.25) 0%, rgba(255,60,0,0.1) 3%, transparent 6%),
    radial-gradient(circle at 75% 50%, rgba(255,100,0,0.2) 0%, rgba(255,60,0,0.08) 3%, transparent 6%),
    /* Barrel silhouettes */
    radial-gradient(ellipse at 25% 60%, rgba(40,30,20,0.8) 0%, transparent 4%),
    radial-gradient(ellipse at 75% 65%, rgba(40,30,20,0.7) 0%, transparent 4%),
    /* Ground */
    linear-gradient(to bottom, transparent 0%, rgba(30,20,10,0.3) 40%, rgba(25,18,10,0.5) 100%);
}

.meeting-theme--sector .meeting-scenery::after {
  content: '';
  position: absolute;
  inset: 0;
  /* Smog overlay */
  background:
    radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(255,100,0,0.04) 100%);
}
</style>
