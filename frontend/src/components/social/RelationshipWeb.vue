<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { Drawer } from 'ant-design-vue'
import { useElementSize } from '@vueuse/core'
import { useForceGraph, type ForceGraphNode, type ForceGraphLink } from '@/composables/useForceGraph'
import { useUIStore } from '@/stores/ui'
import { useLocale } from '@/locales'
import { getSpriteById, renderSpriteToCanvas } from '@/config/character-sprites'

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const locale = useLocale()
const uiStore = useUIStore()

const svgContainer = ref<HTMLDivElement | null>(null)
const { width, height } = useElementSize(svgContainer)
const { nodes, links, buildGraph, onDragStart, onDragMove, onDragEnd } = useForceGraph(width, height)

const hoveredNode = ref<string | null>(null)
let draggingNode: ForceGraphNode | null = null

const SPRITE_W = 14
const SPRITE_H = 18

// Cache rendered sprite data URLs
const spriteDataUrls = new Map<string, string>()

function getSpriteDataUrl(characterId: string): string {
  const cached = spriteDataUrls.get(characterId)
  if (cached) return cached

  const sprite = getSpriteById(characterId)
  if (!sprite) return ''

  const url = renderSpriteToCanvas(sprite).toDataURL()
  spriteDataUrls.set(characterId, url)
  return url
}

/** Sprite display size scales with relationship count (more relationships = larger) */
function spriteScale(node: ForceGraphNode): number {
  // Base scale 2x, up to 5x for heavily connected agents
  return 2 + Math.min(3, node.relationshipCount * 0.5)
}

function spriteDisplayW(node: ForceGraphNode): number {
  return SPRITE_W * spriteScale(node)
}

function spriteDisplayH(node: ForceGraphNode): number {
  return SPRITE_H * spriteScale(node)
}

function handleNodeClick(node: ForceGraphNode) {
  uiStore.selectAgent(node.id)
}

