---
title: "[P1] Highlight reels — round recaps & post-game cinematic moments"
status: todo
issue: 46
priority: P1
tags: [stream-1, frontend, backend, highlights, narration]
---

# Highlight Reels

Curated highlight reels at the end of each round and game, showcasing the most dramatic moments.

## Backend: Highlight Selection

- New module: `backend/app/highlights/`
- Score events by drama: betrayals (high), crises (high), resource swings (medium), alliance changes (medium), close votes (medium), suspicion spikes (medium)
- End-of-round: top 3-5 events
- End-of-game: top 10-15 events
- API: `GET /api/experiments/:id/highlights?scope=round&round=N` and `?scope=game`

### Acceptance Criteria

- [ ] Events scored by dramatic significance
- [ ] Round highlights: top 3-5 per round
- [ ] Game highlights: top 10-15 across simulation
- [ ] API endpoint returns scored, ordered events
- [ ] Selection accounts for variety

## Frontend: Round Highlight Reel

- New: `components/highlights/RoundHighlights.vue`
- Overlay/modal at end of each round (after Night phase)
- Auto-advance with dramatic presentation
- Skip button, configurable disable

### Acceptance Criteria

- [ ] Highlight reel appears between rounds
- [ ] Shows event description with agent context
- [ ] Auto-advance with skip option
- [ ] Can be disabled in config

## Frontend: Game Highlight Reel

- Integrate into `ReportView.vue` (S1.8)
- Chronological/ranked display of top moments
- Expandable entries with full context
- Replay mode as cinematic slideshow
- Shareable/exportable

### Acceptance Criteria

- [ ] Prominent section in post-game report
- [ ] Full context per highlight
- [ ] Replay mode
- [ ] Exportable/shareable

## Key Files

`backend/app/highlights/`, `components/highlights/RoundHighlights.vue`, `views/ReportView.vue`
