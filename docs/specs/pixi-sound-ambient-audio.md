---
title: "[P3] Ambient audio with @pixi/sound"
status: in_progress
priority: P3
tags: [stream-1, frontend, audio, pixi, ambience]
depends_on: [S1.3-isometric-world, agent-voice-narration]
---

# Ambient Audio with @pixi/sound

## Background

The game already has visual ambient effects — fog, scanlines, rain, dust, smog, and code rain particles via `AmbientOverlay.ts`. It also has per-agent TTS voice narration. What's missing is the environmental audio layer: ambient soundscapes that reinforce each theme's atmosphere and reactive sound effects for in-game events.

`@pixi/sound` is the official PixiJS audio library built on the WebAudio API. It provides sprite-based audio, filters (reverb, distortion, stereo pan), and integrates cleanly with the PixiJS asset loader we already use.

### Why now (trigger conditions)

This spec should be picked up when **any** of these become true:
- The visual polish pass (isometric-aesthetics) is complete and the world feels "silent"
- User testing feedback mentions the lack of audio atmosphere
- The TTS narration system needs ambient audio to mix against (volume ducking, spatial context)
- The highlight reels feature needs audio for recorded clips

## 1. Install and configure @pixi/sound

### Acceptance Criteria

- [ ] `@pixi/sound` is added as a dependency (latest version compatible with PixiJS 8.x)
- [ ] Sound system initializes alongside the PixiJS application in `usePixiWorld.ts`
- [ ] Audio context is created on first user interaction (browser autoplay policy compliance)
- [ ] A global mute/unmute toggle is accessible from the HUD
- [ ] Master volume and ambient volume are independently adjustable
- [ ] Volume preferences persist to localStorage

## 2. Theme-specific ambient soundscapes

Each theme gets a looping ambient track that plays while the experiment is running.

### Acceptance Criteria

- [ ] **Castaway Island**: Ocean waves, tropical birds, rustling palms, crackling campfire
- [ ] **The Construct**: Low digital hum, distant data streams, synthetic wind, occasional glitch artifacts
- [ ] **The Arena**: Distant crowd murmur, wind across sand, clashing metal echoes, horn blasts
- [ ] **Sector 7G**: Industrial machinery drone, steam vents, fluorescent buzz, distant announcements
- [ ] Ambient tracks crossfade smoothly when theme changes (500ms fade)
- [ ] Ambient volume is lower than agent voice narration (default: 30% vs 80%)
- [ ] Tracks loop seamlessly without audible gaps or clicks

## 3. Weather-synced audio layers

Match audio to the existing visual weather effects in `AmbientOverlay.ts`.

### Acceptance Criteria

- [ ] Rain visual effect triggers rain audio layer (layered on top of base ambient)
- [ ] Dust/sandstorm visual triggers wind audio layer
- [ ] Smog visual triggers industrial hiss layer
- [ ] Code rain visual triggers digital patter/typing layer
- [ ] Weather audio layers fade in/out in sync with visual particle spawn/despawn
- [ ] Multiple weather layers can play simultaneously and mix correctly

## 4. Event sound effects

Short one-shot sounds for key game events.

### Acceptance Criteria

- [ ] Agent spawns into world: subtle arrival sound (theme-appropriate)
- [ ] Agent-to-agent conversation starts: soft speech indicator
- [ ] Vote/decision event: notification chime
- [ ] Elimination/consequence: dramatic sting (theme-appropriate)
- [ ] New round starts: transition sound
- [ ] Sound effects respect the global mute toggle
- [ ] Sound effects are short (<2s) and non-intrusive

## 5. Spatial audio (stretch goal)

Position-aware audio that responds to camera position.

### Acceptance Criteria

- [ ] Ambient audio subtly shifts stereo balance based on camera pan position
- [ ] Agent voice narration pans left/right based on agent's screen position relative to viewport center
- [ ] Volume attenuates slightly for agents far from camera center
- [ ] Spatial effects use `@pixi/sound` stereo filter, not manual gain manipulation

## Technical Design

### Audio asset strategy

Use short, loopable audio segments rather than long ambient tracks:
- Base ambient: 15-30s seamless loops per theme (~100-200KB each as compressed OGG)
- Weather layers: 10-15s loops (~50-100KB each)
- Event SFX: <2s one-shots (~10-30KB each)
- Total estimated audio budget: ~2-3MB for all themes

### Integration with existing systems

```
usePixiWorld.ts
  └── initAudio()
        ├── Load audio assets via PixiJS asset loader
        ├── Create ambient sound instances per theme
        └── Expose: playAmbient(theme), playWeather(type), playSFX(event)

AmbientOverlay.ts
  └── When weather effect starts/stops → call playWeather()/stopWeather()

useExperiment.ts (or event bus)
  └── On game events → call playSFX(eventType)

HUD
  └── Volume controls → set master/ambient volume
```

### Key files to modify
- `frontend/src/composables/usePixiWorld.ts` — audio initialization, ambient playback
- `frontend/src/components/world/pixi/AmbientOverlay.ts` — trigger weather audio with visual effects
- `frontend/src/components/hud/` — volume controls UI
- New: `frontend/src/assets/audio/` — audio files organized by theme
- New: `frontend/src/composables/useAudio.ts` — audio state management composable

### Dependencies
- `@pixi/sound` (latest PixiJS 8.x compatible version)
- Audio assets (can use royalty-free ambient loops from freesound.org or generate with AI)

### Browser compatibility
- WebAudio API is supported in all modern browsers
- Must handle autoplay policy: audio context created only after user gesture
- Provide graceful fallback (silent) if WebAudio is unavailable

## Rollout

1. Add `@pixi/sound`, implement mute toggle and volume control in HUD
2. Add base ambient loop for one theme (Castaway Island) as proof of concept
3. Add remaining theme ambient tracks
4. Wire weather audio to `AmbientOverlay` visual effects
5. Add event sound effects
6. (Stretch) Add spatial audio panning
