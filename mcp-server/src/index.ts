#!/usr/bin/env node
/**
 * bitECS MCP Server
 *
 * Provides tools for querying and working with the bitECS entity component
 * system in the-experiment frontend. Parses source files to extract component
 * definitions, system implementations, relations, and usage patterns.
 *
 * Tools:
 *   list-components     - List all ECS component definitions with fields
 *   list-systems        - List all ECS system implementations with status
 *   list-relations      - List all ECS relation definitions
 *   component-usage     - Find where a component is imported/used
 *   system-dependencies - Show which components a system reads/writes
 *   generate-component  - Generate boilerplate for a new component
 *   generate-system     - Generate boilerplate for a new system
 *   ecs-architecture    - Show the full ECS architecture overview
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// ─── Project paths ───

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..')
const FRONTEND_ROOT = path.join(PROJECT_ROOT, 'frontend')
const ECS_DIR = path.join(FRONTEND_ROOT, 'src', 'ecs')
const SYSTEMS_DIR = path.join(ECS_DIR, 'systems')
const COMPOSABLES_DIR = path.join(FRONTEND_ROOT, 'src', 'composables')

// ─── Source parsing helpers ───

async function readFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return ''
  }
}

async function findFiles(dir: string, pattern: RegExp): Promise<string[]> {
  const results: string[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...await findFiles(full, pattern))
      } else if (pattern.test(entry.name)) {
        results.push(full)
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return results
}

async function grepFiles(dir: string, pattern: RegExp, filePattern = /\.(ts|vue)$/): Promise<Array<{ file: string; line: number; text: string }>> {
  const results: Array<{ file: string; line: number; text: string }> = []
  const files = await findFiles(dir, filePattern)
  for (const file of files) {
    const content = await readFile(file)
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        results.push({
          file: path.relative(PROJECT_ROOT, file),
          line: i + 1,
          text: lines[i].trim(),
        })
      }
    }
  }
  return results
}

// ─── Component parsing ───

interface ComponentDef {
  name: string
  fields: Array<{ name: string; type: string }>
  category: 'active' | 'stub'
}

async function parseComponents(): Promise<ComponentDef[]> {
  const source = await readFile(path.join(ECS_DIR, 'components.ts'))
  if (!source) return []

  const components: ComponentDef[] = []

  // Determine which components are actively used in systems
  const systemFiles = await findFiles(SYSTEMS_DIR, /\.ts$/)
  const systemSource = (await Promise.all(systemFiles.map(f => readFile(f)))).join('\n')
  const gameWorldSource = await readFile(path.join(COMPOSABLES_DIR, 'useGameWorld.ts'))
  const activeSource = systemSource + gameWorldSource

  // Match plain object components: export const Name = { field: [] as number[], ... }
  // Uses multiline matching to capture the full object body
  const regex = /export\s+const\s+(\w+)\s*=\s*\{([^}]+)\}/g
  let match

  while ((match = regex.exec(source)) !== null) {
    const name = match[1]
    const body = match[2]

    // Skip non-component exports (STATUS_TYPES, etc.)
    if (!body.includes('[] as number[]')) continue

    const fields: Array<{ name: string; type: string }> = []
    const fieldRegex = /(\w+):\s*\[\]\s*as\s*(\w+)\[\]/g
    let fieldMatch
    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      fields.push({ name: fieldMatch[1], type: fieldMatch[2] })
    }

    const isActive = new RegExp(`\\b${name}\\b`).test(activeSource)
    components.push({ name, fields, category: isActive ? 'active' : 'stub' })
  }

  return components
}

// ─── Relation parsing ───

interface RelationDef {
  name: string
  modifiers: string[]
}

async function parseRelations(): Promise<RelationDef[]> {
  const source = await readFile(path.join(ECS_DIR, 'components.ts'))
  if (!source) return []

  const relations: RelationDef[] = []
  const regex = /export\s+const\s+(\w+)\s*=\s*createRelation\(([^)]*(?:\([^)]*\))*[^)]*)\)/g
  let match

  while ((match = regex.exec(source)) !== null) {
    const name = match[1]
    const modifierStr = match[2]
    const modifiers = modifierStr
      .split(',')
      .map(m => m.trim())
      .filter(Boolean)
    relations.push({ name, modifiers })
  }

  return relations
}

// ─── System parsing ───

interface SystemDef {
  name: string
  file: string
  reads: string[]
  writes: string[]
  sideEffects: string[]
  lines: number
}

async function parseSystems(): Promise<SystemDef[]> {
  const systems: SystemDef[] = []
  const files = await findFiles(SYSTEMS_DIR, /System\.ts$/)

  for (const file of files) {
    const source = await readFile(file)
    const basename = path.basename(file, '.ts')

    // Extract function name
    const funcMatch = source.match(/export\s+function\s+(\w+)/)
    const name = funcMatch ? funcMatch[1] : basename

    // Find component imports
    const importMatch = source.match(/import\s+\{([^}]+)\}\s+from\s+['"]\.\.\/components['"]/)
    const imports = importMatch
      ? importMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : []

    // Heuristic: reads vs writes
    const reads: string[] = []
    const writes: string[] = []
    const sideEffects: string[] = []

    for (const comp of imports) {
      // Check for writes: Component.field[eid] = ...
      if (new RegExp(`${comp}\\.\\w+\\[\\w+\\]\\s*=`).test(source)) {
        writes.push(comp)
      }
      // Check for reads: Component.field[eid] (not followed by =)
      if (new RegExp(`${comp}\\.\\w+\\[`).test(source)) {
        reads.push(comp)
      }
    }

    // Check for side effects (bridge calls, console, etc.)
    if (/bridge\.\w+/.test(source)) sideEffects.push('RenderBridge')
    if (/removeComponent/.test(source)) sideEffects.push('removeComponent')

    systems.push({
      name,
      file: path.relative(PROJECT_ROOT, file),
      reads: [...new Set(reads)],
      writes: [...new Set(writes)],
      sideEffects,
      lines: source.split('\n').length,
    })
  }

  return systems
}

// ─── Tool implementations ───

async function listComponents(filter?: string): Promise<string> {
  const components = await parseComponents()
  const filtered = filter
    ? components.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
    : components

  if (filtered.length === 0) return 'No components found.'

  const active = filtered.filter(c => c.category === 'active')
  const stubs = filtered.filter(c => c.category === 'stub')

  let out = '## Active Components (wired to systems)\n\n'
  for (const c of active) {
    out += `### ${c.name}\n`
    out += `Fields: ${c.fields.map(f => `${f.name}: ${f.type}`).join(', ') || 'none'}\n\n`
  }

  if (stubs.length > 0) {
    out += '## Stub Components (defined, not yet wired)\n\n'
    for (const c of stubs) {
      out += `### ${c.name}\n`
      out += `Fields: ${c.fields.map(f => `${f.name}: ${f.type}`).join(', ') || 'none'}\n\n`
    }
  }

  return out
}

async function listSystems(filter?: string): Promise<string> {
  const systems = await parseSystems()
  const filtered = filter
    ? systems.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()))
    : systems

  if (filtered.length === 0) return 'No systems found.'

  let out = '## ECS Systems\n\n'
  out += 'Execution order: pathfindingSystem -> movementSystem -> animationSystem -> renderSyncSystem\n\n'

  for (const s of filtered) {
    out += `### ${s.name}\n`
    out += `File: ${s.file} (${s.lines} lines)\n`
    out += `Reads: ${s.reads.join(', ') || 'none'}\n`
    out += `Writes: ${s.writes.join(', ') || 'none'}\n`
    out += `Side effects: ${s.sideEffects.join(', ') || 'none'}\n\n`
  }

  return out
}

async function listRelations(): Promise<string> {
  const relations = await parseRelations()
  if (relations.length === 0) return 'No relations found.'

  let out = '## ECS Relations\n\n'
  for (const r of relations) {
    out += `### ${r.name}\n`
    out += `Modifiers: ${r.modifiers.join(', ') || 'none'}\n\n`
  }

  return out
}

async function componentUsage(componentName: string): Promise<string> {
  const srcDir = path.join(FRONTEND_ROOT, 'src')
  const testDir = path.join(FRONTEND_ROOT, 'tests')

  const pattern = new RegExp(`\\b${componentName}\\b`)
  const srcResults = await grepFiles(srcDir, pattern)
  const testResults = await grepFiles(testDir, pattern)

  if (srcResults.length === 0 && testResults.length === 0) {
    return `No usages of "${componentName}" found.`
  }

  let out = `## Usage of ${componentName}\n\n`

  if (srcResults.length > 0) {
    out += `### Source (${srcResults.length} references)\n\n`
    for (const r of srcResults) {
      out += `- \`${r.file}:${r.line}\`: ${r.text}\n`
    }
    out += '\n'
  }

  if (testResults.length > 0) {
    out += `### Tests (${testResults.length} references)\n\n`
    for (const r of testResults) {
      out += `- \`${r.file}:${r.line}\`: ${r.text}\n`
    }
  }

  return out
}

async function systemDependencies(systemName: string): Promise<string> {
  const systems = await parseSystems()
  const system = systems.find(s =>
    s.name.toLowerCase() === systemName.toLowerCase()
    || s.name.toLowerCase().includes(systemName.toLowerCase()),
  )

  if (!system) {
    return `System "${systemName}" not found. Available: ${systems.map(s => s.name).join(', ')}`
  }

  let out = `## ${system.name} Dependencies\n\n`
  out += `File: ${system.file}\n\n`
  out += `### Reads\n${system.reads.map(r => `- ${r}`).join('\n') || 'None'}\n\n`
  out += `### Writes\n${system.writes.map(w => `- ${w}`).join('\n') || 'None'}\n\n`
  out += `### Side Effects\n${system.sideEffects.map(s => `- ${s}`).join('\n') || 'None'}\n\n`

  // Find other systems that share components
  const shared = systems.filter(s =>
    s.name !== system.name
    && (s.reads.some(r => system.writes.includes(r)) || s.writes.some(w => system.reads.includes(w))),
  )

  if (shared.length > 0) {
    out += `### Data Dependencies\n`
    for (const s of shared) {
      const sharedReads = s.reads.filter(r => system.writes.includes(r))
      const sharedWrites = s.writes.filter(w => system.reads.includes(w))
      if (sharedReads.length > 0) out += `- ${s.name} reads what this writes: ${sharedReads.join(', ')}\n`
      if (sharedWrites.length > 0) out += `- ${s.name} writes what this reads: ${sharedWrites.join(', ')}\n`
    }
  }

  return out
}

function generateComponent(componentName: string, properties?: Record<string, string>): string {
  const fields = properties
    ? Object.entries(properties).map(([name, type]) => `  ${name}: Types.${type},`).join('\n')
    : '  value: Types.f32,'

  const code = `// Add to frontend/src/ecs/components.ts:

export const ${componentName} = defineComponent({
${fields}
})

// Then register in frontend/src/ecs/world.ts:
// registerComponents(world, [/* existing */, ${componentName}])
`

  const testCode = `// Test in frontend/tests/unit/ecs/${componentName.toLowerCase()}.spec.ts:

