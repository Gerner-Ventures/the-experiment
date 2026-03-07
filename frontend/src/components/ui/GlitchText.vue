<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  text: string
  tag?: string
  speed?: number
  glitchChars?: string
}>(), {
  tag: 'span',
  speed: 30,
  glitchChars: '!@#$%^&*()_+-=[]{}|;:,.<>?/~`'
})

const displayed = ref('')
const isComplete = ref(false)

const emit = defineEmits<{ complete: [] }>()
const timers: ReturnType<typeof setTimeout>[] = []

onMounted(() => {
  let i = 0
  const chars = props.text.split('')

  const tick = () => {
    if (i >= chars.length) {
      isComplete.value = true
      emit('complete')
      return
    }

    const glitchChar = props.glitchChars[Math.floor(Math.random() * props.glitchChars.length)]
    displayed.value = props.text.slice(0, i) + glitchChar

    timers.push(setTimeout(() => {
      i++
      displayed.value = props.text.slice(0, i)
      timers.push(setTimeout(tick, props.speed))
    }, props.speed / 2))
  }

  timers.push(setTimeout(tick, 200))
})

onUnmounted(() => timers.forEach(clearTimeout))
</script>

<template>
  <component :is="tag" class="font-mono">
    {{ displayed }}<span
      v-if="!isComplete"
      class="inline-block w-[2px] h-[1em] bg-accent ml-0.5 align-middle"
      :class="{ 'animate-[typewriter-cursor_0.6s_step-end_infinite]': true }"
    />
  </component>
</template>
