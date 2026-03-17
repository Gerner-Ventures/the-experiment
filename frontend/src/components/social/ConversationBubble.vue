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
  turnId: number
  agentName: string
  message: string
  agentId: string
  variant?: 'thought' | 'dialogue'
  /** Override hold-after-typing duration (ms). Lower = snappier meeting pacing. */
  holdMs?: number
  getPosition: (agentId: string) => { x: number; y: number } | null
  audioStatus: AudioStatus
  audioUrl: string | null
}>(), {
  variant: 'dialogue',
  holdMs: HOLD_AFTER_TYPING_MS,
})

const emit = defineEmits<{
  dismiss: [turnId: number]
  audioEnd: [turnId: number]
}>()

const visible = ref(false)
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
  props.message.length * TYPEWRITER_MS + props.holdMs,
)

const displayedMessage = computed(() => props.message.slice(0, revealedChars.value))
const isFullyRevealed = computed(() => revealedChars.value >= props.message.length)
const bubbleLabel = computed(() =>
  props.variant === 'thought'
    ? locale.social.speech.thoughtLabel
    : locale.social.speech.dialogueLabel,
)
const bubbleFrameClass = computed(() =>
  props.variant === 'thought'
    ? 'bg-[#0d1620] border-[#8fd3ff]/80 shadow-[4px_4px_0_rgba(16,44,61,0.5)] thought-drift'
    : 'bg-[#0a0a0f] border-white/80 shadow-[4px_4px_0_rgba(0,0,0,0.5)]',
)
const bubbleTextClass = computed(() =>
  props.variant === 'thought'
    ? 'text-[#d7efff] italic'
    : 'text-white/80',
)

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
      .catch((err: unknown) => {
        const errName = err instanceof Error ? err.name : ''
        if (errName === 'NotAllowedError') {
          autoplayBlocked.value = true
          return
        }
        autoplayBlocked.value = false
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
  emit('audioEnd', props.turnId)
  dismiss()
}

function onAudioError() {
  isPlaying.value = false
  emit('audioEnd', props.turnId)
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

let mountedAt = 0
let dismissReason = ''

function dismiss() {
  if (!visible.value) return
  visible.value = false
  const wasPlaying = isPlaying.value
  stopAudio()
  const aliveMs = Date.now() - mountedAt
  console.debug(
    `[Bubble] Dismissed: ${props.agentName} | reason: ${dismissReason || 'timer'} | alive: ${(aliveMs / 1000).toFixed(1)}s | audio: ${wasPlaying ? 'playing' : props.audioStatus}`,
  )
  emit('dismiss', props.turnId)
}

// Watch for late-arriving audio metadata; either the status or the URL can land after mount.
watch(
  () => [props.audioStatus, props.audioUrl] as const,
  ([newStatus, audioUrl]) => {
    const aliveMs = mountedAt ? Date.now() - mountedAt : 0
    if (newStatus === 'ready' && audioUrl && !audio && !isMuted()) {
      console.debug(
        `[Bubble] Audio ready for ${props.agentName} after ${(aliveMs / 1000).toFixed(1)}s`,
      )
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        pendingTimer = null
      }
      tryPlay()
    }
  },
)

onMounted(() => {
  mountedAt = Date.now()
  const audioInfo = props.audioStatus === 'ready' ? 'ready' : props.audioStatus === 'pending' ? 'pending' : `idle(url:${props.audioUrl ? 'yes' : 'no'})`
  console.debug(
    `[Bubble] Mounted: ${props.agentName} | turnId: ${props.turnId} | audio: ${audioInfo} | muted: ${isMuted()} | textLen: ${props.message.length} | lifetime: ${(TOTAL_LIFETIME_MS / 1000).toFixed(1)}s`,
  )

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
      console.debug(`[Bubble] Audio pending timeout for ${props.agentName} — falling back to text-only`)
      if (!dismissTimer) {
        dismissReason = 'pending-timeout'
        dismissTimer = setTimeout(dismiss, TOTAL_LIFETIME_MS)
      }
    }, PENDING_TIMEOUT_MS)
  }

  // Text-only dismiss timer (overridden if audio starts playing)
  if (!audio && !pendingTimer) {
    dismissReason = 'text-only'
    dismissTimer = setTimeout(dismiss, TOTAL_LIFETIME_MS)
  }
})

onUnmounted(() => {
  const wasPending = dismissTimer !== null || isPlaying.value
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
  if (wasPending) {
    const aliveMs = Date.now() - mountedAt
    console.debug(
      `[Bubble] Force-unmounted: ${props.agentName} | alive: ${(aliveMs / 1000).toFixed(1)}s | reason: v-if changed (meeting or phase shift)`,
    )
    emit('dismiss', props.turnId)
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
      <div class="retro-bubble border-2 rounded-none px-3 py-2" :class="bubbleFrameClass">
        <div
          class="font-mono text-[10px] text-accent uppercase tracking-wider mb-0.5 flex items-center gap-1"
        >
          {{ agentName }}
          <span class="text-[9px] text-white/45">{{ bubbleLabel }}</span>
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
          :class="bubbleTextClass"
        >
          <template v-if="variant === 'thought'">
            {{ displayedMessage }}<span v-if="!isFullyRevealed" class="retro-cursor">_</span>
          </template>
          <template v-else>
            "{{ displayedMessage }}<span v-if="!isFullyRevealed" class="retro-cursor">_</span>"
          </template>
        </div>
      </div>
      <!-- Tail: thought bubbles get circular dots, dialogue gets triangular pointer -->
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
  background: rgba(143, 211, 255, 0.4);
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
  background: rgba(143, 211, 255, 0.2);
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
