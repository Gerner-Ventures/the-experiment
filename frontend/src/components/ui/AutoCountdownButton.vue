<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Button } from 'ant-design-vue'

const props = withDefaults(defineProps<{
  delay?: number
  active?: boolean
  type?: 'primary' | 'default'
  size?: 'small' | 'middle' | 'large'
  disabled?: boolean
}>(), {
  delay: 5000,
  active: true,
  type: 'primary',
  size: 'large',
  disabled: false,
})

const emit = defineEmits<{
  fire: []
}>()

const VIEW = 100
const STROKE = 6
const R = (VIEW - STROKE) / 2
const C = 2 * Math.PI * R
const CENTER = VIEW / 2

const progress = ref(0)
const cancelled = ref(false)
const dashOffset = computed(() => C * (1 - progress.value))

// Note: uses requestAnimationFrame for SVG (DOM) animation, not canvas.
// The CLAUDE.md rule "never use raw rAF alongside PixiJS" targets canvas contention — this is safe.
let startTime = 0
let rafId = 0

function tick() {
  const elapsed = Date.now() - startTime
  progress.value = Math.min(elapsed / props.delay, 1)
  if (progress.value >= 1) {
    cancelled.value = true
    emit('fire')
    return
  }
  rafId = requestAnimationFrame(tick)
}

function startCountdown() {
  cancelled.value = false
  progress.value = 0
  startTime = Date.now()
  rafId = requestAnimationFrame(tick)
}

function stopCountdown() {
  cancelAnimationFrame(rafId)
  rafId = 0
}

function handleClick() {
  stopCountdown()
  cancelled.value = true
  emit('fire')
}

watch(() => [props.active, props.disabled] as const, ([active, disabled]) => {
  if (active && !disabled) {
    startCountdown()
  } else {
    stopCountdown()
  }
})

onMounted(() => {
  if (props.active && !props.disabled) {
    startCountdown()
  }
})

onUnmounted(() => {
  stopCountdown()
})
</script>

<template>
  <div class="auto-countdown-btn">
    <!-- SVG ring overlay -->
    <svg
      v-if="active && !cancelled"
      class="countdown-svg"
      :viewBox="`0 0 ${VIEW} ${VIEW}`"
    >
      <!-- Background track -->
      <circle
        :cx="CENTER"
        :cy="CENTER"
        :r="R"
        fill="none"
        :stroke-width="STROKE"
        class="ring-track"
      />
      <!-- Animated progress arc -->
      <circle
        :cx="CENTER"
        :cy="CENTER"
        :r="R"
        fill="none"
        :stroke-width="STROKE"
        stroke-linecap="round"
        :stroke-dasharray="C"
        :stroke-dashoffset="dashOffset"
        class="ring-progress"
      />
    </svg>
    <Button
      :type="type"
      :size="size"
      :shape="$slots.default ? undefined : 'circle'"
      :disabled="disabled"
      @click="handleClick"
    >
      <template #icon>
        <slot name="icon" />
      </template>
      <slot />
    </Button>
  </div>
</template>

<style scoped>
.auto-countdown-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.countdown-svg {
  position: absolute;
  inset: -4px;
  width: calc(100% + 8px);
  height: calc(100% + 8px);
  pointer-events: none;
  /* Start from 12-o'clock */
  transform: rotate(-90deg);
  border-radius: inherit;
}

.ring-track {
  stroke: rgba(255, 255, 255, 0.08);
}

.ring-progress {
  stroke: var(--color-accent);
  filter: drop-shadow(0 0 6px var(--color-accent));
  transition: stroke-dashoffset 60ms linear;
}
</style>
