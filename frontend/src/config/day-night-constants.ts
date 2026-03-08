/**
 * Day/Night Cycle Visual Constants
 *
 * Centralizes all rendering dimensions, animation speeds, and layout
 * parameters for the celestial bodies, sky, and transitions.
 * Referenced by DayNightCycle.ts — edit here to tune visuals.
 */

// ─── Sun (Standard Variant) ───

export const SUN = {
  /** Solid circle radius (px) */
  bodyRadius: 20,
  /** Outer glow circle radius (px) */
  glowRadius: 30,
  /** Glow fill opacity */
  glowAlpha: 0.35,
  /** Gaussian blur strength on glow */
  blurStrength: 12,
  /** Number of corona rays radiating outward */
  rayCount: 8,
  /** Distance from center where each ray starts (px) */
  rayInnerRadius: 22,
  /** Default ray outer length (px), shimmer adds/subtracts from this */
  rayOuterRadius: 32,
  /** Ray stroke width (px) */
  rayStrokeWidth: 2,
  /** Ray stroke opacity */
  rayAlpha: 0.45,
} as const

// ─── Moon (Standard Variant) ───

export const MOON = {
  /** Solid circle radius (px) */
  bodyRadius: 16,
  /** Crescent overlay offset from moon center */
  crescentOffset: { x: 6, y: -3 },
  /** Crescent overlay circle radius */
  crescentRadius: 13,
  /** Crescent overlay opacity */
  crescentAlpha: 0.9,
  /** Crater definitions: [{x, y, radius}] relative to moon center */
  craters: [
    { x: -5, y: 3, radius: 2 },
    { x: -2, y: -4, radius: 1.5 },
    { x: 3, y: 6, radius: 1.5 },
  ],
  /** Crater fill opacity */
  craterAlpha: 0.5,
  /** Outer glow circle radius (px) */
  glowRadius: 26,
  /** Glow fill opacity */
  glowAlpha: 0.25,
  /** Gaussian blur strength on glow */
  blurStrength: 10,
} as const

// ─── Moon Night Position (proportion of screen) ───

export const MOON_NIGHT_POSITION = {
  /** Horizontal position as fraction of screen width (0=left, 1=right) */
  x: 0.82,
  /** Vertical position as fraction of screen height (0=top, 1=bottom) */
  y: 0.12,
} as const

// ─── Digital Variant (Matrix Theme) ───

export const DIGITAL_ORB = {
  coreRadius: 12,
  coreAlpha: 0.8,
  ringRadius: 18,
  ringStrokeWidth: 1.5,
  ringAlpha: 0.5,
  glowRadius: 24,
  glowAlpha: 0.15,
  blurStrength: 10,
} as const

export const DIGITAL_MOON = {
  coreRadius: 10,
  coreAlpha: 0.5,
  ringRadius: 14,
  ringStrokeWidth: 1,
  ringAlpha: 0.3,
} as const

// ─── Stars ───

export const STARS = {
  /** Total number of stars rendered */
  count: 80,
  /** Stars only appear in the top 70% of the sky (0–0.7 normalized y) */
  maxNormalizedY: 0.7,
  /** Minimum base alpha for a star */
  minAlpha: 0.5,
  /** Alpha range added to minAlpha (total max = minAlpha + alphaRange) */
  alphaRange: 0.5,
  /** Minimum star circle radius (px) */
  minRadius: 1,
  /** Radius range added to minRadius */
  radiusRange: 2,
} as const

// ─── Sun Arc Path (proportions of screen dimensions) ───

export const ARC = {
  /** Horizontal padding from screen edges (pushed right to clear HUD overlays) */
  padX: 0.22,
  /** Y-position of the arc endpoints (left/right edges) — kept high so sun stays near top */
  endpointY: 0.15,
  /** Y-position of the arc apex (top of arc, overhead sun) */
  apexY: 0.08,
  /** Vertical offset for bezier control points below apex */
  controlPointOffset: 20,
  /** GSAP MotionPath curviness (higher = rounder arc) */
  curviness: 1.2,
} as const

// ─── Sun Shadow (ellipse below the sun) ───

export const SUN_SHADOW = {
  /** Horizontal radius at horizon (altitude=0) */
  baseRx: 30,
  /** Additional rx when sun is at apex (altitude=1) */
  altitudeRx: 40,
  /** Vertical radius at horizon */
  baseRy: 5,
  /** Additional ry at apex */
  altitudeRy: 8,
  /** Shadow opacity at horizon */
  baseAlpha: 0.08,
  /** Additional opacity at apex */
  altitudeAlpha: 0.22,
  /** Vertical offset below sun at horizon */
  baseYOffset: 70,
  /** Additional downward shift at horizon (reduced at apex) */
  altitudeYRange: 50,
} as const

// ─── Sun Altitude Scaling ───

export const SUN_SCALE = {
  /** Scale factor — uniform size at all positions */
  min: 1.0,
  /** No altitude-based scaling (0 = constant size) */
  range: 0,
} as const

// ─── Animation Speeds (per-frame) ───

export const ANIMATION = {
  /** Star twinkle: sin wave frequency multiplier */
  starTwinkleSpeed: 1.5,
  /** Corona ray shimmer: sin wave frequency multiplier */
  coronaShimmerSpeed: 2,
  /** Phase offset between adjacent corona rays (radians) */
  coronaPhaseStep: 1.3,
  /** Max px added/subtracted to ray length during shimmer */
  coronaShimmerAmplitude: 5,
  /** Digital orb pulse: sin wave frequency multiplier */
  digitalPulseSpeed: 3,
  /** Digital orb minimum alpha during pulse cycle */
  digitalPulseMin: 0.7,
  /** Digital orb alpha range (total max = min + range) */
  digitalPulseRange: 0.3,
} as const

// ─── Transition Durations (seconds) ───

export const TRANSITION = {
  /** Standard phase-to-phase tween duration */
  phaseDuration: 2,
  /** Night→dawn: moon/star fade-out duration */
  nightFadeOutDuration: 0.8,
  /** Night→dawn: sun fade-in + sky color duration */
  dawnFadeInDuration: 1.2,
  /** GSAP ease function for all phase transitions */
  ease: 'power2.inOut',
} as const

// ─── Demo Mode ───

export const DEMO = {
  /** Seconds between automatic phase changes in demo mode */
  intervalSeconds: 10,
} as const

// ─── Rendering Thresholds ───

export const THRESHOLD = {
  /** Minimum alpha before an object's per-frame updates are skipped */
  visibilityMin: 0.01,
  /** Minimum sun alpha before shadow is drawn */
  shadowMin: 0.1,
} as const

// ─── Fallback Sky Colors (when palette has no midday phase) ───

export const FALLBACK_SKY = {
  top: '#87ceeb',
  bottom: '#e0f0ff',
} as const
