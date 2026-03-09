import type { MeetingScenePhase } from '@/stores/social'

/** Per-theme meeting backdrop configuration */
export interface MeetingThemeBackdrop {
  /** Phase-indexed CSS gradient strings for sky/atmosphere */
  gradients: Record<MeetingScenePhase, string>
  /** CSS class applied to the scene root for theme-specific CSS decorations */
  sceneClass: string
}

/**
 * Meeting scene backdrop configs keyed by map theme ID.
 * Each theme provides phase-progressing gradients (warm→dark as time passes)
 * and a CSS class for scenic elements (rocks, barrels, columns, etc.)
 */
export const MEETING_THEME_BACKDROPS: Record<string, MeetingThemeBackdrop> = {
  'lord-of-the-flies': {
    sceneClass: 'meeting-theme--beach',
    gradients: {
      entering:  'linear-gradient(to bottom, #e8a54b 0%, #d4823a 30%, #c4682a 60%, #2a1810 100%)',
      proposal:  'linear-gradient(to bottom, #e8a54b 0%, #d4823a 30%, #c4682a 60%, #2a1810 100%)',
      speeches:  'linear-gradient(to bottom, #d47830 0%, #c06020 30%, #8a3a18 60%, #1a1008 100%)',
      voting:    'linear-gradient(to bottom, #8a4820 0%, #6a3018 30%, #3a1a10 60%, #0a0804 100%)',
      result:    'linear-gradient(to bottom, #3a2010 0%, #2a1508 30%, #1a0c04 60%, #050302 100%)',
      exile:     'linear-gradient(to bottom, #3a2010 0%, #2a1508 30%, #1a0c04 60%, #050302 100%)',
      exiting:   'linear-gradient(to bottom, #1a0c04 0%, #0a0604 50%, #020101 100%)',
    },
  },
  'matrix': {
    sceneClass: 'meeting-theme--matrix',
    gradients: {
      entering:  'linear-gradient(to bottom, #001a00 0%, #000d00 40%, #000400 80%, #000000 100%)',
      proposal:  'linear-gradient(to bottom, #001a00 0%, #000d00 40%, #000400 80%, #000000 100%)',
      speeches:  'linear-gradient(to bottom, #001400 0%, #000a00 40%, #000300 80%, #000000 100%)',
      voting:    'linear-gradient(to bottom, #000e00 0%, #000800 40%, #000200 80%, #000000 100%)',
      result:    'linear-gradient(to bottom, #000800 0%, #000400 40%, #000100 80%, #000000 100%)',
      exile:     'linear-gradient(to bottom, #000800 0%, #000400 40%, #000100 80%, #000000 100%)',
      exiting:   'linear-gradient(to bottom, #000200 0%, #000100 50%, #000000 100%)',
    },
  },
  'gladiator': {
    sceneClass: 'meeting-theme--arena',
    gradients: {
      entering:  'linear-gradient(to bottom, #d4a060 0%, #b08040 30%, #8a6030 60%, #2a1a08 100%)',
      proposal:  'linear-gradient(to bottom, #d4a060 0%, #b08040 30%, #8a6030 60%, #2a1a08 100%)',
      speeches:  'linear-gradient(to bottom, #b08040 0%, #8a6030 30%, #604020 60%, #1a0e04 100%)',
      voting:    'linear-gradient(to bottom, #6a4820 0%, #4a3018 30%, #2a1a0c 60%, #0a0604 100%)',
      result:    'linear-gradient(to bottom, #3a2010 0%, #2a1508 30%, #1a0c04 60%, #050302 100%)',
      exile:     'linear-gradient(to bottom, #3a2010 0%, #2a1508 30%, #1a0c04 60%, #050302 100%)',
      exiting:   'linear-gradient(to bottom, #1a0c04 0%, #0a0604 50%, #020101 100%)',
    },
  },
  '1984': {
    sceneClass: 'meeting-theme--sector',
    gradients: {
      entering:  'linear-gradient(to bottom, #3a2010 0%, #2a1508 20%, #1a0c04 50%, #0a0604 100%)',
      proposal:  'linear-gradient(to bottom, #3a2010 0%, #2a1508 20%, #1a0c04 50%, #0a0604 100%)',
      speeches:  'linear-gradient(to bottom, #301808 0%, #201004 20%, #140a02 50%, #080402 100%)',
      voting:    'linear-gradient(to bottom, #200c04 0%, #180804 20%, #0e0402 50%, #060202 100%)',
      result:    'linear-gradient(to bottom, #140804 0%, #0c0402 20%, #060202 50%, #020101 100%)',
      exile:     'linear-gradient(to bottom, #140804 0%, #0c0402 20%, #060202 50%, #020101 100%)',
      exiting:   'linear-gradient(to bottom, #080402 0%, #040201 50%, #010100 100%)',
    },
  },
}

export const DEFAULT_MEETING_BACKDROP: MeetingThemeBackdrop = MEETING_THEME_BACKDROPS['lord-of-the-flies']

export function getMeetingBackdrop(themeId: string): MeetingThemeBackdrop {
  return MEETING_THEME_BACKDROPS[themeId] ?? DEFAULT_MEETING_BACKDROP
}
