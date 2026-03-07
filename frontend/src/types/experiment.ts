import type { Agent } from './agent'
import type { Arc } from './arc'

/** Experiment lifecycle status */
export type ExperimentStatus = 'setup' | 'running' | 'paused' | 'completed' | 'collapsed'

/** Shared resource pool for the town */
export interface Resources {
  food: number
  water: number
  materials: number
  power: number
}

/** Full experiment state (matches shared/schemas/experiment.json) */
export interface Experiment {
  id: string
  name: string
  status: ExperimentStatus
  currentRound: number
  totalRounds: number
  threatLevel: number // 0-100
  resources: Resources
  arc: Arc
  agents: Agent[]
}
