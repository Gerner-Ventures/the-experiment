/** Resource pressure level for an act */
export type ResourcePressure = 'low' | 'medium' | 'high' | 'critical'

/** A single act within a narrative arc */
export interface Act {
  name: string
  startRound: number
  endRound: number
  tone: string
  gmInstructions: string
  resourcePressure: ResourcePressure
  directorNotes?: string
}

/** Player-defined narrative arc (matches shared/schemas/arc.json) */
export interface Arc {
  name: string
  description?: string
  acts: Act[]
}