import { createWorld, addEntity, addComponent } from 'bitecs'
import { ${componentName} } from '@/ecs/components'

describe('${componentName} component', () => {
  it('stores values on entity', () => {
    const world = createWorld()
    const eid = addEntity(world)
    addComponent(world, eid, ${componentName})

${properties ? Object.entries(properties).map(([name]) =>
    `    ${componentName}.${name}[eid] = 42\n    expect(${componentName}.${name}[eid]).toBe(42)`
  ).join('\n\n') : `    ${componentName}.value[eid] = 42\n    expect(${componentName}.value[eid]).toBe(42)`}
  })
})
`

  return `## Generated Component: ${componentName}\n\n### Component Definition\n\n\`\`\`typescript\n${code}\`\`\`\n\n### Test\n\n\`\`\`typescript\n${testCode}\`\`\``
}

function generateSystem(systemName: string, components: string[]): string {
  const funcName = systemName.endsWith('System') ? systemName : `${systemName}System`
  const fileName = funcName.charAt(0).toLowerCase() + funcName.slice(1)
  const imports = components.join(', ')

  const code = `// Create frontend/src/ecs/systems/${fileName}.ts:

import { query, type World } from 'bitecs'
import { ${imports} } from '../components'

/**
 * ${funcName}
 *
 * Runs every tick. Reads: ${components.join(', ')}.
 */
export function ${funcName}(world: World, dt: number): void {
  const entities = query(world, [${imports}])

  for (const eid of entities) {
    // TODO: Implement system logic
    // Example: const val = ${components[0]}.${components[0].charAt(0).toLowerCase()}[eid]
  }
}
`

  const integrationNote = `
// Add to tick loop in frontend/src/composables/useGameWorld.ts:
// (respect execution order — renderSyncSystem must be last)
//
// pathfindingSystem(world, dt)
// movementSystem(world, dt)
// ${funcName}(world, dt)       // <-- insert based on data dependencies
// animationSystem(world, dt)
// renderSyncSystem(world, dt)
`

  const testCode = `// Test in frontend/tests/unit/ecs/${fileName}.spec.ts:

import { createWorld, addEntity, addComponent, registerComponents } from 'bitecs'
import { ${imports} } from '@/ecs/components'
import { ${funcName} } from '@/ecs/systems/${fileName}'

describe('${funcName}', () => {
  it('processes entities with required components', () => {
    const world = createWorld()
    registerComponents(world, [${imports}])
    const eid = addEntity(world)
${components.map(c => `    addComponent(world, eid, ${c})`).join('\n')}

    // Set initial values
    // TODO: Set component values

    ${funcName}(world, 1 / 60)

    // Assert expected changes
    // TODO: Verify system effects
  })
})
`

  return `## Generated System: ${funcName}\n\n### System Implementation\n\n\`\`\`typescript\n${code}\`\`\`\n\n### Integration\n\n\`\`\`typescript\n${integrationNote}\`\`\`\n\n### Test\n\n\`\`\`typescript\n${testCode}\`\`\``
}

