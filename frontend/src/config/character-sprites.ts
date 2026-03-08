// Backward-compatible re-export — all existing imports continue to work
// The HD sprite system is now the only system.
export {
  // Character data
  HD_CHARACTER_SPRITES as CHARACTER_SPRITES,
  getSpriteById,
  getHDSpriteById,
  // Rendering
  renderCharacter,
  renderSpriteToCanvas,
  renderHDSpriteGrid,
  renderHDSpriteToCanvas,
  // Animations
  HD_SILLY_ANIMATIONS as SILLY_ANIMATIONS,
  HD_ACTION_TO_ANIMATION as ACTION_TO_ANIMATION,
  HD_ANIMATION_REGISTRY as ANIMATION_REGISTRY,
  HD_FALLBACK_ANIMATION as FALLBACK_ANIMATION,
  getHDAnimation,
  getHDAnimationForAction,
  // Constants
  SPRITE_W, SPRITE_H, SPRITE_SCALE,
  HD_GRID_W, HD_GRID_H, HD_PIXEL_SCALE,
  // Cache
  HDFrameCache,
} from './sprites'

// Re-export types
export type {
  HDCharacterDef,
  HDCharacterDef as CharacterSprite,
  HDPoseName,
  HDPoseName as PoseName,
  HDAnimationDef,
  HDAnimationDef as AnimationDef,
  BasePalette,
  BasePalette as CharacterPalette,
  PixelGrid,
  StatusEffect,
} from './sprites'
