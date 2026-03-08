import type { MapTheme } from '@/types/world'

export const MAP_THEMES: MapTheme[] = [
  {
    id: 'lord-of-the-flies',
    name: 'Castaway Island',
    description: 'Tropical survival. Sandy shores, jungle canopy, thatched shelters.',
    tilePalette: {
      grass:    ['#5a8a3c', '#4a7a2c', '#6a9a4c'],
      path:     ['#d4b896', '#c4a886', '#e4c8a6'],
      building: ['#8b7355', '#7a6245', '#9b8365'],
      fence:    ['#6b5b3b', '#5b4b2b', '#7b6b4b'],
      field:    ['#7aaa4c', '#6a9a3c', '#8aba5c'],
    },
    buildingStyle: 'huts',
    ambient: {
      fogColor: '#a0d8ef',
      fogOpacity: 0.05,
      tint: '#fff5e0',
    },
    dayNight: { enabled: true, showCelestialBodies: true },
    preview: ['#5a8a3c', '#d4b896', '#8b7355', '#a0d8ef'],
  },
  {
    id: 'matrix',
    name: 'The Construct',
    description: 'Digital void. Neon grids, wireframe structures, falling code.',
    tilePalette: {
      grass:    ['#0a0a0a', '#001a00', '#0d0d0d'],
      path:     ['#003300', '#004400', '#002200'],
      building: ['#001a00', '#003300', '#000d00'],
      fence:    ['#002200', '#003300', '#001100'],
      field:    ['#0a1a0a', '#0d2a0d', '#071407'],
    },
    buildingStyle: 'wireframe',
    ambient: {
      fogColor: '#00ff41',
      fogOpacity: 0.03,
      overlay: 'code',
      overlayOpacity: 0.15,
      tint: '#00ff41',
      scanlines: true,
    },
    dayNight: { enabled: true, showCelestialBodies: true, celestialVariant: 'digital' },
    preview: ['#0a0a0a', '#00ff41', '#003300', '#001a00'],
  },
  {
    id: 'gladiator',
    name: 'The Arena',
    description: 'Roman grandeur. Dusty sand, stone columns, torchlit cells.',
    tilePalette: {
      grass:    ['#c4a55a', '#b4953a', '#d4b56a'],
      path:     ['#a08050', '#907040', '#b09060'],
      building: ['#d4c4a0', '#c4b490', '#e4d4b0'],
      fence:    ['#8a7a5a', '#7a6a4a', '#9a8a6a'],
      field:    ['#baa04a', '#aa903a', '#cab05a'],
    },
    buildingStyle: 'roman',
    ambient: {
      fogColor: '#ffcc80',
      fogOpacity: 0.06,
      overlay: 'dust',
      overlayOpacity: 0.1,
      tint: '#ffe0b0',
    },
    dayNight: { enabled: true, showCelestialBodies: true },
    preview: ['#c4a55a', '#d4c4a0', '#a08050', '#ffcc80'],
  },
  {
    id: '1984',
    name: 'Sector 7G',
    description: 'Industrial dystopia. Concrete, rust, smog, dim orange glow.',
    tilePalette: {
      grass:    ['#2a2a2a', '#222222', '#323232'],
      path:     ['#3a3530', '#2a2520', '#4a4540'],
      building: ['#4a4540', '#3a3530', '#5a5550'],
      fence:    ['#5a3a2a', '#4a2a1a', '#6a4a3a'],
      field:    ['#3a3a2a', '#2a2a1a', '#4a4a3a'],
    },
    buildingStyle: 'brutalist',
    ambient: {
      fogColor: '#ff6600',
      fogOpacity: 0.08,
      overlay: 'smog',
      overlayOpacity: 0.2,
      tint: '#ff8844',
      scanlines: true,
    },
    dayNight: { enabled: true, showCelestialBodies: true },
    preview: ['#2a2a2a', '#ff6600', '#4a4540', '#5a3a2a'],
  },
]

export function getThemeById(id: string): MapTheme | undefined {
  return MAP_THEMES.find(t => t.id === id)
}
