<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { MapTheme, MapData } from '@/types/world'
import type { AgentConfig } from '@/types/agent'
import { usePixiWorld } from '@/composables/usePixiWorld'
import { getSpriteById } from '@/config/character-sprites'

const props = withDefaults(defineProps<{
  theme: MapTheme
  mapData: MapData
  agents: AgentConfig[]
  demoMode?: boolean
}>(), {
  demoMode: true,
})

const emit = defineEmits<{
  agentClick: [agentId: string]
}>()

const canvasContainer = ref<HTMLElement>()
const world = usePixiWorld()

defineExpose({
  playAction: world.playAction,
  highlightAgent: world.highlightAgent,
  clearHighlight: world.clearHighlight,
  moveAgentTo: world.moveAgentTo,
  getAgentScreenPosition: world.getAgentScreenPosition,
  getAgents: world.getAgents,
})

/** Fisher-Yates shuffle (unbiased) */
function shuffle<T>(arr: T[]): T[] {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

onMounted(async () => {
  if (!canvasContainer.value) return

  await world.mount(canvasContainer.value)
  world.loadMap(props.theme, props.mapData)

  // Spawn agents at random walkable tiles (Fisher-Yates shuffle)
  const walkableTiles = props.mapData.tiles.filter(t => t.walkable && t.tileType !== 'building')
  const shuffled = shuffle(walkableTiles)

  for (let i = 0; i < props.agents.length; i++) {
    const agent = props.agents[i]
    const tile = shuffled[i % shuffled.length]
    const sprite = getSpriteById(agent.characterId)
    if (!sprite) continue

    world.spawnAgent(agent.id, agent.name, sprite, { x: tile.x, y: tile.y })
  }

  // Set up agent click handler
  world.onAgentClick((agentId: string) => {
    emit('agentClick', agentId)
  })

  // Start demo mode if no backend
  if (props.demoMode) {
    world.startDemo()
  }

  // Center on map middle
  world.centerOn(props.mapData.width / 2, props.mapData.height / 2)
})

onUnmounted(() => {
  world.destroy()
})
</script>

<template>
  <div ref="canvasContainer" class="w-full h-full" />
</template>
