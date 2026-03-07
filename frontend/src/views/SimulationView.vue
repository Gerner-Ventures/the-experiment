<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Typography } from 'ant-design-vue'
import { ArrowLeftOutlined } from '@ant-design/icons-vue'
import { useLocale } from '@/locales'
import { getThemeById, MAP_THEMES } from '@/config/map-themes'
import { DEFAULT_TOWN } from '@/config/default-town'
import type { AgentConfig } from '@/types/agent'
import type { MapTheme } from '@/types/world'
import PixiWorld from '@/components/world/PixiWorld.vue'

const locale = useLocale()
const router = useRouter()

// Retrieve config from sessionStorage (set by SetupView before navigation)
const storedConfig = sessionStorage.getItem('experiment-config')
const config = storedConfig ? JSON.parse(storedConfig) as {
  agents: AgentConfig[]
  themeId: string
  arc: string
  rounds: number
  resources: number
} : null

const theme = computed<MapTheme>(() => {
  if (config?.themeId) {
    return getThemeById(config.themeId) ?? MAP_THEMES[0]
  }
  return MAP_THEMES[0]
})

const agents = computed<AgentConfig[]>(() => config?.agents ?? [])

const ready = ref(false)
onMounted(() => {
  // Short delay to let the view mount
  setTimeout(() => {
    ready.value = true
  }, 100)
})

function goBack() {
  router.push({ name: 'setup' })
}
</script>

<template>
  <div class="h-full w-full flex flex-col bg-void relative overflow-hidden">
    <!-- Top bar -->
    <header class="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-base/80 backdrop-blur-sm shrink-0 z-10">
      <div class="flex items-center gap-3">
        <Button size="small" @click="goBack">
          <template #icon><ArrowLeftOutlined /></template>
        </Button>
        <Typography.Text class="font-mono !text-xs !text-white/40 uppercase tracking-widest">
          {{ theme.name }}
        </Typography.Text>
      </div>
      <Typography.Text class="font-mono !text-[10px] !text-white/20">
        {{ agents.length }} SUBJECTS • DEMO MODE
      </Typography.Text>
    </header>

    <!-- PixiJS World -->
    <div class="flex-1 relative">
      <PixiWorld
        v-if="ready && agents.length > 0"
        :theme="theme"
        :map-data="DEFAULT_TOWN"
        :agents="agents"
      />
      <div v-else class="h-full flex items-center justify-center">
        <Typography.Text class="font-mono !text-sm !text-white/30">
          {{ locale.simulation.loading }}
        </Typography.Text>
      </div>
    </div>
  </div>
</template>
