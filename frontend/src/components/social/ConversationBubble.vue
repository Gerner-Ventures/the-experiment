<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps<{
  agentName: string
  message: string
  agentId: string
  getPosition: (agentId: string) => { x: number; y: number } | null
}>()

const emit = defineEmits<{
  dismiss: [agentId: string]
}>()

const visible = ref(false)
const revealedChars = ref(0)
const posX = ref(0)
const posY = ref(0)
const hasPosition = ref(false)
const scrollContainer = ref<HTMLElement | null>(null)
let dismissTimer: ReturnType<typeof setTimeout> | null = null
let typewriterTimer: ReturnType<typeof setInterval> | null = null
let positionTimer: ReturnType<typeof setInterval> | null = null

const TYPEWRITER_MS = 35
const HOLD_AFTER_TYPING_MS = 2000
const MIN_LIFETIME_MS = 4000
const TOTAL_LIFETIME_MS = Math.max(MIN_LIFETIME_MS, props.message.length * TYPEWRITER_MS + HOLD_AFTER_TYPING_MS)

const displayedMessage = computed(() => props.message.slice(0, revealedChars.value))
const isFullyRevealed = computed(() => revealedChars.value >= props.message.length)

function updatePosition() {
  const pos = props.getPosition(props.agentId)
  if (pos) {
    posX.value = pos.x
    posY.value = pos.y
    if (!hasPosition.value) {
      console.debug(`[Bubble] Got position for ${props.agentName}: (${pos.x}, ${pos.y})`)
    }
    hasPosition.value = true
  } else if (!hasPosition.value) {
    // Fallback: show in bottom-right if sprite position unavailable
    posX.value = window.innerWidth - 160
    posY.value = window.innerHeight - 100
    hasPosition.value = true
    console.debug(`[Bubble] No sprite position for ${props.agentName} (${props.agentId}), using fallback`)
  }
}

function autoScroll() {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
  }
}

onMounted(() => {
  console.debug(`[Bubble] Mounted for ${props.agentName} (${props.agentId})`)

  updatePosition()
  positionTimer = setInterval(updatePosition, 33)

  requestAnimationFrame(() => { visible.value = true })

  typewriterTimer = setInterval(() => {
    revealedChars.value++
    nextTick(autoScroll)
    if (isFullyRevealed.value && typewriterTimer) {
      clearInterval(typewriterTimer)
      typewriterTimer = null
    }
  }, TYPEWRITER_MS)

  dismissTimer = setTimeout(() => {
    dismissTimer = null
    visible.value = false
    emit('dismiss', props.agentId)
  }, TOTAL_LIFETIME_MS)
})

onUnmounted(() => {
  // Ensure turn queue advances even on early unmount (e.g. parent re-render)
  const wasPending = dismissTimer !== null
  if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null }
  if (typewriterTimer) { clearInterval(typewriterTimer); typewriterTimer = null }
  if (positionTimer) { clearInterval(positionTimer); positionTimer = null }
  if (wasPending) {
    emit('dismiss', props.agentId)
  }
})
</script>

<template>
  <Transition name="retro-pop">
    <div
      v-if="visible && hasPosition"
      class="absolute z-30 w-[240px] pointer-events-none"
      :style="{
        left: `${posX}px`,
        bottom: `calc(100% - ${posY}px + 44px)`,
        transform: 'translateX(-50%)',
      }"
    >
      <div class="retro-bubble bg-[#0a0a0f] border-2 border-white/80 rounded-none px-3 py-2 shadow-[4px_4px_0_rgba(0,0,0,0.5)]">
        <div class="font-mono text-[10px] text-accent uppercase tracking-wider mb-0.5">
          {{ agentName }}
        </div>
        <div
          ref="scrollContainer"
          class="text-xs text-white/80 leading-snug font-mono max-h-[72px] overflow-y-auto bubble-scroll"
        >
          "{{ displayedMessage }}<span v-if="!isFullyRevealed" class="retro-cursor">_</span>"
        </div>
      </div>
      <!-- Pixel-art tail pointer -->
      <div class="retro-tail" />
    </div>
  </Transition>
</template>

<style scoped>
.retro-tail {
  position: relative;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 8px solid rgba(255, 255, 255, 0.8);
}

.retro-tail::after {
  content: '';
  position: absolute;
  top: -10px;
  left: -4px;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 6px solid #0a0a0f;
}

.retro-cursor {
  animation: blink 0.5s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.bubble-scroll::-webkit-scrollbar {
  width: 3px;
}

.bubble-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.bubble-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
}

.retro-pop-enter-active {
  animation: pop-in 0.15s ease-out;
}

.retro-pop-leave-active {
  animation: pop-out 0.1s ease-in forwards;
}

@keyframes pop-in {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}

@keyframes pop-out {
  to {
    opacity: 0;
  }
}
</style>
