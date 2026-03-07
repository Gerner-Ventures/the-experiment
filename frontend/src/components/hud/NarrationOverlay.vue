<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useLocale } from '@/locales'

const locale = useLocale()

const props = defineProps<{
  text: string
  visible: boolean
}>()

const emit = defineEmits<{
  dismiss: []
}>()

const displayedText = ref('')
let typewriterTimer: ReturnType<typeof setTimeout> | null = null
let charIndex = 0

watch(() => props.visible, (show) => {
  if (show && props.text) {
    startTypewriter()
  } else {
    stopTypewriter()
  }
})

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

function skipOrDismiss() {
  if (charIndex < props.text.length) {
    stopTypewriter()
    displayedText.value = props.text
    charIndex = props.text.length
  } else {
    emit('dismiss')
  }
}

onUnmounted(stopTypewriter)
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
        <p class="mt-8 font-mono text-[10px] text-white/20 uppercase tracking-widest">
          {{ locale.gm.clickToContinue }}
        </p>
      </div>
    </div>
  </Transition>
</template>
