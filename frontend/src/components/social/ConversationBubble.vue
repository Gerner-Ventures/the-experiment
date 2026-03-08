<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { SoundOutlined } from '@ant-design/icons-vue'
import type { AudioStatus } from '@/stores/social'
import { useLocale } from '@/locales'

import { MUTE_STORAGE_KEY } from '@/config/audio'

const AUTO_DISMISS_MS = 6000
const PENDING_TIMEOUT_MS = 3000

const locale = useLocale()

const props = defineProps<{
  agentName: string
  message: string
  index?: number
  audioStatus: AudioStatus
  audioUrl: string | null
}>()

const emit = defineEmits<{
  dismiss: []
  audioEnd: []
}>()

const visible = ref(true)
const isPlaying = ref(false)
const autoplayBlocked = ref(false)
let fadeTimer: ReturnType<typeof setTimeout> | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null
let audio: HTMLAudioElement | null = null

function isMuted(): boolean {
  return window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true'
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
      })
      .catch(() => {
        autoplayBlocked.value = true
        isPlaying.value = false
        // Arm fallback dismiss timer so blocked bubbles don't live forever
        if (!fadeTimer) {
          fadeTimer = setTimeout(dismiss, AUTO_DISMISS_MS)
        }
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
  visible.value = false
  stopAudio()
  emit('dismiss')
}

// Watch for audioStatus changing to 'ready' after mount (late arrival)
watch(() => props.audioStatus, (newStatus) => {
  if (newStatus === 'ready' && props.audioUrl && !audio && !isMuted()) {
    // Cancel pending and text-only timers since we have audio now
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
    if (fadeTimer) {
      clearTimeout(fadeTimer)
      fadeTimer = null
    }
    tryPlay()
  }
})

onMounted(() => {
  if (props.audioStatus === 'ready' && props.audioUrl && !isMuted()) {
    tryPlay()
  } else if (props.audioStatus === 'pending' && !isMuted()) {
    // Wait up to 3s for pending audio to become ready, then fall back to text-only
    pendingTimer = setTimeout(() => {
      pendingTimer = null
      fadeTimer = setTimeout(dismiss, AUTO_DISMISS_MS)
    }, PENDING_TIMEOUT_MS)
  } else {
    // Text-only fallback: auto-dismiss after 6s
    fadeTimer = setTimeout(dismiss, AUTO_DISMISS_MS)
  }
})

onUnmounted(() => {
  if (fadeTimer) clearTimeout(fadeTimer)
  if (pendingTimer) clearTimeout(pendingTimer)
  stopAudio()
})

const bottomOffset = (props.index ?? 0) * 64 + 56
</script>

<template>
  <Transition name="fade">
    <div
      v-if="visible"
      class="absolute right-4 z-30 max-w-[240px]"
      :style="{ bottom: `${bottomOffset}px` }"
    >
      <div class="bg-base/90 backdrop-blur-sm border border-white/[0.08] rounded-lg px-3 py-2 shadow-lg">
        <div class="font-mono text-[10px] text-accent/60 uppercase tracking-wider mb-0.5 flex items-center gap-1">
          {{ agentName }}
          <SoundOutlined v-if="isPlaying" class="text-accent/80" />
          <span
            v-if="autoplayBlocked"
            class="cursor-pointer text-accent/80 hover:text-accent"
            @click="handleTapToPlay"
          >
            {{ locale.social.speech.tapToPlay }}
          </span>
        </div>
        <div class="text-xs text-white/80 leading-snug line-clamp-3">
          "{{ message }}"
        </div>
      </div>
    </div>
  </Transition>
</template>
