---
title: "GM Plan Panel - Theme-Safe Styling & Layout Redesign"
status: todo
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
<!-- status: todo -->

Add Ant Design Drawer dark overrides to `main.css` so the drawer background, header, and close button match the dark theme.

### Acceptance Criteria

- [ ] Drawer background uses `--ant-color-bg-elevated` or equivalent dark surface
- [ ] Drawer title text is visible (`--ant-color-text`)
- [ ] Drawer close icon is visible on dark background
- [ ] Drawer footer area matches dark theme

## 2. Replace Hardcoded White Text with Theme Tokens
<!-- status: todo -->

Remove all `text-white/XX` classes from `GMPlanPanel.vue` and replace with Ant Design CSS variables or Tailwind theme tokens that respond to the active theme.

### Acceptance Criteria

- [ ] Section labels use `--ant-color-text-secondary` or `--ant-color-text-tertiary` instead of `text-white/40`
- [ ] Body text uses `--ant-color-text` instead of `text-white/70`
- [ ] Muted text (reasoning, narration) uses `--ant-color-text-secondary` instead of `text-white/50` or `text-white/60`
- [ ] Meta hint accent color uses `--color-accent` from Tailwind theme
- [ ] No remaining hardcoded `text-white` classes in the component

## 3. Fix Descriptions Component Dark Styling
<!-- status: todo -->

The Ant Design `<Descriptions>` component used for resource modifiers has no dark theme overrides, making labels and borders invisible.

### Acceptance Criteria

- [ ] Descriptions label cells have visible text on dark background
- [ ] Descriptions borders use `--ant-color-border`
- [ ] Descriptions background matches panel surface color
- [ ] Resource modifier values retain semantic coloring (red for negative, green for positive)

## 4. Redesign Panel Layout for Player Engagement
<!-- status: todo -->

Restructure the panel to create clear visual hierarchy that helps players quickly parse the GM's plan and make informed approve/dismiss decisions.

### Acceptance Criteria

- [ ] Crisis event is visually prominent with a distinct card treatment (elevated background, accent border based on severity)
- [ ] Severity tag is large and color-coded, immediately drawing attention
- [ ] Resource modifiers are displayed as a compact grid with clear +/- indicators and resource-specific colors from theme (`--color-food`, `--color-water`, `--color-materials`, `--color-power`)
- [ ] Narration preview is styled as a distinct blockquote with italic treatment
- [ ] Reasoning section is collapsible or visually de-emphasized (secondary info)
- [ ] Meta hint (when present) has a subtle accent glow or border to signal its importance
- [ ] Clear visual separation between sections (spacing, dividers, or card grouping)
- [ ] Approve/Dismiss buttons are prominent with clear visual weight difference (primary vs ghost)

## 5. Validate Across Themes
<!-- status: todo -->

Ensure the panel renders correctly regardless of system or Ant Design theme settings.

### Acceptance Criteria

- [ ] Panel is fully readable on the app's dark theme
- [ ] No hardcoded color values remain that would break on theme changes
- [ ] All Ant Design components within the panel inherit dark overrides
- [ ] Contrast ratios meet WCAG AA for all text elements
