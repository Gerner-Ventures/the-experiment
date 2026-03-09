<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { SoundOutlined } from '@ant-design/icons-vue'
import type { AudioStatus } from '@/stores/social'
import { useLocale } from '@/locales'
import { MUTE_STORAGE_KEY } from '@/config/audio'

const TYPEWRITER_MS = 35
const HOLD_AFTER_TYPING_MS = 2000
const MIN_LIFETIME_MS = 4000
/** Vertical offset above the agent sprite anchor so the bubble clears the sprite head */
const BUBBLE_OFFSET_PX = 120
const PENDING_TIMEOUT_MS = 3000

const locale = useLocale()

const props = withDefaults(defineProps<{
  agentName: string
  message: string
  agentId: string
  getPosition: (agentId: string) => { x: number; y: number } | null
  audioStatus: AudioStatus
  audioUrl: string | null
  /** Visual variant: 'speech' for spoken dialog, 'thought' for internal monologue */
  variant?: 'speech' | 'thought'
}>(), {
  variant: 'thought',
})

const emit = defineEmits<{
  dismiss: [agentId: string]
  audioEnd: []
}>()

const visible = ref(false)
const dismissed = ref(false)
const revealedChars = ref(0)
const posX = ref(0)
const posY = ref(0)
const hasPosition = ref(false)
const scrollContainer = ref<HTMLElement | null>(null)
const isPlaying = ref(false)
const autoplayBlocked = ref(false)
let dismissTimer: ReturnType<typeof setTimeout> | null = null
let typewriterTimer: ReturnType<typeof setInterval> | null = null
let positionTimer: ReturnType<typeof setInterval> | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null
let audio: HTMLAudioElement | null = null

const TOTAL_LIFETIME_MS = Math.max(
  MIN_LIFETIME_MS,
  props.message.length * TYPEWRITER_MS + HOLD_AFTER_TYPING_MS,
)

const displayedMessage = computed(() => props.message.slice(0, revealedChars.value))
const isFullyRevealed = computed(() => revealedChars.value >= props.message.length)

function isMuted(): boolean {
  return window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true'
}

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
    posX.value = window.innerWidth - 160
    posY.value = window.innerHeight - 100
    hasPosition.value = true
    console.debug(
      `[Bubble] No sprite position for ${props.agentName} (${props.agentId}), using fallback`,
    )
  }
}

function autoScroll() {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
  }
}

function tryPlay() {
  if (!props.audioUrl || isMuted()) return
  audio = new Audio(props.audioUrl)
  audio.addEventListener('ended', onAudioEnded)
  audio.addEventListener('error', onAudioError)
  const playPromise = audio.play()
  if (playPromise) {
    playPromise
      .then(() => {
        isPlaying.value = true
        autoplayBlocked.value = false
        // Cancel text-only dismiss timer — audio end will trigger dismiss
        if (dismissTimer) {
          clearTimeout(dismissTimer)
          dismissTimer = null
        }
      })
      .catch(() => {
        autoplayBlocked.value = true
        isPlaying.value = false
      })
  }
}

function handleTapToPlay() {
  autoplayBlocked.value = false
  tryPlay()
}

function onAudioEnded() {
  isPlaying.value = false
  emit('audioEnd')
  dismiss()
}

function onAudioError() {
  isPlaying.value = false
  emit('audioEnd')
  dismiss()
}

function stopAudio() {
  if (audio) {
    audio.pause()
    audio.removeEventListener('ended', onAudioEnded)
    audio.removeEventListener('error', onAudioError)
    audio = null
  }
  isPlaying.value = false
}

function dismiss() {
  if (dismissed.value) return
  dismissed.value = true
  visible.value = false
  stopAudio()
  emit('dismiss', props.agentId)
}

// Watch for audioStatus changing to 'ready' after mount (late arrival)
watch(
  () => props.audioStatus,
  (newStatus) => {
    if (newStatus === 'ready' && props.audioUrl && !audio && !isMuted()) {
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        pendingTimer = null
      }
      tryPlay()
    }
  },
)

