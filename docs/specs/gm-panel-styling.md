---
title: "GM Plan Panel - Theme-Safe Styling & Layout Redesign"
status: in_progress
issue: 79
priority: P1
tags: [stream-1, frontend, ui, bugfix, gm-panel, hud]
---

# GM Plan Panel - Theme-Safe Styling & Layout Redesign

The GM Plan Panel (`GMPlanPanel.vue`) has critical styling issues that make it unusable across themes. Text is invisible unless highlighted, and the layout needs to feel more engaging for players making strategic decisions.

## Problem

The panel hardcodes `text-white/XX` Tailwind classes throughout, and the Ant Design `<Drawer>` component renders with its default background. This means:
- Text is invisible on light/default Ant Design drawer backgrounds
- No Drawer-specific dark overrides exist in `main.css`
- The `<Descriptions>` component (resource modifiers) also lacks dark theme styling
- The overall layout is a flat list of sections with no visual hierarchy for decision-making

## Files

- `frontend/src/components/hud/GMPlanPanel.vue` — Primary component
- `frontend/src/assets/styles/main.css` — Ant Design dark overrides
- `frontend/src/locales/en.ts` — GM panel locale strings

---

## 1. Fix Drawer Theme Compatibility
<!-- canon:system:1 status:done -->

Add Ant Design Drawer dark overrides to `main.css` so the drawer background, header, and close button match the dark theme.

### Acceptance Criteria

- [x] Drawer background uses `--ant-color-bg-elevated` or equivalent dark surface
<!-- canon:realized-in:audit file:frontend/src/assets/styles/main.css:250-274 -->
- [x] Drawer title text is visible (`--ant-color-text`)
<!-- canon:realized-in:audit file:frontend/src/assets/styles/main.css:250-274 -->
- [x] Drawer close icon is visible on dark background
<!-- canon:realized-in:audit file:frontend/src/assets/styles/main.css:250-274 -->
- [x] Drawer footer area matches dark theme
<!-- canon:realized-in:audit file:frontend/src/assets/styles/main.css:250-274 -->

## 2. Replace Hardcoded White Text with Theme Tokens
<!-- canon:system:2 status:done -->

Remove all `text-white/XX` classes from `GMPlanPanel.vue` and replace with Ant Design CSS variables or Tailwind theme tokens that respond to the active theme.

### Acceptance Criteria

- [x] Section labels use `--ant-color-text-secondary` or `--ant-color-text-tertiary` instead of `text-white/40`
<!-- canon:realized-in:audit file:frontend/src/components/hud/GMPlanPanel.vue -->
- [x] Body text uses `--ant-color-text` instead of `text-white/70`
<!-- canon:realized-in:audit file:frontend/src/components/hud/GMPlanPanel.vue -->
- [x] Muted text (reasoning, narration) uses `--ant-color-text-secondary` instead of `text-white/50` or `text-white/60`
<!-- canon:realized-in:audit file:frontend/src/components/hud/GMPlanPanel.vue -->
- [x] Meta hint accent color uses `--color-accent` from Tailwind theme
<!-- canon:realized-in:audit file:frontend/src/components/hud/GMPlanPanel.vue -->
- [x] No remaining hardcoded `text-white` classes in the component
<!-- canon:realized-in:audit file:frontend/src/components/hud/GMPlanPanel.vue -->

## 3. Fix Descriptions Component Dark Styling
<!-- canon:system:3 status:done -->

The Ant Design `<Descriptions>` component used for resource modifiers has no dark theme overrides, making labels and borders invisible.

### Acceptance Criteria

- [x] Descriptions label cells have visible text on dark background
<!-- canon:realized-in:audit file:frontend/src/assets/styles/main.css:276-279 -->
- [x] Descriptions borders use `--ant-color-border`
<!-- canon:realized-in:audit file:frontend/src/assets/styles/main.css:276-279 -->
- [x] Descriptions background matches panel surface color
<!-- canon:realized-in:audit file:frontend/src/assets/styles/main.css:276-279 -->
- [x] Resource modifier values retain semantic coloring (red for negative, green for positive)
<!-- canon:realized-in:audit file:frontend/src/components/hud/GMPlanPanel.vue -->

## 4. Redesign Panel Layout for Player Engagement
<!-- canon:system:4 status:in_progress -->

Restructure the panel to create clear visual hierarchy that helps players quickly parse the GM's plan and make informed approve/dismiss decisions.

### Acceptance Criteria

- [x] Crisis event is visually prominent with a distinct card treatment (elevated background, accent border based on severity)
<!-- canon:realized-in:audit file:frontend/src/components/hud/GMPlanPanel.vue:59-81 -->
- [ ] Severity tag is large and color-coded, immediately drawing attention
- [x] Resource modifiers are displayed as a compact grid with clear +/- indicators and resource-specific colors from theme (`--color-food`, `--color-water`, `--color-materials`, `--color-power`)
<!-- canon:realized-in:audit file:frontend/src/components/hud/GMPlanPanel.vue:86-111 -->
- [x] Narration preview is styled as a distinct blockquote with italic treatment
<!-- canon:realized-in:audit file:frontend/src/components/hud/GMPlanPanel.vue:113-120 -->
- [ ] Reasoning section is collapsible or visually de-emphasized (secondary info)
- [ ] Meta hint (when present) has a subtle accent glow or border to signal its importance
- [ ] Clear visual separation between sections (spacing, dividers, or card grouping)
- [ ] Approve/Dismiss buttons are prominent with clear visual weight difference (primary vs ghost)

## 5. Validate Across Themes
<!-- canon:system:5 status:in_progress -->

Ensure the panel renders correctly regardless of system or Ant Design theme settings.

### Acceptance Criteria

- [x] Panel is fully readable on the app's dark theme
<!-- canon:realized-in:audit file:frontend/src/assets/styles/main.css:250-279 -->
- [x] No hardcoded color values remain that would break on theme changes
<!-- canon:realized-in:audit file:frontend/src/components/hud/GMPlanPanel.vue -->
- [x] All Ant Design components within the panel inherit dark overrides
<!-- canon:realized-in:audit file:frontend/src/assets/styles/main.css:250-279 -->
- [ ] Contrast ratios meet WCAG AA for all text elements
