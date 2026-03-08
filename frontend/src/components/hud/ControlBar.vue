<script setup lang="ts">
import { Button, Slider, Tooltip } from 'ant-design-vue'
import {
  CaretRightOutlined,
  PauseOutlined,
  StepForwardOutlined,
  DashboardOutlined,
  UnorderedListOutlined,
  LoadingOutlined,
  ShareAltOutlined,
} from '@ant-design/icons-vue'
import { useLocale } from '@/locales'

const locale = useLocale()

defineProps<{
  isPlaying: boolean
  isStepping: boolean
  steppingStatus: string
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
  toggleRelationshipWeb: []
}>()
</script>

<template>
  <div class="flex flex-col items-center gap-1 px-6 py-2.5 bg-base/90 backdrop-blur-sm border-t border-white/[0.06]">
    <!-- Stepping status -->
    <Transition name="fade">
      <div v-if="(isStepping || isPlaying) && steppingStatus" class="flex items-center gap-2 text-accent/70">
        <LoadingOutlined class="text-xs animate-spin" />
        <span class="font-mono text-[11px] tracking-wide">{{ steppingStatus }}</span>
      </div>
    </Transition>

    <div class="flex items-center justify-center gap-3">
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

    <!-- Relationship Web toggle -->
    <Tooltip :title="locale.relationshipWeb.title">
      <Button
        size="small"
        shape="circle"
        class="!border-white/10 !inline-flex !items-center !justify-center"
        @click="emit('toggleRelationshipWeb')"
      >
        <template #icon><ShareAltOutlined class="!text-white/40" /></template>
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
    <Tooltip :title="isStepping ? locale.hud.steppingRunning : locale.hud.step">
      <Button
        shape="circle"
        size="middle"
        class="!inline-flex !items-center !justify-center"
        :disabled="!hasExperiment || isComplete || isPlaying || isStepping"
        :loading="isStepping"
        @click="emit('step')"
      >
        <template v-if="!isStepping" #icon><StepForwardOutlined /></template>
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
  </div>
</template>
