import { ref, watch, onUnmounted, triggerRef, type Ref } from 'vue'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import { useAgentStore } from '@/stores/agent'
import type { GoalArchetype } from '@/types/agent'
import {
  ARCHETYPE_COLORS,
  FORCE_CONFIG,
  trustToColor,
  interactionThickness,
} from '@/config/relationship-web'

export interface ForceGraphNode extends SimulationNodeDatum {
  id: string
  name: string
  characterId: string
  archetype: GoalArchetype
  color: string
  relationshipCount: number
}

export interface ForceGraphLink extends SimulationLinkDatum<ForceGraphNode> {
  source: string | ForceGraphNode
  target: string | ForceGraphNode
  trust: number
  color: string
  thickness: number
  dashed: boolean
  interactionCount: number
}

export function useForceGraph(containerWidth: Ref<number>, containerHeight: Ref<number>) {
  const agentStore = useAgentStore()
  const nodes = ref<ForceGraphNode[]>([])
  const links = ref<ForceGraphLink[]>([])

  let simulation: Simulation<ForceGraphNode, ForceGraphLink> | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function buildGraph() {
    const agents = agentStore.agentList
    if (agents.length === 0) {
      nodes.value = []
      links.value = []
      return
    }

    console.debug('[RelationshipWeb] Building graph from', agents.length, 'agents')

    // Build nodes, preserving existing positions
    const oldNodes = new Map(nodes.value.map(n => [n.id, n]))
    const newNodes: ForceGraphNode[] = agents.map(agent => {
      const relCount = Object.keys(agent.relationships).length
      const old = oldNodes.get(agent.id)
      return {
        id: agent.id,
        name: agent.name,
        characterId: agent.characterId,
        archetype: agent.secretGoal.archetype,
        color: ARCHETYPE_COLORS[agent.secretGoal.archetype] ?? '#555863',
        relationshipCount: relCount,
        x: old?.x ?? containerWidth.value / 2 + (Math.random() - 0.5) * 100,
        y: old?.y ?? containerHeight.value / 2 + (Math.random() - 0.5) * 100,
      }
    })

    // Build links — deduplicate bidirectional relationships
    const linkMap = new Map<string, ForceGraphLink>()
    for (const agent of agents) {
      for (const [targetId, rel] of Object.entries(agent.relationships)) {
        const key = [agent.id, targetId].sort().join('::')
        const existing = linkMap.get(key)
        if (existing) {
          // Average trust, max interaction count
          existing.trust = (existing.trust + rel.trust) / 2
          existing.interactionCount = Math.max(existing.interactionCount, rel.history.length)
          existing.color = trustToColor(existing.trust)
          existing.thickness = interactionThickness(existing.interactionCount)
          existing.dashed = existing.trust < 0
        } else {
          linkMap.set(key, {
            source: agent.id,
            target: targetId,
            trust: rel.trust,
            color: trustToColor(rel.trust),
            thickness: interactionThickness(rel.history.length),
            dashed: rel.trust < 0,
            interactionCount: rel.history.length,
          })
        }
      }
    }

    const newLinks = Array.from(linkMap.values())
    console.debug('[RelationshipWeb] Graph:', newNodes.length, 'nodes,', newLinks.length, 'links')

    nodes.value = newNodes
    links.value = newLinks

    restartSimulation()
  }

  function restartSimulation() {
    if (simulation) {
      simulation.stop()
    }

    const w = containerWidth.value || 500
    const h = containerHeight.value || 400

    simulation = forceSimulation<ForceGraphNode>(nodes.value)
      .force('charge', forceManyBody().strength(FORCE_CONFIG.chargeStrength))
      .force('link', forceLink<ForceGraphNode, ForceGraphLink>(links.value)
        .id(d => d.id)
        .distance(FORCE_CONFIG.linkDistance))
      .force('center', forceCenter(w / 2, h / 2).strength(FORCE_CONFIG.centerStrength))
      .force('collide', forceCollide<ForceGraphNode>().radius(d => {
        // Sprite-based sizing: base 2x + 0.5 per relationship, sprite is 18px tall
        const scale = 2 + Math.min(3, d.relationshipCount * 0.5)
        return 18 * scale / 2 + 8
      }))
      .alphaDecay(FORCE_CONFIG.alphaDecay)
      .on('tick', () => {
        // Trigger reactivity without allocating new arrays — d3-force mutates in place
        triggerRef(nodes)
        triggerRef(links)
      })
  }

  function nudge() {
    if (simulation) {
      simulation.alpha(FORCE_CONFIG.alphaNudge).restart()
    }
  }

  // Drag handlers
  function onDragStart(node: ForceGraphNode) {
    if (simulation) simulation.alphaTarget(0.3).restart()
    node.fx = node.x
    node.fy = node.y
  }

  function onDragMove(node: ForceGraphNode, x: number, y: number) {
    node.fx = x
    node.fy = y
  }

  function onDragEnd(node: ForceGraphNode) {
    if (simulation) simulation.alphaTarget(FORCE_CONFIG.alphaTarget)
    node.fx = null
    node.fy = null
  }

  // Watch agent data with debounce
  watch(() => agentStore.agentList, () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      buildGraph()
      nudge()
    }, 300)
  }, { deep: true })

  // Watch container size
  watch([containerWidth, containerHeight], () => {
    if (simulation) {
      const centerForce = simulation.force('center') as ReturnType<typeof forceCenter> | undefined
      if (centerForce) {
        centerForce.x(containerWidth.value / 2).y(containerHeight.value / 2)
      }
      nudge()
    }
  })

  function destroy() {
    if (simulation) {
      simulation.stop()
      simulation = null
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  onUnmounted(destroy)

  return {
    nodes,
    links,
    buildGraph,
    restart: restartSimulation,
    onDragStart,
    onDragMove,
    onDragEnd,
    destroy,
  }
}
