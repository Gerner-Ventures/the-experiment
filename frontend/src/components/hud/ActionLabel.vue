<script setup lang="ts">
const props = defineProps<{
  actionType: string
  position: { x: number; y: number }
}>()

const AGGRESSIVE_ACTIONS = new Set([
  'attack', 'stab', 'shoot', 'threaten', 'poison',
])

const isAggressive = AGGRESSIVE_ACTIONS.has(props.actionType)
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
    {{ actionType.toUpperCase() }}
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
