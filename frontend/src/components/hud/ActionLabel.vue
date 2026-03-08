<script setup lang="ts">
import { computed } from 'vue'
import { AGGRESSIVE_ACTIONS } from '@/config/action-categories'
import { useLocale } from '@/locales'

const locale = useLocale()

const props = defineProps<{
  actionType: string
  position: { x: number; y: number }
}>()

const isAggressive = computed(() => AGGRESSIVE_ACTIONS.has(props.actionType))

const label = computed(() => {
  const actions = locale.actions as Record<string, string>
  return actions[props.actionType] ?? props.actionType.toUpperCase()
})
</script>

<template>
  <div
    class="action-label pointer-events-none fixed z-30 -translate-x-1/2"
    :class="isAggressive ? 'action-label--aggressive' : 'action-label--normal'"
    :style="{
      left: `${position.x}px`,
      top: `${position.y - 60}px`,
    }"
  >
    {{ label }}
  </div>
</template>

<style scoped>
.action-label {
  font-family: 'JetBrains Mono Variable', monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 2px 8px;
  border-radius: 3px;
  white-space: nowrap;
  animation: action-pop 0.2s ease-out;
}

.action-label--aggressive {
  color: #ff4444;
  background: rgba(255, 68, 68, 0.15);
  border: 1px solid rgba(255, 68, 68, 0.4);
  text-shadow: 0 0 6px rgba(255, 68, 68, 0.5);
}

.action-label--normal {
  color: #e0e0e0;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
}

@keyframes action-pop {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(4px) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }
}
</style>
