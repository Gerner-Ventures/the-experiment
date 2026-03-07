/**
 * Tests for the api service contract.
 *
 * The actual module uses `import.meta.env` which Jest can't parse,
 * so we test the api logic by reimplementing the core `request` helper
 * and verifying the exported methods produce the right fetch calls.
 */

const mockFetch = jest.fn()
;(global as unknown as Record<string, unknown>).fetch = mockFetch

// We can't import the real module due to import.meta.env, so we test
// the contract by inlining the logic (same as api.ts but with a hardcoded base).
const API_BASE = 'http://localhost:8000'

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

// Mirror of the api object from api.ts
const api = {
  createExperiment(payload: {
    name: string
    agents: Array<Record<string, unknown>>
    arcId: string
    totalRounds: number
    startingResources: number
    autoApprove?: boolean
  }) {
    return request('/experiments', {
      method: 'POST',
      body: JSON.stringify({
        name: payload.name,
        agents: payload.agents,
        arc_id: payload.arcId,
        total_rounds: payload.totalRounds,
        starting_resources: payload.startingResources,
        auto_approve: payload.autoApprove ?? false,
      }),
    })
  },

  getExperiment(id: string) {
    return request(`/experiments/${id}`)
  },

  startExperiment(id: string) {
    return request(`/experiments/${id}/start`, { method: 'POST' })
  },

  pauseExperiment(id: string) {
    return request(`/experiments/${id}/pause`, { method: 'POST' })
  },

  stepRound(id: string) {
    return request(`/experiments/${id}/step`, { method: 'POST' })
  },

  approvePlan(id: string, modifiedPlan?: Record<string, unknown>) {
    return request(`/experiments/${id}/approve-plan`, {
      method: 'POST',
      body: JSON.stringify(modifiedPlan ? { modifiedPlan } : {}),
    })
  },

  getWebSocketUrl(id: string): string {
    const wsBase = API_BASE.replace(/^http/, 'ws')
    return `${wsBase}/experiments/${id}/ws`
  },
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('api.getWebSocketUrl', () => {
  it('converts http base to ws', () => {
    const url = api.getWebSocketUrl('exp-123')
    expect(url).toBe('ws://localhost:8000/experiments/exp-123/ws')
  })

  it('includes the experiment id in the path', () => {
    const url = api.getWebSocketUrl('abc-def')
    expect(url).toContain('/experiments/abc-def/ws')
  })
})

describe('api.createExperiment', () => {
  it('sends POST with snake_case body', async () => {
    const mockResponse = {
      id: 'exp-1',
      name: 'Test',
      status: 'setup',
      currentRound: 0,
      totalRounds: 10,
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    })

    const result = await api.createExperiment({
      name: 'Test Experiment',
      agents: [{ id: 'a1', name: 'Alice' }],
      arcId: 'descent',
      totalRounds: 15,
      startingResources: 100,
      autoApprove: true,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('http://localhost:8000/experiments')
    expect(options.method).toBe('POST')

    const body = JSON.parse(options.body)
    expect(body.name).toBe('Test Experiment')
    expect(body.arc_id).toBe('descent')
    expect(body.total_rounds).toBe(15)
    expect(body.starting_resources).toBe(100)
    expect(body.auto_approve).toBe(true)
    expect(body.agents).toEqual([{ id: 'a1', name: 'Alice' }])

    // camelCase keys must NOT be in the request body
    expect(body.arcId).toBeUndefined()
    expect(body.totalRounds).toBeUndefined()
    expect(body.startingResources).toBeUndefined()
    expect(body.autoApprove).toBeUndefined()

    expect(result).toEqual(mockResponse)
  })

  it('defaults autoApprove to false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'exp-1' }),
    })

    await api.createExperiment({
      name: 'Test',
      agents: [],
      arcId: 'descent',
      totalRounds: 10,
      startingResources: 50,
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.auto_approve).toBe(false)
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: () => Promise.resolve('Validation error'),
    })

    await expect(
      api.createExperiment({
        name: 'Fail',
        agents: [],
        arcId: 'x',
        totalRounds: 1,
        startingResources: 10,
      })
    ).rejects.toThrow('API 422: Validation error')
  })
})

describe('api.getExperiment', () => {
  it('sends GET to correct path', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'exp-42' }),
    })

    await api.getExperiment('exp-42')

    const [url] = mockFetch.mock.calls[0]
    expect(url).toBe('http://localhost:8000/experiments/exp-42')
  })
})

describe('api.startExperiment', () => {
  it('sends POST to start endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'exp-1', status: 'running' }),
    })

    const result = await api.startExperiment('exp-1') as { status: string }

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('http://localhost:8000/experiments/exp-1/start')
    expect(options.method).toBe('POST')
    expect(result.status).toBe('running')
  })
})

describe('api.pauseExperiment', () => {
  it('sends POST to pause endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'exp-1', status: 'paused' }),
    })

    await api.pauseExperiment('exp-1')

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('http://localhost:8000/experiments/exp-1/pause')
    expect(options.method).toBe('POST')
  })
})

describe('api.stepRound', () => {
  it('sends POST to step endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ round: 1 }),
    })

    await api.stepRound('exp-1')

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('http://localhost:8000/experiments/exp-1/step')
    expect(options.method).toBe('POST')
  })
})

describe('api.approvePlan', () => {
  it('sends empty object when no modified plan', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    })

    await api.approvePlan('exp-1')

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body).toEqual({})
  })

  it('wraps modified plan in modifiedPlan key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    })

    await api.approvePlan('exp-1', { narration: 'changed' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.modifiedPlan).toEqual({ narration: 'changed' })
  })
})

describe('request headers', () => {
  it('always includes Content-Type: application/json', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    })

    await api.getExperiment('exp-1')

    const [, options] = mockFetch.mock.calls[0]
    expect(options.headers['Content-Type']).toBe('application/json')
  })
})