async function ecsArchitecture(): Promise<string> {
  const components = await parseComponents()
  const systems = await parseSystems()
  const relations = await parseRelations()

  let out = `# ECS Architecture Overview

## Stack
- **bitECS** 0.4.0 — Entity Component System library
- **useGameWorld.ts** — Composable that owns world lifecycle
- **useRenderer.ts** — PixiJS backend with RenderBridge

## Entity Count
- Target: 10-50 agents per experiment
- Each agent = 1 ECS entity with Position, AgentId, SpriteRef (minimum)

## Components (${components.length} total)
- Active: ${components.filter(c => c.category === 'active').map(c => c.name).join(', ')}
- Stub: ${components.filter(c => c.category === 'stub').map(c => c.name).join(', ')}

## Relations (${relations.length} total)
${relations.map(r => `- ${r.name} (${r.modifiers.join(', ')})`).join('\n')}

## Systems (${systems.length} total, execution order)
${systems.map((s, i) => `${i + 1}. ${s.name} — reads: [${s.reads.join(', ')}], writes: [${s.writes.join(', ')}]`).join('\n')}

## Data Flow
\`\`\`
Pinia Stores (Vue)
    |
    v
useGameWorld.ts
    |-- spawnAgent()     -> addEntity + Position + AgentId + SpriteRef
    |-- moveAgentAlongPath() -> set PathState
    |-- playAction()     -> set AnimState
    |
    v
Tick Loop (~60fps)
    |-- pathfindingSystem  -> advance waypoints
    |-- movementSystem     -> lerp tile->screen
    |-- animationSystem    -> advance frames
    |-- renderSyncSystem   -> push to PixiJS
    |
    v
PixiJS Sprites (canvas)
\`\`\`

## Key Files
| File | Purpose |
|------|---------|
| frontend/src/ecs/components.ts | Component + relation definitions |
| frontend/src/ecs/world.ts | World creation |
| frontend/src/ecs/systems/*.ts | System implementations |
| frontend/src/composables/useGameWorld.ts | World lifecycle, entity management |
| frontend/src/composables/useRenderer.ts | PixiJS backend, sprite pool |
`

  return out
}

