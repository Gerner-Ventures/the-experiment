<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { MapTheme, MapData } from '@/types/world'
import type { AgentConfig } from '@/types/agent'
import { usePixiWorld } from '@/composables/usePixiWorld'
import { getSpriteById } from '@/config/character-sprites'

const props = defineProps<{
  theme: MapTheme
  mapData: MapData
  agents: AgentConfig[]
}>()

const canvasContainer = ref<HTMLElement>()
const world = usePixiWorld()

onMounted(async () => {
  if (!canvasContainer.value) return

  await world.mount(canvasContainer.value)
  world.loadMap(props.theme, props.mapData)

  // Spawn agents at random walkable tiles
  const walkableTiles = props.mapData.tiles.filter(t => t.walkable && t.tileType !== 'building')
  const shuffled = [...walkableTiles].sort(() => Math.random() - 0.5)

  for (let i = 0; i < props.agents.length; i++) {
    const agent = props.agents[i]
    const tile = shuffled[i % shuffled.length]
    const sprite = getSpriteById(agent.characterId)
    if (!sprite) continue

    world.spawnAgent(agent.id, agent.name, sprite, { x: tile.x, y: tile.y })
  }

  // Start demo mode
  world.startDemo()

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
