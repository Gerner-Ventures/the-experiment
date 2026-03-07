<script setup lang="ts">
import { Button, Slider, Tooltip } from 'ant-design-vue'
import {
  CaretRightOutlined,
  PauseOutlined,
  StepForwardOutlined,
  DashboardOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons-vue'
import { useLocale } from '@/locales'

const locale = useLocale()

defineProps<{
  isPlaying: boolean
  speed: number
  isComplete: boolean
  hasExperiment: boolean
}>()

const emit = defineEmits<{
  step: []
  play: []
  pause: []
  speedChange: [speed: number]
  toggleLog: []
}>()
</script>

<template>
  <div class="flex items-center justify-center gap-3 px-6 py-2.5 bg-base/90 backdrop-blur-sm border-t border-white/[0.06]">
    <!-- Log toggle -->
    <Tooltip :title="locale.log.title">
      <Button
        size="small"
        shape="circle"
        class="!border-white/10 !inline-flex !items-center !justify-center"
        @click="emit('toggleLog')"
      >
        <template #icon><UnorderedListOutlined class="!text-white/40" /></template>
      </Button>
    </Tooltip>

    <div class="w-px h-5 bg-white/[0.08] mx-1" />

    <!-- Play/Pause -->
    <Tooltip :title="isPlaying ? locale.hud.pause : locale.hud.play">
      <Button
        :type="isPlaying ? 'default' : 'primary'"
        shape="circle"
        size="large"
        class="!inline-flex !items-center !justify-center"
        :disabled="!hasExperiment || isComplete"
        @click="isPlaying ? emit('pause') : emit('play')"
      >
        <template #icon>
          <PauseOutlined v-if="isPlaying" />
          <CaretRightOutlined v-else />
        </template>
      </Button>
    </Tooltip>

    <!-- Step -->
    <Tooltip :title="locale.hud.step">
      <Button
        shape="circle"
        size="middle"
        class="!inline-flex !items-center !justify-center"
        :disabled="!hasExperiment || isComplete || isPlaying"
        @click="emit('step')"
      >
        <template #icon><StepForwardOutlined /></template>
      </Button>
    </Tooltip>

    <div class="w-px h-5 bg-white/[0.08] mx-1" />

    <!-- Speed Slider -->
    <div class="flex items-center gap-2 w-[120px]">
      <DashboardOutlined class="text-white/30 text-xs shrink-0" />
      <Slider
        :value="speed"
        :min="0.5"
        :max="3"
        :step="0.5"
        :tooltip="{ formatter: (v: number) => `${v}x` }"
        class="flex-1 !mb-0"
        @change="(v: number | [number, number]) => emit('speedChange', v as number)"
      />
      <span class="font-mono text-[10px] text-white/30 shrink-0 w-6 text-right">{{ speed }}x</span>
    </div>
  </div>
</template>
