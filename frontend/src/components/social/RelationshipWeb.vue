<script setup lang="ts">
import { ref, watch } from 'vue'
import { Drawer } from 'ant-design-vue'
import { useElementSize } from '@vueuse/core'
import { useForceGraph, type ForceGraphNode, type ForceGraphLink } from '@/composables/useForceGraph'
import { useUIStore } from '@/stores/ui'
import { useLocale } from '@/locales'
import { getSpriteById, renderSpriteToCanvas, SPRITE_W as RAW_SPRITE_W, SPRITE_H as RAW_SPRITE_H, SPRITE_SCALE } from '@/config/character-sprites'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const locale = useLocale()
const uiStore = useUIStore()

const svgContainer = ref<HTMLElement | null>(null)
const { width, height } = useElementSize(svgContainer)
const { nodes, links, buildGraph, pause, resume, onDragStart, onDragMove, onDragEnd } = useForceGraph(width, height)

const hoveredNode = ref<string | null>(null)
let draggingNode: ForceGraphNode | null = null

/** Uniform display size for all agent sprites in the graph */
const DISPLAY_W = RAW_SPRITE_W * SPRITE_SCALE
const DISPLAY_H = RAW_SPRITE_H * SPRITE_SCALE

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

const hoveredLink = ref<ForceGraphLink | null>(null)

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

// Build graph when drawer opens and container has width
watch(() => width.value, (w) => {
  if (w > 0) buildGraph()
}, { immediate: true, once: true })

// Pause simulation when drawer is closed, resume when opened
watch(() => props.visible, (isVisible) => {
  if (isVisible) {
    resume()
  } else {
    pause()
  }
})
</script>

<template>
  <Drawer
    :open="visible"
    placement="right"
    :width="640"
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
        <g
          v-for="(link, i) in links"
          :key="'link-' + i"
          @mouseenter="hoveredLink = link"
          @mouseleave="hoveredLink = null"
        >
          <line
            :x1="linkSource(link).x"
            :y1="linkSource(link).y"
            :x2="linkTarget(link).x"
            :y2="linkTarget(link).y"
            :stroke="link.color"
            :stroke-width="hoveredLink === link ? link.thickness + 2 : link.thickness"
            :stroke-dasharray="link.dashed ? '6 3' : undefined"
            :opacity="hoveredLink === link ? 1 : 0.6"
            class="transition-opacity"
          />
          <!-- Trust label on hover -->
          <text
            v-if="hoveredLink === link"
            :x="((linkSource(link).x ?? 0) + (linkTarget(link).x ?? 0)) / 2"
            :y="((linkSource(link).y ?? 0) + (linkTarget(link).y ?? 0)) / 2 - 6"
            text-anchor="middle"
            fill="white"
            font-family="'JetBrains Mono Variable', monospace"
            font-size="10"
            font-weight="bold"
          >
            {{ link.trust > 0 ? '+' : '' }}{{ Math.round(link.trust) }}
          </text>
        </g>

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
            :r="Math.max(DISPLAY_W, DISPLAY_H) / 2 + 6"
            :fill="node.color"
            :opacity="hoveredNode === node.id ? 0.35 : 0.15"
          />
          <!-- Sprite image -->
          <image
            v-if="getSpriteDataUrl(node.characterId)"
            :href="getSpriteDataUrl(node.characterId)"
            :x="-DISPLAY_W / 2"
            :y="-DISPLAY_H / 2"
            :width="DISPLAY_W"
            :height="DISPLAY_H"
            image-rendering="pixelated"
            :opacity="hoveredNode === node.id ? 1 : 0.9"
          />
          <!-- Hover outline -->
          <rect
            v-if="hoveredNode === node.id"
            :x="-DISPLAY_W / 2 - 2"
            :y="-DISPLAY_H / 2 - 2"
            :width="DISPLAY_W + 4"
            :height="DISPLAY_H + 4"
            fill="none"
            stroke="white"
            stroke-width="1"
            opacity="0.6"
          />
          <!-- Name label -->
          <text
            :y="DISPLAY_H / 2 + 14"
            text-anchor="middle"
            fill="rgba(255,255,255,0.8)"
            font-family="'JetBrains Mono Variable', monospace"
            font-size="11"
            font-weight="bold"
          >
            {{ node.name }}
          </text>
          <!-- Relationship count badge -->
          <text
            v-if="node.relationshipCount > 0"
            :y="-DISPLAY_H / 2 - 6"
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
