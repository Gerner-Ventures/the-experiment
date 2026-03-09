<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useLocale } from '@/locales'

const TYPEWRITER_MS = 40

const locale = useLocale()

const props = defineProps<{
  text: string
}>()

const revealedChars = ref(0)
const displayedText = computed(() => props.text.slice(0, revealedChars.value))
const isFullyRevealed = computed(() => revealedChars.value >= props.text.length)

let typewriterTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  typewriterTimer = setInterval(() => {
    revealedChars.value++
    if (isFullyRevealed.value && typewriterTimer) {
      clearInterval(typewriterTimer)
      typewriterTimer = null
    }
  }, TYPEWRITER_MS)
})

onUnmounted(() => {
  if (typewriterTimer) {
    clearInterval(typewriterTimer)
    typewriterTimer = null
  }
})
</script>

<template>
  <div class="meeting-proposal text-center max-w-lg mx-auto">
    <span class="font-mono text-[10px] text-accent/60 uppercase tracking-[0.2em] block mb-2">
      {{ locale.social.meetingScene.proposalLabel }}
    </span>
    <p class="font-mono text-base text-white/90 leading-relaxed">
      "{{ displayedText }}<span v-if="!isFullyRevealed" class="animate-pulse">_</span>"
    </p>
  </div>
</template>
