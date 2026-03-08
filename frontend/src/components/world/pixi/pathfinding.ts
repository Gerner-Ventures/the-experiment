/** BFS pathfinding on a 2D grid of walkable tiles */

interface Point {
  x: number
  y: number
}

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const

function key(x: number, y: number): string {
  return `${x},${y}`
}

/**
 * Find shortest path from start to end using BFS over walkable tiles.
 * Returns array of tiles to walk through (excluding start, including end),
 * or null if no path exists.
 */
export function findPath(
  start: Point,
  end: Point,
  isWalkable: (x: number, y: number) => boolean,
  maxVisited = 1000,
): Point[] | null {
  if (start.x === end.x && start.y === end.y) return []

  const visited = new Set<string>()
  const parent = new Map<string, Point>()
  const queue: Point[] = [start]
  let head = 0
  // Start tile is always valid (agent is standing on it)
  visited.add(key(start.x, start.y))

  while (head < queue.length) {
    if (visited.size >= maxVisited) {
      console.debug(`[Pathfinding] Exceeded max visited (${maxVisited}) from (${start.x},${start.y}) to (${end.x},${end.y})`)
      return null
    }

    const curr = queue[head++]

    for (const [dx, dy] of DIRS) {
      const nx = curr.x + dx
      const ny = curr.y + dy
      const nk = key(nx, ny)

      if (visited.has(nk)) continue
      if (!isWalkable(nx, ny)) continue

      visited.add(nk)
      parent.set(nk, curr)

      if (nx === end.x && ny === end.y) {
        // Reconstruct path (start excluded, end included)
        const path: Point[] = []
        let p: Point = { x: nx, y: ny }
        while (p.x !== start.x || p.y !== start.y) {
          path.push(p)
          p = parent.get(key(p.x, p.y))!
        }
        path.reverse()
        return path
      }

      queue.push({ x: nx, y: ny })
    }
  }

  return null
}
