import type { PersonalityAxes, GoalArchetype } from '@/types/agent'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers as Record<string, string> },
    ...options,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API ${res.status}: ${body}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

export interface AgentCreatePayload {
  name: string
  character_id?: string
  personality: {
    axes: PersonalityAxes
    trait_tags: string[]
    self_concept?: string
  }
  goal: {
    archetype: GoalArchetype | string
    text: string
    target_agent_id?: string
    target_location_id?: string
    progress_signals?: string[]
  }
  llm_model?: string
  location?: string
  inventory?: string[]
}

export interface CreateExperimentPayload {
  name: string
  agents: AgentCreatePayload[]
  preset_arc_id?: string
  total_rounds?: number
  auto_approve?: boolean
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface ExperimentSummary {
  experiment_id: string
  experiment_name: string
  status: string
  current_round: number
  total_rounds: number
  auto_approve: boolean
  world_state: Record<string, unknown>
}

export interface ExperimentDetail extends ExperimentSummary {
  arc: Record<string, unknown>
  agents: Array<Record<string, unknown>>
  gm_plan: Record<string, unknown> | null
  unresolved_plotlines: string[]
}

export interface StepResponse {
  round_result: Record<string, unknown>
  experiment: ExperimentDetail
}

export interface EventLogItem {
  id: string
  experiment_id: string
  round_number: number | null
  phase: string | null
  agent_id: string | null
  type: string
  summary: string
  data: Record<string, unknown>
  timestamp: string
}

export interface EventLogPage {
  items: EventLogItem[]
  total: number
  limit: number
  offset: number
}

export interface GMPlanRecord {
  plan: Record<string, unknown>
  approved: boolean
  modified: boolean
}

// ---------------------------------------------------------------------------
// API client — all paths prefixed with /api/experiments
// ---------------------------------------------------------------------------

const BASE = '/api/experiments'

export const api = {
  // Experiment lifecycle
  createExperiment(payload: CreateExperimentPayload): Promise<ExperimentDetail> {
    return request(`${BASE}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  getExperiment(id: string): Promise<ExperimentDetail> {
    return request(`${BASE}/${id}`)
  },

  startExperiment(id: string): Promise<ExperimentSummary> {
    return request(`${BASE}/${id}/start`, { method: 'POST' })
  },

  pauseExperiment(id: string): Promise<ExperimentSummary> {
    return request(`${BASE}/${id}/pause`, { method: 'POST' })
  },

  stepRound(id: string): Promise<StepResponse> {
    return request(`${BASE}/${id}/step`, { method: 'POST' })
  },

  // GM plan
  getGMPlan(id: string): Promise<GMPlanRecord> {
    return request(`${BASE}/${id}/gm/plan`)
  },

  approvePlan(id: string, modifiedPlan?: Record<string, unknown>): Promise<GMPlanRecord> {
    return request(`${BASE}/${id}/gm/approve`, {
      method: 'POST',
      body: JSON.stringify({ modified_plan: modifiedPlan ?? null }),
    })
  },

  // Arc
  updateArc(id: string, arc: Record<string, unknown>): Promise<ExperimentDetail> {
    return request(`${BASE}/${id}/arc`, {
      method: 'PUT',
      body: JSON.stringify({ arc }),
    })
  },

  // Observer events
  injectEvent(id: string, description: string): Promise<ExperimentDetail> {
    return request(`${BASE}/${id}/inject`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    })
  },

  // Agents
  listAgents(id: string): Promise<Array<Record<string, unknown>>> {
    return request(`${BASE}/${id}/agents`)
  },

  getAgentDossier(experimentId: string, agentId: string): Promise<Record<string, unknown>> {
    return request(`${BASE}/${experimentId}/agents/${agentId}/dossier`)
  },

  // Event log
  getEventLog(
    id: string,
    params?: {
      limit?: number
      offset?: number
      phase?: string
      event_type?: string
      agent_id?: string
      round_number?: number
    },
  ): Promise<EventLogPage> {
    const query = new URLSearchParams()
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          query.set(key, String(value))
        }
      }
    }
    const qs = query.toString()
    return request(`${BASE}/${id}/log${qs ? `?${qs}` : ''}`)
  },

  // WebSocket
  getWebSocketUrl(id: string): string {
    const wsBase = API_BASE.replace(/^http/, 'ws')
    return `${wsBase}${BASE}/${id}/ws`
  },
}
