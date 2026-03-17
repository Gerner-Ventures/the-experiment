<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue'
import { useLocale } from '@/locales'
import type { NarrationAudioStatus } from '@/types/websocket'

const locale = useLocale()

const props = defineProps<{
  text: string
  visible: boolean
  audioStatus: NarrationAudioStatus | 'idle'
  audioUrl: string | null
  autoplayBlocked: boolean
}>()

const emit = defineEmits<{
  dismiss: []
  'update:playing': [value: boolean]
  'update:autoplayBlocked': [value: boolean]
  'audio-error': []
}>()

const displayedText = ref('')
let typewriterTimer: ReturnType<typeof setTimeout> | null = null
let charIndex = 0
let audio: HTMLAudioElement | null = null

// Named handlers for proper cleanup
function onAudioPlaying() {
  emit('update:playing', true)
  emit('update:autoplayBlocked', false)
}
function onAudioEnded() {
  emit('update:playing', false)
  audioEnded.value = true
}
function onAudioError() {
  emit('update:playing', false)
  audioLoadFailed.value = true
  emit('audio-error')
}

const audioEnded = ref(false)
const audioLoadFailed = ref(false)

const showPlayButton = computed(() =>
  props.audioStatus === 'ready' && !audioLoadFailed.value && (props.autoplayBlocked || audioEnded.value)
)
const showAudioLoading = computed(() => props.audioStatus === 'pending')
const showAudioError = computed(() =>
  props.audioStatus === 'error' || props.audioStatus === 'unavailable' || audioLoadFailed.value
)

watch(
  () => [props.visible, props.text] as const,
  ([visible, text], previous) => {
    const [wasVisible, previousText] = previous ?? [false, '']
    if (visible && text) {
      const shouldRestartTypewriter = !wasVisible || text !== previousText
      if (shouldRestartTypewriter) {
        stopTypewriter()
        stopAudio()
        startTypewriter()
        audioEnded.value = false
        audioLoadFailed.value = false
      }
    } else {
      stopTypewriter()
      stopAudio()
    }
  },
  { immediate: true },
)

watch(() => [props.audioStatus, props.audioUrl, props.visible] as const, ([status, audioUrl, visible]) => {
  if (status === 'ready' && visible && audioUrl) {
    tryPlayAudio()
  } else if (status !== 'ready') {
    stopAudio()
  }
}, { immediate: true })

function startTypewriter() {
  displayedText.value = ''
  charIndex = 0
  typeChar()
}

function typeChar() {
  if (charIndex < props.text.length) {
    displayedText.value += props.text[charIndex]
    charIndex++
    typewriterTimer = setTimeout(typeChar, 30)
  }
}

function stopTypewriter() {
  if (typewriterTimer) {
    clearTimeout(typewriterTimer)
    typewriterTimer = null
  }
}

function tryPlayAudio() {
  if (!props.audioUrl) return
  audioLoadFailed.value = false
  stopAudio()

  audio = new Audio(props.audioUrl)
  audioEnded.value = false

  audio.addEventListener('playing', onAudioPlaying)
  audio.addEventListener('ended', onAudioEnded)
  audio.addEventListener('error', onAudioError)

  const playPromise = audio.play()
  if (playPromise) {
    playPromise.catch(() => {
      // Browser blocked autoplay — user must click to play
      emit('update:autoplayBlocked', true)
      emit('update:playing', false)
    })
  }
}

function stopAudio() {
  if (audio) {
    audio.removeEventListener('playing', onAudioPlaying)
    audio.removeEventListener('ended', onAudioEnded)
    audio.removeEventListener('error', onAudioError)
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    audio = null
    emit('update:playing', false)
  }
}

function skipOrDismiss() {
  if (charIndex < props.text.length) {
    stopTypewriter()
    displayedText.value = props.text
    charIndex = props.text.length
  } else {
    emit('dismiss')
  }
}

onUnmounted(() => {
  stopTypewriter()
  stopAudio()
})
</script>

<template>
  <Transition name="fade">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer"
      @click="skipOrDismiss"
    >
      <div class="max-w-2xl mx-auto px-8 text-center">
        <p class="font-display text-2xl text-white/90 leading-relaxed italic">
          "{{ displayedText }}"
          <span v-if="charIndex < text.length" class="inline-block w-0.5 h-6 bg-accent/60 animate-pulse ml-1" />
        </p>

        <!-- Audio controls -->
        <div class="mt-6 flex items-center justify-center gap-3">
          <!-- Loading spinner -->
          <p v-if="showAudioLoading" class="font-mono text-[11px] text-white/30 uppercase tracking-widest">
            {{ locale.gm.audioLoading }}
          </p>

          <!-- Play / Replay button -->
          <button
            v-if="showPlayButton"
            class="px-4 py-1.5 rounded font-mono text-[11px] text-white/70 uppercase tracking-widest border border-white/20 hover:border-white/40 hover:text-white/90 transition-colors"
            @click.stop="tryPlayAudio"
          >
            {{ audioEnded ? locale.gm.audioReplay : locale.gm.audioPlay }}
          </button>

          <!-- Error indicator -->
          <p v-if="showAudioError" class="font-mono text-[10px] text-white/20 uppercase tracking-widest">
            {{ locale.gm.audioError }}
          </p>
        </div>

        <p class="mt-6 font-mono text-[10px] text-white/20 uppercase tracking-widest">
          {{ locale.gm.clickToContinue }}
        </p>
      </div>
    </div>
  </Transition>
</template>
