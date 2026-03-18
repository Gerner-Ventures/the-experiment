/**
 * useGameWorld — Vue composable wrapper around GameSession.
 *
 * Thin delegation layer that preserves the UseGameWorld interface.
 * All state, lifecycle, and logic live in GameSession.
 */

import type { MapTheme, MapData } from '@/types/world'
import type { CharacterSprite } from '@/config/character-sprites'
import type { RoundPhase } from '@/types/websocket'
import type { AgentSpriteObject } from '@/components/world/pixi/AgentSprite'
import { GameSession } from '@/game/GameSession'

export interface UseGameWorld {
  mount(container: HTMLElement): Promise<void>
  destroy(): void
  loadMap(theme: MapTheme, mapData: MapData): void

  spawnAgent(id: string, name: string, sprite: CharacterSprite, tile: { x: number; y: number }): void
  startDemo(): void

  centerOn(tileX: number, tileY: number): void
  setZoom(level: number): void

  /** Get agent sprite objects by ID (for pathfinding/position reads) */
  getAgents(): Map<string, AgentSpriteObject>
  moveAgentTo(id: string, tileX: number, tileY: number): void
  moveAgentAlongPath(id: string, path: { x: number; y: number }[], onComplete?: () => void): void
  playAction(id: string, animationName: string, onComplete: () => void): void

  highlightAgent(id: string, color: string): void
  clearHighlight(id: string): void
  onAgentClick(callback: (agentId: string) => void): void
  getAgentScreenPosition(id: string): { x: number; y: number } | null

  removeAgent(id: string): void

  setPhase(phase: RoundPhase): void
  startDemoCycle(): void
}

export function useGameWorld(): UseGameWorld {
  const session = new GameSession()

  return {
    mount: session.mount.bind(session),
    destroy: session.dispose.bind(session),
    loadMap: session.loadMap.bind(session),
    spawnAgent: session.spawnAgent.bind(session),
    startDemo: session.startDemo.bind(session),
    centerOn: session.centerOn.bind(session),
    setZoom: session.setZoom.bind(session),
    getAgents: session.getAgents.bind(session),
    moveAgentTo: session.moveAgentTo.bind(session),
    moveAgentAlongPath: session.moveAgentAlongPath.bind(session),
    playAction: session.playAction.bind(session),
    highlightAgent: session.highlightAgent.bind(session),
    clearHighlight: session.clearHighlight.bind(session),
    onAgentClick: session.onAgentClick.bind(session),
    getAgentScreenPosition: session.getAgentScreenPosition.bind(session),
    removeAgent: session.removeAgent.bind(session),
    setPhase: session.setPhase.bind(session),
    startDemoCycle: session.startDemoCycle.bind(session),
  }
}
