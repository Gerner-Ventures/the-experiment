export type ResourceKey = 'food' | 'water' | 'materials' | 'power'

/** Resource colors — matches --color-food, --color-water, etc. in main.css @theme */
export const RESOURCE_COLORS: Record<ResourceKey, string> = {
  food: '#7dd87d',
  water: '#60a5fa',
  materials: '#d4a04a',
  power: '#f5c542',
}
