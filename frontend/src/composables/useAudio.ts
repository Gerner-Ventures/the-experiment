/**
 * useAudio — Audio state management composable.
 *
 * Manages three audio layers:
 * 1. Ambient: Looping theme soundscape
 * 2. Weather: Looping weather effect
 * 3. SFX: One-shot event sounds
 *
 * Audio is initialized on first user interaction (play/step click)
 * to satisfy browser autoplay policies.
 *
 * Volume persists to localStorage. Mute toggle affects all layers.
 */

import { ref } from 'vue'
import { sound } from '@pixi/sound'
import { AUDIO_MANIFEST, type SFXEvent, type WeatherType } from '@/config/audio-manifest'

const VOLUME_STORAGE_KEY = 'experiment-audio-volumes'
const AUDIO_MUTE_KEY = 'experiment-audio-mute'

/** Default volume levels */
const DEFAULT_VOLUMES = {
  ambient: 0.3,
  sfx: 0.6,
  weather: 0.25,
}

/** Volume ducking level during TTS narration */
const DUCKED_AMBIENT_VOLUME = 0.08

export interface UseAudio {
  /** Initialize audio context on first user interaction */
  init(): void
  /** Whether audio system has been initialized */
  readonly initialized: boolean

  /** Set the active theme (crossfades ambient loop) */
  setTheme(themeId: string): void
  /** Start/stop weather audio layer */
  setWeather(type: WeatherType | null): void
  /** Play a one-shot SFX event */
  playSFX(event: SFXEvent): void

  /** Mute/unmute all audio */
  toggleMute(): void
  /** Current mute state */
  readonly isMuted: ReturnType<typeof ref<boolean>>

  /** Set volume for a layer (0-1) */
  setVolume(layer: 'ambient' | 'sfx' | 'weather', value: number): void
  /** Get current volumes */
  getVolumes(): typeof DEFAULT_VOLUMES

  /** Duck ambient volume during narration playback */
  duckForNarration(): void
  /** Restore ambient volume after narration */
  unduckForNarration(): void
}

export function useAudio(): UseAudio {
  let _initialized = false
  let currentThemeId: string | null = null
  let currentWeatherType: WeatherType | null = null
  const isMuted = ref(localStorage.getItem(AUDIO_MUTE_KEY) === 'true')

  // Load persisted volumes
  const volumes = { ...DEFAULT_VOLUMES }
  try {
    const stored = localStorage.getItem(VOLUME_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<typeof DEFAULT_VOLUMES>
      if (typeof parsed.ambient === 'number') volumes.ambient = parsed.ambient
      if (typeof parsed.sfx === 'number') volumes.sfx = parsed.sfx
      if (typeof parsed.weather === 'number') volumes.weather = parsed.weather
    }
  } catch {
    // Ignore parse errors
  }

  function init(): void {
    if (_initialized) return
    _initialized = true
    console.debug('[Audio] Initialized')
  }

  function setTheme(themeId: string): void {
    if (!_initialized || isMuted.value) return
    const manifest = AUDIO_MANIFEST[themeId]
    if (!manifest) return

    // Stop previous ambient
    if (currentThemeId) {
      const prevKey = `ambient-${currentThemeId}`
      if (sound.exists(prevKey)) {
        sound.stop(prevKey)
        sound.remove(prevKey)
      }
    }

    currentThemeId = themeId

    // Load and play new ambient
    const key = `ambient-${themeId}`
    try {
      sound.add(key, {
        url: manifest.ambient,
        loop: true,
        volume: volumes.ambient,
        preload: true,
        loaded: (_err) => {
          if (!_err && currentThemeId === themeId && !isMuted.value) {
            sound.play(key)
          }
        },
      })
    } catch (err) {
      // Audio file may not exist yet (placeholder)
      console.debug(`[Audio] Failed to load ambient for ${themeId}:`, err)
    }
  }

  function setWeather(type: WeatherType | null): void {
    if (!_initialized) return

    // Stop previous weather
    if (currentWeatherType) {
      const prevKey = `weather-${currentWeatherType}`
      if (sound.exists(prevKey)) {
        sound.stop(prevKey)
        sound.remove(prevKey)
      }
    }

    currentWeatherType = type
    if (!type || isMuted.value) return

    const manifest = AUDIO_MANIFEST[currentThemeId ?? '']
    if (!manifest) return

    const url = manifest.weather[type]
    if (!url) return

    const key = `weather-${type}`
    try {
      sound.add(key, {
        url,
        loop: true,
        volume: volumes.weather,
        preload: true,
        loaded: (_err) => {
          if (!_err && currentWeatherType === type && !isMuted.value) {
            sound.play(key)
          }
        },
      })
    } catch (err) {
      console.debug(`[Audio] Failed to load weather ${type}:`, err)
    }
  }

  function playSFX(event: SFXEvent): void {
    if (!_initialized || isMuted.value || !currentThemeId) return

    const manifest = AUDIO_MANIFEST[currentThemeId]
    if (!manifest) return

    const url = manifest.sfx[event]
    if (!url) return

    const key = `sfx-${currentThemeId}-${event}`
    try {
      if (!sound.exists(key)) {
        sound.add(key, {
          url,
          volume: volumes.sfx,
          preload: true,
          loaded: (_err) => {
            if (!_err && !isMuted.value) {
              sound.play(key)
            }
          },
        })
      } else {
        sound.play(key)
      }
    } catch (err) {
      console.debug(`[Audio] Failed to play SFX ${event}:`, err)
    }
  }

  function toggleMute(): void {
    isMuted.value = !isMuted.value
    localStorage.setItem(AUDIO_MUTE_KEY, String(isMuted.value))

    if (isMuted.value) {
      sound.muteAll()
    } else {
      sound.unmuteAll()
      // Re-start ambient if theme is set
      if (currentThemeId) {
        setTheme(currentThemeId)
      }
    }
  }

  function setVolume(layer: 'ambient' | 'sfx' | 'weather', value: number): void {
    volumes[layer] = Math.max(0, Math.min(1, value))
    localStorage.setItem(VOLUME_STORAGE_KEY, JSON.stringify(volumes))

    // Apply to running sounds
    if (layer === 'ambient' && currentThemeId) {
      const key = `ambient-${currentThemeId}`
      if (sound.exists(key)) {
        sound.volume(key, volumes.ambient)
      }
    }
    if (layer === 'weather' && currentWeatherType) {
      const key = `weather-${currentWeatherType}`
      if (sound.exists(key)) {
        sound.volume(key, volumes.weather)
      }
    }
  }

  function getVolumes(): typeof DEFAULT_VOLUMES {
    return { ...volumes }
  }

  function duckForNarration(): void {
    if (currentThemeId) {
      const key = `ambient-${currentThemeId}`
      if (sound.exists(key)) {
        sound.volume(key, DUCKED_AMBIENT_VOLUME)
      }
    }
  }

  function unduckForNarration(): void {
    if (currentThemeId) {
      const key = `ambient-${currentThemeId}`
      if (sound.exists(key)) {
        sound.volume(key, volumes.ambient)
      }
    }
  }

  return {
    init,
    get initialized() { return _initialized },
    setTheme,
    setWeather,
    playSFX,
    toggleMute,
    isMuted,
    setVolume,
    getVolumes,
    duckForNarration,
    unduckForNarration,
  }
}
