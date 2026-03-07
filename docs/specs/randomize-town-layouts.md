---
title: "[P2] Randomize town layouts — procedural building placement"
status: todo
issue: 41
priority: P2
tags: [stream-1, frontend, map, randomization]
---

# Randomize Town Building Layouts

Town layouts should be randomized so buildings aren't always in the same places.

## Implementation

- Modify `frontend/src/config/default-town.ts` for procedural building placement
- Define placement zones (north residential, central commercial, south open)
- Randomize building positions ensuring:
  - No overlaps
  - Path connectivity maintained (all buildings reachable)
  - Perimeter fence preserved
- Update `IsometricMap.ts` to accept dynamic tile grids
- Seed-based randomization for reproducibility

## Acceptance Criteria

- [ ] Buildings in randomized positions each experiment
- [ ] All buildings accessible via connected paths
- [ ] Perimeter fence and water preserved
- [ ] Same seed = same layout
- [ ] Unit tests verify path connectivity

## Key Files

`default-town.ts`, `IsometricMap.ts`