function handleMouseDown(node: ForceGraphNode, event: MouseEvent) {
  event.preventDefault()
  draggingNode = node
  onDragStart(node)

  const onMove = (e: MouseEvent) => {
    if (!draggingNode || !svgContainer.value) return
    const rect = svgContainer.value.getBoundingClientRect()
    onDragMove(draggingNode, e.clientX - rect.left, e.clientY - rect.top)
  }

  const onUp = () => {
    if (draggingNode) {
      onDragEnd(draggingNode)
      draggingNode = null
    }
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function linkSource(link: ForceGraphLink): ForceGraphNode {
  return link.source as ForceGraphNode
}

function linkTarget(link: ForceGraphLink): ForceGraphNode {
  return link.target as ForceGraphNode
}

// Build graph when drawer opens
watch(() => width.value, (w) => {
  if (w > 0) buildGraph()
}, { once: true })

onMounted(() => {
  if (width.value > 0) buildGraph()
})
</script>

<template>
  <Drawer
    :open="visible"
    placement="right"
    :width="500"
    :closable="true"
    :mask-closable="true"
    class="relationship-web-drawer"
    @close="emit('close')"
  >
    <template #title>
      <span class="font-mono text-sm uppercase tracking-widest text-white/70">
        {{ locale.relationshipWeb.title }}
      </span>
    </template>

    <div ref="svgContainer" class="w-full h-full min-h-[400px] relative">
      <!-- Empty state -->
      <div
        v-if="nodes.length === 0"
        class="absolute inset-0 flex items-center justify-center"
      >
        <span class="font-mono text-xs text-white/30">
          {{ locale.relationshipWeb.empty }}
        </span>
      </div>

      <!-- Force-directed SVG -->
      <svg
        v-else
        :width="width"
        :height="height"
        class="w-full h-full"
      >
        <!-- Edges -->
        <line
          v-for="(link, i) in links"
          :key="'link-' + i"
          :x1="linkSource(link).x"
          :y1="linkSource(link).y"
          :x2="linkTarget(link).x"
          :y2="linkTarget(link).y"
          :stroke="link.color"
          :stroke-width="link.thickness"
          :stroke-dasharray="link.dashed ? '6 3' : undefined"
          :opacity="0.7"
        />

        <!-- Nodes: agent sprites -->
        <g
          v-for="node in nodes"
          :key="node.id"
          :transform="`translate(${node.x}, ${node.y})`"
          class="cursor-pointer"
          @mousedown="handleMouseDown(node, $event)"
          @click="handleNodeClick(node)"
          @mouseenter="hoveredNode = node.id"
          @mouseleave="hoveredNode = null"
        >
          <!-- Archetype color glow behind sprite -->
          <circle
            :r="Math.max(spriteDisplayW(node), spriteDisplayH(node)) / 2 + 4"
            :fill="node.color"
            :opacity="hoveredNode === node.id ? 0.3 : 0.15"
          />
          <!-- Sprite image -->
          <image
            v-if="getSpriteDataUrl(node.characterId)"
            :href="getSpriteDataUrl(node.characterId)"
            :x="-spriteDisplayW(node) / 2"
            :y="-spriteDisplayH(node) / 2"
            :width="spriteDisplayW(node)"
            :height="spriteDisplayH(node)"
            image-rendering="pixelated"
            :opacity="hoveredNode === node.id ? 1 : 0.9"
          />
          <!-- Hover outline -->
          <rect
            v-if="hoveredNode === node.id"
            :x="-spriteDisplayW(node) / 2 - 2"
            :y="-spriteDisplayH(node) / 2 - 2"
            :width="spriteDisplayW(node) + 4"
            :height="spriteDisplayH(node) + 4"
            fill="none"
            stroke="white"
            stroke-width="1"
            opacity="0.6"
          />
          <!-- Name label -->
          <text
            :y="spriteDisplayH(node) / 2 + 12"
            text-anchor="middle"
            fill="rgba(255,255,255,0.7)"
            font-family="'JetBrains Mono Variable', monospace"
            font-size="10"
          >
            {{ node.name }}
          </text>
          <!-- Relationship count badge -->
          <text
            v-if="node.relationshipCount > 0"
            :y="-spriteDisplayH(node) / 2 - 4"
            text-anchor="middle"
            :fill="node.color"
            font-family="'JetBrains Mono Variable', monospace"
            font-size="9"
            font-weight="bold"
          >
            {{ node.relationshipCount === 1
              ? locale.relationshipWeb.linkCount.replace('{count}', String(node.relationshipCount))
              : locale.relationshipWeb.linkCountPlural.replace('{count}', String(node.relationshipCount)) }}
          </text>
        </g>
      </svg>

      <!-- Legend -->
      <div v-if="nodes.length > 0" class="absolute bottom-2 left-2 font-mono text-[9px] text-white/40 space-y-0.5">
        <div class="flex items-center gap-1.5">
          <span class="inline-block w-3 h-0.5 bg-[#00e5a0]" /> {{ locale.relationshipWeb.trustPositive }}
        </div>
        <div class="flex items-center gap-1.5">
          <span class="inline-block w-3 h-0.5 bg-[#555863]" /> {{ locale.relationshipWeb.trustNeutral }}
        </div>
        <div class="flex items-center gap-1.5">
          <span class="inline-block w-3 h-0.5 bg-[#f54242] border-dashed border-t" /> {{ locale.relationshipWeb.trustNegative }}
        </div>
        <div class="mt-1 text-white/30">{{ locale.relationshipWeb.legendSize }}</div>
      </div>
    </div>
  </Drawer>
</template>

<style scoped>
:deep(.relationship-web-drawer .ant-drawer-content) {
  background: #0a0a0f;
}

:deep(.relationship-web-drawer .ant-drawer-header) {
  background: #0a0a0f;
  border-bottom: 2px solid rgba(255, 255, 255, 0.1);
}

:deep(.relationship-web-drawer .ant-drawer-body) {
  padding: 0;
  background: #0a0a0f;
}
</style>