// ─── Server setup ───

const server = new Server(
  { name: 'bitecs-tools', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list-components',
      description: 'List all ECS component definitions with their fields and active/stub status',
      inputSchema: {
        type: 'object' as const,
        properties: {
          filter: { type: 'string', description: 'Optional name filter' },
        },
      },
    },
    {
      name: 'list-systems',
      description: 'List all ECS system implementations with reads/writes/side effects',
      inputSchema: {
        type: 'object' as const,
        properties: {
          filter: { type: 'string', description: 'Optional name filter' },
        },
      },
    },
    {
      name: 'list-relations',
      description: 'List all ECS relation definitions with their modifiers',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'component-usage',
      description: 'Find all files where a component is imported or referenced',
      inputSchema: {
        type: 'object' as const,
        properties: {
          componentName: { type: 'string', description: 'Component name to search for' },
        },
        required: ['componentName'],
      },
    },
    {
      name: 'system-dependencies',
      description: 'Show which components a system reads/writes and its data dependencies with other systems',
      inputSchema: {
        type: 'object' as const,
        properties: {
          systemName: { type: 'string', description: 'System name to analyze' },
        },
        required: ['systemName'],
      },
    },
    {
      name: 'generate-component',
      description: 'Generate boilerplate code for a new ECS component with test',
      inputSchema: {
        type: 'object' as const,
        properties: {
          componentName: { type: 'string', description: 'PascalCase component name' },
          properties: {
            type: 'object',
            description: 'Component fields as { name: bitECS_type }. Types: f32, f64, u8, u16, u32, i8, i16, i32',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['componentName'],
      },
    },
    {
      name: 'generate-system',
      description: 'Generate boilerplate code for a new ECS system with test and integration notes',
      inputSchema: {
        type: 'object' as const,
        properties: {
          systemName: { type: 'string', description: 'System name (e.g. "mood" or "moodSystem")' },
          components: {
            type: 'array',
            items: { type: 'string' },
            description: 'Component names this system operates on',
          },
        },
        required: ['systemName', 'components'],
      },
    },
    {
      name: 'ecs-architecture',
      description: 'Show the full ECS architecture overview including all components, systems, relations, and data flow',
      inputSchema: { type: 'object' as const, properties: {} },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    let result: string

    switch (name) {
      case 'list-components':
        result = await listComponents(args?.filter as string | undefined)
        break
      case 'list-systems':
        result = await listSystems(args?.filter as string | undefined)
        break
      case 'list-relations':
        result = await listRelations()
        break
      case 'component-usage':
        result = await componentUsage(args?.componentName as string)
        break
      case 'system-dependencies':
        result = await systemDependencies(args?.systemName as string)
        break
      case 'generate-component':
        result = generateComponent(
          args?.componentName as string,
          args?.properties as Record<string, string> | undefined,
        )
        break
      case 'generate-system':
        result = generateSystem(
          args?.systemName as string,
          (args?.components as string[]) ?? [],
        )
        break
      case 'ecs-architecture':
        result = await ecsArchitecture()
        break
      default:
        result = `Unknown tool: ${name}`
    }

    return { content: [{ type: 'text', text: result }] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
  }
})

// ─── Start ───

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[bitecs-mcp] Server started')
}

main().catch(console.error)
