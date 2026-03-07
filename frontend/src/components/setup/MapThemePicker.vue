<script setup lang="ts">
import { MAP_THEMES } from '@/config/map-themes'
import { useLocale } from '@/locales'

const locale = useLocale()
const selectedTheme = defineModel<string>({ required: true })
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2">
      <span class="font-mono text-[10px] text-white/40 uppercase tracking-widest">
        {{ locale.mapTheme.title }}
      </span>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <button
        v-for="theme in MAP_THEMES"
        :key="theme.id"
        class="group relative p-3 rounded-lg border transition-all duration-200 text-left"
        :class="selectedTheme === theme.id
          ? 'border-accent/50 bg-accent/10 ring-1 ring-accent/20'
          : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15] hover:bg-white/[0.05]'"
        @click="selectedTheme = theme.id"
      >
        <!-- Color swatches -->
        <div class="flex gap-1 mb-2">
          <div
            v-for="(color, i) in theme.preview"
            :key="i"
            class="w-5 h-5 rounded-sm border border-white/10"
            :style="{ backgroundColor: color }"
          />
        </div>

        <!-- Theme info -->
        <div class="font-mono text-xs font-medium" :class="selectedTheme === theme.id ? 'text-accent' : 'text-white/80'">
          {{ theme.name }}
        </div>
        <div class="font-mono text-[10px] text-white/30 mt-0.5 line-clamp-2">
          {{ theme.description }}
        </div>

        <!-- Selected indicator -->
        <div
          v-if="selectedTheme === theme.id"
          class="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent animate-glow-pulse"
        />
      </button>
    </div>
  </div>
</template>
