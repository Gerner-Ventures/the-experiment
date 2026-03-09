<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { MapTheme, MapData } from '@/types/world'
import type { AgentConfig } from '@/types/agent'
import { useGameWorld } from '@/composables/useGameWorld'
import { usePathfinding } from '@/composables/usePathfinding'
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
const world = useGameWorld()
const pathfinding = usePathfinding()

function moveAgentToLocation(agentId: string, locationId: string, onComplete?: () => void) {
  pathfinding.moveAgentToLocation(world, agentId, locationId, onComplete)
}

onMounted(async () => {
  if (!canvasContainer.value) return

  await world.mount(canvasContainer.value)
  world.loadMap(props.theme, props.mapData)
  pathfinding.buildIndex(props.mapData)

  // Spawn agents at random walkable tiles (includes buildings)
  const spawnTiles = pathfinding.getSpawnTiles(props.mapData)

  for (let i = 0; i < props.agents.length; i++) {
    const agent = props.agents[i]
    const tile = spawnTiles[i % spawnTiles.length]
    const sprite = getSpriteById(agent.characterId)
    if (!sprite) continue

    world.spawnAgent(agent.id, agent.name, sprite, tile)
  }

  // Set up agent click handler
  world.onAgentClick((agentId: string) => {
    emit('agentClick', agentId)
  })

  // Start demo mode if no backend
  if (props.demoMode) {
    world.startDemo()
    world.startDemoCycle()
  }

  // Center on map middle
  world.centerOn(props.mapData.width / 2, props.mapData.height / 2)
})

onUnmounted(() => {
  world.destroy()
})

/** Get an agent's current screen position (for positioning bubbles above sprites) */
function getAgentScreenPosition(agentId: string): { x: number; y: number } | null {
  return world.getAgentScreenPosition(agentId)
}

defineExpose({
  moveAgentToLocation,
  getAgentScreenPosition,
  playAction: world.playAction,
  highlightAgent: world.highlightAgent,
  clearHighlight: world.clearHighlight,
  moveAgentTo: world.moveAgentTo,
  getAgents: world.getAgents,
  setPhase: world.setPhase,
  removeAgent: world.removeAgent,
})
</script>

<template>
  <div ref="canvasContainer" class="w-full h-full pixi-canvas-container" />
</template>

<style scoped>
/* Pin the WebGL canvas to z-index 0 so it stays below the HUD overlay
   layer. Using a CSS rule instead of imperative style keeps layout
   concerns visible in the template/style rather than hidden in a composable. */
.pixi-canvas-container :deep(canvas) {
  position: relative;
  z-index: 0;
}
</style>