onMounted(() => {
  console.debug(`[Bubble] Mounted for ${props.agentName} (${props.agentId})`)

  updatePosition()
  positionTimer = setInterval(updatePosition, 33)

  nextTick(() => {
    visible.value = true
  })

  // Typewriter reveal
  typewriterTimer = setInterval(() => {
    revealedChars.value++
    nextTick(autoScroll)
    if (isFullyRevealed.value && typewriterTimer) {
      clearInterval(typewriterTimer)
      typewriterTimer = null
    }
  }, TYPEWRITER_MS)

  // Audio playback
  if (props.audioStatus === 'ready' && props.audioUrl && !isMuted()) {
    tryPlay()
  } else if (props.audioStatus === 'pending' && !isMuted()) {
    pendingTimer = setTimeout(() => {
      pendingTimer = null
      // Audio didn't arrive in time — fall back to text-only dismiss
      if (!dismissTimer) {
        dismissTimer = setTimeout(dismiss, TOTAL_LIFETIME_MS)
      }
    }, PENDING_TIMEOUT_MS)
  }

  // Text-only dismiss timer (overridden if audio starts playing)
  if (!audio && !pendingTimer) {
    dismissTimer = setTimeout(dismiss, TOTAL_LIFETIME_MS)
  }
})

onUnmounted(() => {
  if (dismissTimer) {
    clearTimeout(dismissTimer)
    dismissTimer = null
  }
  if (typewriterTimer) {
    clearInterval(typewriterTimer)
    typewriterTimer = null
  }
  if (positionTimer) {
    clearInterval(positionTimer)
    positionTimer = null
  }
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  stopAudio()
  // Emit dismiss only if we haven't already — prevents double-fire
  if (!dismissed.value) {
    dismissed.value = true
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
        bottom: `calc(100% - ${posY}px + ${BUBBLE_OFFSET_PX}px)`,
        transform: 'translateX(-50%)',
      }"
    >
      <div
        class="retro-bubble bg-[#0a0a0f] px-3 py-2"
        :class="variant === 'thought'
          ? 'border border-dashed border-white/40 rounded-lg shadow-[2px_2px_0_rgba(0,0,0,0.3)] thought-drift'
          : 'border-2 border-white/80 rounded-none shadow-[4px_4px_0_rgba(0,0,0,0.5)]'"
      >
        <div
          class="font-mono text-[10px] uppercase tracking-wider mb-0.5 flex items-center gap-1"
          :class="variant === 'thought' ? 'text-white/40' : 'text-accent'"
        >
          {{ agentName }}
          <SoundOutlined v-if="isPlaying" class="text-accent/80" />
          <span
            v-if="autoplayBlocked"
            class="cursor-pointer text-accent/80 hover:text-accent pointer-events-auto"
            @click="handleTapToPlay"
          >
            {{ locale.social.speech.tapToPlay }}
          </span>
        </div>
        <div
          ref="scrollContainer"
          class="text-xs leading-snug font-mono max-h-[72px] overflow-y-auto bubble-scroll"
          :class="variant === 'thought' ? 'text-white/50 italic' : 'text-white/80'"
        >
          <template v-if="variant === 'thought'">
            {{ displayedMessage }}<span v-if="!isFullyRevealed" class="retro-cursor">_</span>
          </template>
          <template v-else>
            "{{ displayedMessage }}<span v-if="!isFullyRevealed" class="retro-cursor">_</span>"
          </template>
        </div>
      </div>
      <!-- Pixel-art tail pointer -->
      <div :class="variant === 'thought' ? 'thought-tail' : 'retro-tail'" />
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

.thought-tail {
  position: relative;
  left: 50%;
  transform: translateX(-50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  margin-top: 4px;
}

.thought-tail::after {
  content: '';
  position: absolute;
  top: 10px;
  left: 2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
}

.thought-drift {
  animation: thought-float 4s ease-in-out infinite;
}

@keyframes thought-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

.retro-cursor {
  animation: blink 0.5s step-end infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
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
