---
title: "[P2] Environmental props — decorative objects on map tiles"
status: todo
priority: P2
tags: [stream-1, frontend, pixi, visual, isometric]
depends_on: [S1.3-isometric-world]
parent: isometric-aesthetics
---

# Environmental Props

Small decorative objects placed on non-building tiles to add life and break up empty space. Props are theme-specific and drawn with Graphics primitives.

## Per-Theme Treatment

| Theme | Grass Props | Path Props | Field Props |
|---|---|---|---|
| Castaway Island | Small rocks, coconuts, tropical flowers, fallen palm fronds | Footprints, shell fragments, driftwood pieces | Harvest baskets, tool marks |
| The Construct | Floating code fragments (small text), data nodes (bright dots), glitch squares | Circuit trace lines, access points (blinking dots) | Data crystals, memory shards |
| The Arena | Loose stones, dried scrub bushes, clay pots/urns | Sand drifts, discarded weapon fragments | Hay bales, wooden training posts |
| Sector 7G | Rusted bolts, puddles (dark reflection), weeds through concrete | Manhole covers, cigarette butts, paper litter | Chemical drums, pipe segments |

## Implementation

- Add `drawEnvironmentProps(theme, tiles)` in `IsometricMap.ts`
- Props placed using seeded random per tile — ~30-40% of eligible tiles get a prop
- Each prop is 3-8px, drawn with Graphics primitives
- Props on decoration layer (z=5), rendered once at map load
- Props should not overlap with agent paths or building entrances

## Acceptance Criteria

- [ ] 30-40% of grass, path, and field tiles have a small decorative prop
- [ ] Props are theme-specific and visually coherent with palette
- [ ] Props are small enough not to obscure tile type or interfere with agents
- [ ] Prop placement is deterministic (seeded by tile position)
- [ ] Props render on decoration layer, below agents and buildings
- [ ] No props on fence or building tiles

## Key Files

- `frontend/src/components/world/pixi/IsometricMap.ts`
- `frontend/src/config/map-themes.ts`
